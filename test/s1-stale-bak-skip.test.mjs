import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// S1/A2：reapply 之前的"刷新过期 bak"是死代码（apply 默认 false，一个字节都不写），
// 而调用方把它当"已刷新"打完日志就 revertAll —— 旧 bak 照样覆盖新宿主。
// 现在改成"认出来的这批不回滚"。本文件同时钉住旧行为有多危险（最后一条用例）。

const root = fs.mkdtempSync(path.join(os.tmpdir(), "dshpurge-stalebak-"));
process.env.DSH_HOME = path.join(root, "home");
fs.mkdirSync(process.env.DSH_HOME, { recursive: true });

const aiBase = path.join(root, "ai");
const target = path.join(aiBase, "dsh-agent-instructions", "lib", "index.js");
const bak = target + ".dshpurge.bak";

const core = await import("../lib/core.js");
const { staleBakSkipSet } = await import("../lib/reapply.js");

const rep = core.ALL_PATCHES.find((p) => p.id === 1).replacements[0];
// 现网 = 官方新版，没有任何 dsh-purge 痕迹；bak = 上一版（DSH 自升级后的典型现场）
const CURRENT = "// fixture header\n" + rep.pattern + "\nmodule.exports = {};\n";
const STALE = "// fixture header\n// 0.2.1 那一版的旧实现\nmodule.exports = {};\n";

const lower = (p) => path.resolve(p).toLowerCase();
const has = (list, fp) => (list || []).some((p) => lower(p) === lower(fp));

function fresh() {
  fs.rmSync(aiBase, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, CURRENT);
  fs.writeFileSync(bak, STALE);
}

test.after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

test("S1/A2 · refreshStaleBaksForUpgrade 认得出的过期 bak，staleBakSkipSet 必须点名它", () => {
  fresh();
  const refreshed = core.refreshStaleBaksForUpgrade(aiBase);
  assert.ok(has(refreshed, target), "判据没认出过期 bak：" + JSON.stringify(refreshed));

  const skip = staleBakSkipSet(aiBase);
  assert.ok(skip.has(path.resolve(target)), "skip 集合没带规范路径：" + JSON.stringify([...skip]));
});

test("S1/A2 · 拿这批路径当 skipPaths：revertAll 不碰现网，记进 staleBak 而不是 reverted", async () => {
  fresh();
  const skip = staleBakSkipSet(aiBase);

  const r = await core.revertAll(aiBase, { skipPaths: skip });

  assert.ok(has(r.staleBak, target), "没进 staleBak：" + JSON.stringify(r.staleBak));
  assert.equal(r.reverted.length, 0, "过期 bak 不该被当成回滚依据");
  assert.equal(fs.readFileSync(target, "utf8"), CURRENT, "现网被旧版覆盖了");
  assert.ok(fs.existsSync(bak), "跳过不代表删 bak");
});

test("S1/A2 · 对照：不给 skipPaths 时旧 bak 会把新版宿主写回去（这条防线真的有用）", async () => {
  fresh();
  const r = await core.revertAll(aiBase);
  assert.ok(has(r.reverted, target), "对照组应该发生回滚：" + JSON.stringify(r));
  assert.equal(fs.readFileSync(target, "utf8"), STALE, "没有拦住的现场就是'新旧混码'");
});

test("S1/A10 · inspectStaleBaks 的默认口径是'只报告不落盘'，只有显式 apply:true 才写 bak", () => {
  fresh();
  core.inspectStaleBaks(aiBase);
  assert.equal(fs.readFileSync(bak, "utf8"), STALE, "默认（apply:false）居然写了盘");

  const applied = core.inspectStaleBaks(aiBase, { apply: true });
  assert.ok(has(applied.refreshed, target), "apply:true 该刷这份 bak：" + JSON.stringify(applied.refreshed));
  assert.equal(fs.readFileSync(bak, "utf8"), CURRENT, "apply:true 没把 bak 刷到当前版本");
});

