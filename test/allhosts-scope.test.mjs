import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// DSH_HOME 指向临时目录：findDshHome() 优先读它，整趟测试不碰真的 ~/.dsh。
const root = fs.mkdtempSync(path.join(os.tmpdir(), "dshpurge-allhosts-"));
process.env.DSH_HOME = path.join(root, "home");
fs.mkdirSync(process.env.DSH_HOME, { recursive: true });

const { ALL_PATCHES, applyPatchesAllHosts, revertAllHosts } = await import("../lib/core.js");

// 影子报告 2026-11-16 §4.1：applyPatchesAllHosts 无条件枚举宿主，沙箱里调用一次就把
// 现网 %INSTALL_DIR% 也列进 hosts 去写（围栏拦下 60 次越界写）。这里钉住新契约：
//   默认 = 只打 options.aiBase 明确传进来的那一棵；全宿主扫描必须显式 { allHosts: true }。

const patch1 = ALL_PATCHES.find((p) => p.id === 1);
const rep = patch1.replacements[0];
const ORIGINAL = "// fixture header\n" + rep.pattern + "\nmodule.exports = {};\n";

function makeHost(name) {
  const ai = path.join(root, name, "dsh", "node_modules", "@deepseek-ai");
  const target = path.join(ai, "dsh-agent-instructions", "lib", "index.js");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, ORIGINAL, "utf8");
  return { ai, target };
}

const hostA = makeHost("a");
const hostB = makeHost("b");

const lower = (p) => path.resolve(p).toLowerCase();
const read = (h) => fs.readFileSync(h.target, "utf8");
const isPatched = (h) => read(h) !== ORIGINAL;

test.after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function restore() {
  for (const h of [hostA, hostB]) {
    fs.writeFileSync(h.target, ORIGINAL, "utf8");
    fs.rmSync(h.target + ".dshpurge.bak", { force: true });
  }
}

test("不传 aiBase 时一个宿主都不打（沙箱/测试默认安全）", async () => {
  restore();
  process.env.DSH_BASE = hostB.ai; // 就算环境里能枚举到宿主，也不许自动开工
  const lines = [];
  const res = await applyPatchesAllHosts([patch1], {
    dshHome: process.env.DSH_HOME,
    log: (l) => lines.push(l),
  });
  assert.equal(res.scope, "none");
  assert.equal(res.allHosts, false);
  assert.deepEqual(res.hostPaths, []);
  assert.equal(res.hosts.length, 0);
  assert.ok(!isPatched(hostA), "A 不该被动");
  assert.ok(!isPatched(hostB), "B 不该被动");
  assert.ok(lines.some((l) => l.includes("allHosts: true")), "范围没打日志");
});

test("显式 aiBase：只打这一棵，旁边那棵一根手指都不碰", async () => {
  restore();
  process.env.DSH_BASE = hostB.ai;
  const lines = [];
  const res = await applyPatchesAllHosts([patch1], {
    aiBase: hostA.ai,
    dshHome: process.env.DSH_HOME,
    finishHost: false,
    log: (l) => lines.push(l),
  });
  assert.equal(res.scope, "explicit");
  assert.equal(res.hosts.length, 1);
  assert.equal(res.hostPaths.length, 1);
  assert.equal(lower(res.hostPaths[0]), lower(hostA.ai));
  assert.ok(isPatched(hostA), "显式指定的宿主应该被打上");
  assert.ok(!isPatched(hostB), "没指定的宿主不许出现在 hosts 里");
  assert.ok(lines.some((l) => l.includes(hostA.ai)), "宿主路径没有逐条打印");
});

test("allHosts: true 才枚举：合并报告带每个宿主的路径，并逐条打印", async () => {
  restore();
  const lines = [];
  const res = await applyPatchesAllHosts([patch1], {
    allHosts: true,
    enumerateHosts: () => [hostA.ai, hostB.ai], // 注入枚举：不去枚举真实宿主
    dshHome: process.env.DSH_HOME,
    finishHost: false,
    log: (l) => lines.push(l),
  });
  assert.equal(res.scope, "all");
  assert.equal(res.allHosts, true);
  assert.equal(res.hosts.length, 2);
  assert.deepEqual(res.hostPaths.map(lower), [lower(hostA.ai), lower(hostB.ai)]);
  assert.ok(isPatched(hostA) && isPatched(hostB), "全宿主模式两棵都该打上");
  for (const h of [hostA, hostB]) {
    assert.ok(lines.some((l) => l.includes(h.ai)), "缺宿主路径日志：" + h.ai);
  }
  assert.ok(res.report.length > 0, "合并报告为空");
});

test("revertAllHosts 同口径：默认不枚举宿主，显式 aiBase 只回滚这一棵", async () => {
  // 先在 A 上打一遍（带 bak），B 保持干净
  restore();
  await applyPatchesAllHosts([patch1], {
    aiBase: hostA.ai, dshHome: process.env.DSH_HOME, finishHost: false, quiet: true,
  });
  assert.ok(isPatched(hostA), "夹具前提：A 已打上");

  const none = await revertAllHosts({ dshHome: process.env.DSH_HOME, log: () => {} });
  assert.equal(none.hostPaths.length, 0, "不传 aiBase 时不许枚举任何宿主");
  assert.equal(none.reverted.length, 0);
  assert.ok(isPatched(hostA), "什么都没传就不该回滚");

  const one = await revertAllHosts({
    aiBase: hostA.ai, dshHome: process.env.DSH_HOME, log: () => {},
  });
  assert.deepEqual(one.hostPaths.map(lower), [lower(hostA.ai)]);
  assert.ok(one.reverted.length > 0, "显式宿主应该回滚");
  assert.ok(!isPatched(hostA), "A 应该回到原件");
  assert.ok(!isPatched(hostB), "B 自始至终没被碰");
});

test("allHosts: true 且显式给了 aiBase：显式那棵排在前、且不重复", async () => {
  restore();
  const res = await applyPatchesAllHosts([patch1], {
    aiBase: hostA.ai,
    allHosts: true,
    enumerateHosts: () => [hostB.ai],
    dshHome: process.env.DSH_HOME,
    finishHost: false,
    quiet: true,
  });
  assert.equal(res.hosts.length, 2);
  assert.deepEqual(res.hostPaths.map(lower), [lower(hostA.ai), lower(hostB.ai)]);
});
