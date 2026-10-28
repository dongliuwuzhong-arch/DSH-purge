import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// DSH_HOME 指向临时目录：findDshHome() 优先读这个环境变量，
// 所以整趟测试都不会碰到真的 ~/.dsh。
const root = fs.mkdtempSync(path.join(os.tmpdir(), "dshpurge-cycle-"));
process.env.DSH_HOME = path.join(root, "home");
fs.mkdirSync(process.env.DSH_HOME, { recursive: true });

const aiBase = path.join(root, "ai");
const target = path.join(aiBase, "dsh-agent-instructions", "lib", "index.js");
const bak = target + ".dshpurge.bak";

const {
  ALL_PATCHES,
  applyPatches,
  backupAll,
  revertAll,
  refreshStaleBaksForUpgrade,
  targetLooksPatched,
  // targetFilePairs 是按路径去重的那一层，多 key 同路径的回归就钉在这里。
  targetFilePairs,
} = await import("../lib/core.js");

const patch1 = ALL_PATCHES.find((p) => p.id === 1);
const rep = patch1.replacements[0];
const ORIGINAL = "// fixture header\n" + rep.pattern + "\nmodule.exports = {};\n";

function put(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
}

function freshFixture() {
  fs.rmSync(aiBase, { recursive: true, force: true });
  put(target, ORIGINAL);
}

const lower = (p) => path.resolve(p).toLowerCase();

test.after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

test("备份→打补丁→回滚：文件逐字节还原，bak 生命周期正确", async () => {
  freshFixture();
  const before = fs.readFileSync(target);

  const b = await backupAll(aiBase);
  assert.deepEqual(b.errors, []);
  assert.deepEqual(b.refused, []);
  assert.ok(b.made.some((p) => lower(p) === lower(bak)), "没有建 bak");
  assert.ok(fs.readFileSync(bak).equals(before), "bak 与原文不一致");

  const report = await applyPatches(aiBase, [patch1]);
  const row = report.find((r) => r.patch_id === 1);
  assert.ok(row, "补丁 #1 没有出现在报告里");
  assert.equal(row.applied, 1);
  const patched = fs.readFileSync(target, "utf8");
  assert.ok(!patched.includes(rep.pattern), "原文还在，补丁没打上");
  assert.ok(patched.includes(rep.replace), "替换文本不在");
  assert.equal(targetLooksPatched(patched, "agent-instructions"), true);
  assert.ok(fs.readFileSync(bak).equals(before), "apply 不该动 bak");

  const back = await revertAll(aiBase);
  assert.deepEqual(back.errors, []);
  assert.ok(back.reverted.some((p) => lower(p) === lower(target)), "没走回滚分支：" + JSON.stringify(back));
  assert.ok(fs.readFileSync(target).equals(before), "回滚后与原始字节不一致");
  assert.equal(fs.existsSync(bak), false, "回滚后 bak 应该被删掉");
});

test("重复 apply 是幂等的，且不会覆盖 bak", async () => {
  freshFixture();
  await backupAll(aiBase);
  await applyPatches(aiBase, [patch1]);
  const bakBytes = fs.readFileSync(bak);
  const once = fs.readFileSync(target);

  const again = await applyPatches(aiBase, [patch1]);
  const row = again.find((r) => r.patch_id === 1);
  assert.equal(row.applied, 0);
  assert.ok(fs.readFileSync(target).equals(once), "第二遍 apply 又改了文件");
  assert.ok(fs.readFileSync(bak).equals(bakBytes), "第二遍 apply 动了 bak");
});

test("现网已带补丁痕迹时 backupAll 拒建假原件", async () => {
  fs.rmSync(aiBase, { recursive: true, force: true });
  put(target, "// fixture header\n" + rep.replace + "\nmodule.exports = {};\n");
  const b = await backupAll(aiBase);
  assert.ok(b.refused.some((p) => lower(p) === lower(target)), "假原件没被拒：" + JSON.stringify(b));
  assert.equal(fs.existsSync(bak), false, "拒建时不该留下 bak");
});

test("假升级：现网换了内容且无补丁痕迹 → bak 刷新到新内容", async () => {
  fs.rmSync(aiBase, { recursive: true, force: true });
  put(bak, "// host 0.2.1 baseline\nmodule.exports = { v: 1 };\n");
  put(target, "// host 0.2.2 upgraded\nmodule.exports = { v: 2 };\n");
  assert.equal(targetLooksPatched(fs.readFileSync(target, "utf8"), "agent-instructions"), false);

  const refreshed = refreshStaleBaksForUpgrade(aiBase);
  assert.ok(refreshed.some((p) => lower(p) === lower(target)), "没有识别为过期 bak");
  assert.ok(fs.readFileSync(bak).equals(fs.readFileSync(target)), "bak 没刷新到现网内容");
});

test("同一文件挂在两个 file key 下：bak 只建一份，回滚不报假缺口", async () => {
  // dsh-web-app/presets/standard.patch.yml 同时挂在 agent-preset（#4）与
  // preset-standard（#24/#43/#63）下。以前 targetFilePairs 纯展开不去重，
  // revertAll 第一条把 bak 消耗掉，第二条就报 noBackup —— 假的「丢了备份」。
  fs.rmSync(aiBase, { recursive: true, force: true });
  const dual = path.join(aiBase, "dsh-web-app", "presets", "standard.patch.yml");
  const original = "presets:\n  standard:\n    prefix: You are a coding agent powered by the {{model}} model.\n";
  put(dual, original);

  const files = { "agent-preset": dual, "preset-standard": [dual] };
  const pairs = targetFilePairs(files);
  assert.equal(pairs.length, 1, "同一个路径被摊成了多条：" + JSON.stringify(pairs));
  assert.deepEqual(pairs[0].keys, ["agent-preset", "preset-standard"], "keys 没合并");

  const b = await backupAll(aiBase);
  assert.deepEqual(b.errors, []);
  assert.equal(fs.existsSync(dual + ".dshpurge.bak"), true, "没有建 bak");

  // 让 live 与 bak 不同，才走得到 copyFile 那条回滚分支（这条测的是去重，不是补丁内容）。
  put(dual, "presets:\n  standard:\n    prefix: \"\"\n");

  const back = await revertAll(aiBase);
  assert.deepEqual(back.errors, []);
  assert.deepEqual(back.noBackup, [], "报了假的 noBackup：" + JSON.stringify(back.noBackup));
  assert.ok(back.reverted.some((p) => lower(p) === lower(dual)), "没走回滚分支：" + JSON.stringify(back));
  assert.equal(fs.readFileSync(dual, "utf8"), original, "回滚后与原始内容不一致");
  assert.equal(fs.existsSync(dual + ".dshpurge.bak"), false, "回滚后 bak 应该被删掉");
});

test("假升级：现网仍是我们打过的版本 → bak 保持原样（不污染干净备份）", async () => {
  freshFixture();
  await backupAll(aiBase);
  await applyPatches(aiBase, [patch1]);
  const bakBytes = fs.readFileSync(bak);

  const refreshed = refreshStaleBaksForUpgrade(aiBase);
  assert.deepEqual(refreshed, [], "已打补丁的现网被当成过期了");
  assert.ok(fs.readFileSync(bak).equals(bakBytes), "干净 bak 被覆盖成了补丁后的内容");
});
