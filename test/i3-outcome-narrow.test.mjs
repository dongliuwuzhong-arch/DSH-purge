import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// A10 §3.1 / §3.3 的三条判据钉死在这里（I3 判定收窄）：
//   ① satisfiedBy 只降级不升级：还留着非幂等 replacement 能改 → pending，不许报 applied
//   ② satisfiedBy 的 needle 必须锚 `- id: tool-web`：无关工具的 fetch: true 不许认
//   ③ applied / satisfied 拆成两档（明细口径），字符串口径向后兼容；scope:"none" fail-loud
//
// DSH_HOME 指向临时目录：findDshHome() 优先读它，整趟测试不碰真的 ~/.dsh。
const root = fs.mkdtempSync(path.join(os.tmpdir(), "dshpurge-i3-"));
process.env.DSH_HOME = path.join(root, "home");
fs.mkdirSync(process.env.DSH_HOME, { recursive: true });

const core = await import("../lib/core.js");
const {
  ALL_PATCHES, applyPatchesAllHosts, applyReplacementsToText, patchFileOutcome,
  patchFileOutcomeDetail, patchStatus, patchStatusDetail, patchStatusWithDetails, revertAllHosts,
} = core;

test.after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const P24 = ALL_PATCHES.find((p) => p.id === 24);
const MARKER = "[dsh-purge] preset fetch enabled";
const FP = "standard.patch.yml";

// rc.3 / rc.5 出厂 preset 的真实形态（10/12/14 缩进、fetch 已开、没有我们的注释）
const FACTORY = [
  "lowParallelInProgress: true",
  "          - id: tool-web",
  "            name: '@deepseek-ai/dsh-tool-web'",
  "            config:",
  "              fetch: true",
  "              searchTimeoutMs: 60000",
  "          - id: present",
  "",
].join("\n");

// liangshen / 0.1.x / 用户 unrestricted 的老形态：0 缩进、fetch: false
const OLD_INDENT = [
  "- id: tool-web",
  "  name: '@deepseek-ai/dsh-tool-web'",
  "  config:",
  "    fetch: false",
  "    searchTimeoutMs: 60000",
  "",
].join("\n");

test("反例 A（A10 §3.1）：出厂块与 0 缩进 fetch: false 同在一份文件 → 不许「报 applied 却还能改」", () => {
  const text = FACTORY + OLD_INDENT;
  // 前提：这份文件上确实还有活要干
  const applied = applyReplacementsToText(text, P24, FP);
  assert.equal(applied.changed, true, "前提不成立：这条 replacement 在这份原文上没活可干");

  const detail = patchFileOutcomeDetail(text, P24, FP);
  assert.equal(detail.state, "pending", "还有非幂等 replacement 能改，就必须如实报 pending");
  assert.notEqual(patchFileOutcome(text, P24, FP), "applied",
    "satisfiedBy 不许把「还有活没干」说成 applied");
});

test("反例 B（A10 §3.1）：无关工具在同一缩进写 fetch: true → 不许判 applied", () => {
  const text = [
    "          - id: other-tool",
    "            name: '@example/other-tool'",
    "            config:",
    "              fetch: true",
    "              searchTimeoutMs: 60000",
    "",
  ].join("\n");
  // 旧 needle 只写「14 空格 fetch: true + searchTimeoutMs」，这份文本会被认成做完
  assert.ok(P24.satisfiedBy.every((needle) => needle.includes("- id: tool-web")),
    "satisfiedBy 必须锚到 - id: tool-web，不能只认两行 fetch 配置：" + JSON.stringify(P24.satisfiedBy));
  assert.equal(patchFileOutcomeDetail(text, P24, FP).state, "skipped");
  assert.notEqual(patchFileOutcome(text, P24, FP), "applied");
});

test("satisfied 这一档：出厂整块（现网三份 preset 的形态）0/1 落地，不许冒充 applied", () => {
  const detail = patchFileOutcomeDetail(FACTORY, P24, FP);
  assert.deepEqual(detail, { state: "satisfied", landedMarkers: 0, declaredMarkers: 1 },
    "出厂原文已达标、我们一条痕迹都没写 → satisfied，不是 applied");
  // 字符串口径向后兼容：40+ 调用方 / 六桶 / preflight 都还按 applied 走
  assert.equal(patchFileOutcome(FACTORY, P24, FP), "applied", "字符串口径必须保持 applied");

  const once = applyReplacementsToText(FACTORY, P24, FP);
  assert.equal(once.changed, true);
  assert.ok(once.text.includes(MARKER));
  const after = patchFileOutcomeDetail(once.text, P24, FP);
  assert.equal(after.state, "applied", "痕迹落地之后不许再叫 satisfied");
  assert.equal(after.landedMarkers, 1);
  assert.equal(after.declaredMarkers, 1);
});

test("satisfied 这一档：出厂块 + 0 缩进 fetch: false 打完一轮之后只剩痕迹可补，也不许叫 applied", () => {
  // 老形态打完一轮：0 缩进块变成 fetch: true + 标记；出厂块仍然没有标记
  const oldDone = applyReplacementsToText(OLD_INDENT, P24, "agent.cordis.yml");
  assert.equal(oldDone.changed, true);
  const text = FACTORY + oldDone.text;
  assert.equal(patchFileOutcomeDetail(text, P24, FP).state, "applied",
    "这份文件里已经有我们的痕迹 → applied");
});

const aiBase = path.join(root, "host", "dsh", "node_modules", "@deepseek-ai");
const presetFile = path.join(aiBase, "dsh-web-app", "presets", "standard.patch.yml");
fs.mkdirSync(path.dirname(presetFile), { recursive: true });
fs.writeFileSync(presetFile, FACTORY, "utf8");

test("patchStatus 六桶口径逐字不变；patchStatusDetail 才带 satisfied 与落地率", async () => {
  const status = await patchStatus(aiBase, [P24], { dshHome: process.env.DSH_HOME });
  assert.equal(status[24], "applied", "六桶口径必须与改前一致（preflight / 面板都读它）");
  const detail = await patchStatusDetail(aiBase, [P24], { dshHome: process.env.DSH_HOME });
  assert.deepEqual(detail[24], { state: "satisfied", landedMarkers: 0, declaredMarkers: 1 });
});

test("patchStatusWithDetails 一趟扫描两条腿：与两个单口径 API 完全一致", async () => {
  const both = await patchStatusWithDetails(aiBase, [P24], { dshHome: process.env.DSH_HOME });
  const status = await patchStatus(aiBase, [P24], { dshHome: process.env.DSH_HOME });
  const detail = await patchStatusDetail(aiBase, [P24], { dshHome: process.env.DSH_HOME });
  assert.deepEqual(both.status, status);
  assert.deepEqual(both.details, detail);
});

test("scope:\"none\" 改 fail-loud：stderr 喊一声 + 非零 scopeError，不再静默空转", async () => {
  const errs = [];
  const orig = console.error;
  console.error = (...args) => { errs.push(args.join(" ")); };
  let apply;
  let revert;
  try {
    apply = await applyPatchesAllHosts([ALL_PATCHES[0]], { dshHome: process.env.DSH_HOME, log: () => {} });
    revert = await revertAllHosts({ dshHome: process.env.DSH_HOME, log: () => {} });
  } finally {
    console.error = orig;
  }
  // 安全默认不变：一个宿主都不碰
  assert.equal(apply.scope, "none");
  assert.deepEqual(apply.hostPaths, []);
  assert.equal(revert.hostPaths.length, 0);
  // 但空转必须带非零标记
  assert.equal(apply.scopeError.code, 2);
  assert.equal(apply.scopeError.id, "HOST_SCOPE_UNSPECIFIED");
  assert.equal(revert.scopeError.code, 2);
  assert.equal(errs.length, 2, "apply 与 revert 各要喊一声：" + JSON.stringify(errs));
  assert.ok(errs.every((line) => line.includes("未指定宿主范围")), JSON.stringify(errs));
});

test("给了显式 aiBase（哪怕解析不到）就不是范围缺失：scopeError 必须是 null", async () => {
  const ghost = path.join(root, "nohost", "dsh", "node_modules", "@deepseek-ai");
  const res = await applyPatchesAllHosts([ALL_PATCHES[0]], {
    aiBase: ghost, dshHome: process.env.DSH_HOME, log: () => {}, log_quiet: true,
  });
  assert.equal(res.scope, "explicit");
  assert.equal(res.scopeError, null);
  // 只允许打这一棵（空树），绝不许顺手摸到现网那棵
  assert.deepEqual(res.hostPaths.map((p) => p.toLowerCase()), [ghost.toLowerCase()]);
  assert.ok(res.hostPaths.every((p) => p.toLowerCase().startsWith(root.toLowerCase())), JSON.stringify(res.hostPaths));
});

test("无门槛的全宿主还原函数已删；启动/应用真正用的是单宿主版", () => {
  assert.ok(!("restoreMissingOriginalsAllHosts" in core),
    "零调用方 + 无 applyHostScope 门槛的死代码不许留着等它复活");
  assert.equal(typeof core.restoreMissingOriginalsFromBak, "function");
});
