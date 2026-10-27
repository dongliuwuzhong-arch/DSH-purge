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

const { ALL_PATCHES, applyPatches, backupAll, revertAll, refreshStaleBaksForUpgrade, targetLooksPatched } =
  await import("../lib/core.js");

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

test("假升级：现网仍是我们打过的版本 → bak 保持原样（不污染干净备份）", async () => {
  freshFixture();
  await backupAll(aiBase);
  await applyPatches(aiBase, [patch1]);
  const bakBytes = fs.readFileSync(bak);

  const refreshed = refreshStaleBaksForUpgrade(aiBase);
  assert.deepEqual(refreshed, [], "已打补丁的现网被当成过期了");
  assert.ok(fs.readFileSync(bak).equals(bakBytes), "干净 bak 被覆盖成了补丁后的内容");
});
