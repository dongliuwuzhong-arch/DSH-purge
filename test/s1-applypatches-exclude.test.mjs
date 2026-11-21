import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// 台账 ③-10 / S4-①.3-1：applyPatches 不过滤 exclude。
// applyPatchesAllHosts / patchStatus / hookDenyPaths / patchWatchedClientBundlesSync 四个入口
// 早就走 withoutExcluded 了，只剩 applyPatches 这个公开入口没有 —— 任何绕过
// applyPatchesAllHosts 直接传 ALL_PATCHES 的路径（启动自愈、外部脚本）都会把 #19 贴回去，
// 而 #19 恰恰是"必须排除才能跟温和剪枝共存"的那条（代码级硬关）。
// 这里钉住：被排除的 id 交给 applyPatches，一个字节都不许写。

const root = fs.mkdtempSync(path.join(os.tmpdir(), "dshpurge-apply-exclude-"));
const plainHome = path.join(root, "home-plain");
const exclHome = path.join(root, "home-excl");
const badHome = path.join(root, "home-bad");
// 默认（不传 options.dshHome）走的是 DSH_HOME：先指向"没有排除清单"的那本家。
process.env.DSH_HOME = plainHome;
for (const h of [plainHome, exclHome, badHome]) fs.mkdirSync(h, { recursive: true });
fs.mkdirSync(path.join(exclHome, "dsh-purge"), { recursive: true });
fs.writeFileSync(
  path.join(exclHome, "dsh-purge", "exclude-patches.json"),
  JSON.stringify({ excludePatches: [19] }),
);
fs.mkdirSync(path.join(badHome, "dsh-purge"), { recursive: true });
fs.writeFileSync(path.join(badHome, "dsh-purge", "exclude-patches.json"), "{ not json");

const core = await import("../lib/core.js");
const { applyPatches, ALL_PATCHES, BAK_SUFFIX } = core;

const aiBase = path.join(root, "ai");
// #19 = TOOL_RESULT_PRUNER_DISABLED：真实锚点，别改写成合成补丁。
const patch19 = ALL_PATCHES.find((p) => p.id === 19);
const prunerFile = path.join(aiBase, "dsh-compaction-tool-result-pruner", "lib", "index.js");
const prunerRep = patch19.replacements[0];
const PRUNER_ORIGINAL = "// fixture pruner\n" + prunerRep.pattern + "\n\t}\n}\n";
const MARKER_19 = "[dsh-purge] tool-result pruning disabled";

// 对照组用的另一条真补丁（#1），证明过滤是按 id 精确剔除，不是整表罢手。
const patch1 = ALL_PATCHES.find((p) => p.id === 1);
const instructionsFile = path.join(aiBase, "dsh-agent-instructions", "lib", "index.js");
const instructionsRep = patch1.replacements[0];
const INSTRUCTIONS_ORIGINAL = "// fixture header\n" + instructionsRep.pattern + "\nmodule.exports = {};\n";

function put(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
}

function seed() {
  fs.rmSync(aiBase, { recursive: true, force: true });
  put(prunerFile, PRUNER_ORIGINAL);
  put(instructionsFile, INSTRUCTIONS_ORIGINAL);
}

test.after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

test("被排除的 #19 传给 applyPatches：一个字节都不写、不建 bak、不进报告", async () => {
  seed();
  const before = fs.readFileSync(prunerFile);
  const report = await applyPatches(aiBase, [patch19], { dshHome: exclHome });
  assert.deepEqual(report, [], "被排除的补丁不该出现在报告里：" + JSON.stringify(report));
  assert.ok(fs.readFileSync(prunerFile).equals(before), "被排除的补丁改动了文件");
  assert.equal(fs.existsSync(prunerFile + BAK_SUFFIX), false, "被排除的补丁还留了 bak");
  assert.equal(fs.readFileSync(prunerFile, "utf8").includes(MARKER_19), false, "标记被写进去了");
});

test("对照组：同一棵树、未排除时照常打上", async () => {
  seed();
  const report = await applyPatches(aiBase, [patch19], { dshHome: plainHome });
  const row = report.find((r) => r.patch_id === 19);
  assert.ok(row, "未排除时必须出现报告行");
  assert.equal(row.applied, 1);
  assert.ok(fs.readFileSync(prunerFile, "utf8").includes(MARKER_19), "未排除却没打上");
});

test("混合：只剔除 #19，同批的 #1 照打", async () => {
  seed();
  const report = await applyPatches(aiBase, [patch19, patch1], { dshHome: exclHome });
  assert.equal(report.length, 1, "报告条数必须等于生效补丁条数：" + JSON.stringify(report));
  assert.equal(report[0].patch_id, 1, "#1 被连坐了");
  assert.equal(report[0].applied, 1);
  assert.equal(fs.readFileSync(prunerFile).length, PRUNER_ORIGINAL.length, "#19 仍被改了");
  assert.ok(!fs.readFileSync(prunerFile, "utf8").includes(MARKER_19));
  const instructions = fs.readFileSync(instructionsFile, "utf8");
  assert.ok(!instructions.includes(instructionsRep.pattern), "#1 没打上");
  assert.ok(instructions.includes(instructionsRep.replace), "#1 的替换文本不在");
});

test("启动自愈那条路（不传 options.dshHome）也吃 DSH_HOME 的排除清单", async () => {
  seed();
  const before = fs.readFileSync(prunerFile);
  process.env.DSH_HOME = exclHome;
  try {
    const report = await applyPatches(aiBase, [patch19]);
    assert.deepEqual(report, [], "默认 dshHome 没读排除清单：" + JSON.stringify(report));
    assert.ok(fs.readFileSync(prunerFile).equals(before), "默认路径仍然写了盘");
    assert.equal(fs.existsSync(prunerFile + BAK_SUFFIX), false);
  } finally {
    process.env.DSH_HOME = plainHome;
  }
});

test("显式 { includeExcluded: true } 才连排除项一起打", async () => {
  seed();
  const report = await applyPatches(aiBase, [patch19], { dshHome: exclHome, includeExcluded: true });
  const row = report.find((r) => r.patch_id === 19);
  assert.ok(row, "显式放开时还是被过滤了");
  assert.equal(row.applied, 1);
  assert.ok(fs.readFileSync(prunerFile, "utf8").includes(MARKER_19));
});

test("清单写坏了 → 按没排除处理（既有语义不回归）", async () => {
  seed();
  const report = await applyPatches(aiBase, [patch19], { dshHome: badHome });
  const row = report.find((r) => r.patch_id === 19);
  assert.ok(row, "清单坏了就该当没排除，不许少贴");
  assert.equal(row.applied, 1);
  assert.ok(fs.readFileSync(prunerFile, "utf8").includes(MARKER_19));
});
