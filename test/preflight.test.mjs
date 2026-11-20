import test from "node:test";
import assert from "node:assert/strict";

import {
  bucketPatches, classifyShellPatches, computeDrift, exitVerdict, renderReport,
  resolveShellMain, summarizeCounts,
} from "../scripts/preflight-upgrade.mjs";
import { ALL_PATCHES } from "../lib/core.js";

// 2026-11-16：桌面壳补丁（file: ["desktop-shell"]）在纯 node 里恒报 na ——
// officialShellMain() 要求 detectSurface()==="desktop"，子进程里永远不成立。
// 预检改成直接读候选树的壳入口自己判，classifyShellPatches 就是那条路。
//
// 同一批改动还锁三件审计点（S3 严重 5 / S4 ②.5 / S4 ②.7）：
//   · 无基线时 optional skipped 不能退 2；有基线时只看漂移；
//   · 摘要行五个桶都得打出来，并且合计 == 总数 - 排除；
//   · 漂移段落只许出现一处（旧版 rc.5 上同一批 id 打两遍）。

const shellPatches = ALL_PATCHES.filter((p) => [].concat(p.file ?? []).includes("desktop-shell"));
const patch = (id, extra = {}) => ({ id, name: "P" + id, file: "core", ...extra });
const ids = (list) => list.map((p) => p.id).sort((a, b) => a - b);
const bucketsOf = (over = {}) => ({
  applied: [], pending: [], skipped: [], na: [], missing: [], excluded: [], ...over,
});

test("壳补丁有条目（防止 file key 改名后静默失效）", () => {
  assert.ok(shellPatches.length >= 5, "桌面壳补丁应当有 5 条以上，实际 " + shellPatches.length);
});

// S4 ②.5：旧版这条是 assert.ok(pending + skipped === 总数)，六条全判成 skipped 也能过。
test("原文（未打补丁）→ #45 记为待贴，不是模式不匹配", () => {
  const original = "var DesktopUpdateCoordinator = class {\n\t\t\t\tthis.updater.quitAndInstall(true, true);\n};";
  const out = classifyShellPatches(original, shellPatches);
  assert.ok(ids(out.pending).includes(45),
    "原文还在 → #45 应当 pending，实际 " + JSON.stringify({ pending: ids(out.pending), skipped: ids(out.skipped) }));
  assert.ok(!ids(out.skipped).includes(45), "#45 不该被判成 skipped");
});

test("已经贴过的原文 → #45 记为 applied", () => {
  const patched = "function dshPurgeHandoffDesktopUpdate(owner) {\n\t/* dshPurgeHandoffDesktopUpdate(this) */\n}\n" +
    "var DesktopUpdateCoordinator = class {\n\t\t\t\tdshPurgeHandoffDesktopUpdate(this);\n};";
  const out = classifyShellPatches(patched, shellPatches);
  assert.ok(ids(out.applied).includes(45), "#45 有 marker → applied，实际 " + JSON.stringify(ids(out.applied)));
});

test("压根没有锚点的文本 → 该补丁是 skipped（对不上就是真的对不上）", () => {
  const out = classifyShellPatches("", [shellPatches.find((p) => p.id === 83)]);
  assert.deepEqual(ids(out.skipped), [83]);
});

test("壳入口不存在时返回空串（不抛）", () => {
  assert.equal(resolveShellMain("C:\\__definitely_not_here__"), "");
});

// S3 审计 S6 / S4 ②.7：被 exclude-patches.json 排掉的 id 不在 patchStatus 里，
// 旧版让它掉进 missing 桶（#19 就是这么被算成"缺文件"的）。
test("被 exclude 排掉的 id 不进 missing 桶", () => {
  const list = [patch(1), patch(19), patch(20)];
  const buckets = bucketPatches(list, { 1: "applied" }, new Set([19]));
  assert.deepEqual(ids(buckets.excluded), [19]);
  assert.deepEqual(ids(buckets.missing), [20], "只有真的没有结论的才进 missing");
  assert.equal(buckets.missing.length, 1);
});

// S4 ②.7：现网实测打出来是 applied 73 / pending 1 / skipped 4 / na 9，和是 87 ≠ 88。
test("五个桶 + 排除 = 补丁总数", () => {
  const list = [patch(1), patch(2, { optional: true }), patch(3), patch(4), patch(5)];
  const buckets = bucketPatches(list, { 1: "applied", 2: "skipped", 3: "na" }, new Set([5]));
  const sum = summarizeCounts(buckets, list.length);
  assert.deepEqual(
    [sum.applied, sum.pending, sum.skipped, sum.na, sum.missing, sum.excluded],
    [1, 0, 1, 1, 1, 1],
  );
  assert.equal(sum.counted, 4);
  assert.equal(sum.counted + sum.excluded, 5);
  assert.ok(sum.balanced, "五桶加起来必须等于总数 - 排除");
});

test("少打一个桶 → balanced 立刻是 false（87≠88 那种）", () => {
  const sum = summarizeCounts({
    applied: new Array(73).fill(patch(1)), pending: [patch(2)],
    skipped: [patch(3), patch(4), patch(5), patch(6)], na: new Array(9).fill(patch(7)),
    missing: [], excluded: [],
  }, 88);
  assert.equal(sum.counted, 87);
  assert.equal(sum.balanced, false, "87 ≠ 88 必须被认出来");
});

// S3 严重 5：现网这棵健康树（4 条 optional 跳过 + 9 条 na）旧版会退 2。
test("退出码：无基线时 optional skipped / na 不进退出码", () => {
  const buckets = bucketsOf({
    applied: [patch(1)],
    skipped: [patch(56, { optional: true }), patch(77, { optional: true })],
    na: [patch(28), patch(30)],
  });
  const v = exitVerdict({ buckets });
  assert.equal(v.code, 0, "健康的现网树不该退 2");
  assert.equal(v.mode, "no-baseline");
  assert.deepEqual(v.hard, []);
});

test("退出码：无基线时非 optional 的 skipped 才是 2", () => {
  const buckets = bucketsOf({ skipped: [patch(1), patch(56, { optional: true })] });
  const v = exitVerdict({ buckets });
  assert.equal(v.code, 2);
  assert.deepEqual(v.hard, [1]);
});

test("退出码：missing 默认不参与，显式 --strict-missing 才参与", () => {
  const buckets = bucketsOf({ missing: [patch(71)] });
  assert.equal(exitVerdict({ buckets }).code, 0);
  assert.equal(exitVerdict({ buckets, strictMissing: true }).code, 2);
});

test("退出码：有基线时只看漂移", () => {
  const buckets = bucketsOf({ skipped: [patch(9)] });
  assert.equal(exitVerdict({ buckets, baseline: { applied: [9], skipped: [] } }).code, 2, "基线里贴得上、这次 skipped = 漂移");
  assert.equal(exitVerdict({ buckets, baseline: { applied: [], skipped: [9] } }).code, 0, "基线里本来就跳过 → 不算漂移");
});

test("漂移：变成 na / 文件没了也算，不只看 skipped", () => {
  const buckets = bucketsOf({ na: [patch(10)], missing: [patch(11)] });
  const v = exitVerdict({ buckets, baseline: { applied: [10, 11, 12], skipped: [] } });
  assert.deepEqual(v.drift, [10, 11]);
  assert.equal(v.code, 2);
});

test("漂移：壳补丁的 skipped 也算（基线里记在 shellApplied）", () => {
  const shell = { applied: [], pending: [], skipped: [patch(83)] };
  const v = exitVerdict({
    buckets: bucketsOf(),
    shell,
    baseline: { applied: [], skipped: [], shellApplied: [83], shellSkipped: [] },
  });
  assert.deepEqual(v.drift, [83]);
});

test("computeDrift：没有基线就是空数组", () => {
  assert.deepEqual(computeDrift(bucketsOf({ skipped: [patch(1)] }), [], null), []);
});

test("摘要行把五个桶全打出来，并且当场对账", () => {
  const buckets = bucketsOf({
    applied: [patch(1)], pending: [patch(2)], skipped: [patch(3, { optional: true })],
    na: [patch(4)], missing: [patch(5)], excluded: [patch(6)],
  });
  const { lines, sum } = renderReport({ aiBase: "X", target: "t", versions: {}, buckets, patchCount: 6 });
  const line = lines.find((l) => l.startsWith("补丁 "));
  assert.ok(line, "摘要行必须存在：" + JSON.stringify(lines));
  for (const key of ["applied 1", "pending 1", "skipped 1", "na 1", "missing 1", "excluded 1"]) {
    assert.ok(line.includes(key), "摘要行缺 " + key + "： " + line);
  }
  assert.ok(line.includes("= 6 ✓"), "摘要行必须写出对账结果： " + line);
  assert.ok(sum.balanced);
  assert.equal(sum.counted, 5);
});

test("有基线时漂移段落只打一次", () => {
  const buckets = bucketsOf({ skipped: [patch(80, { optional: true })] });
  const { lines, verdict } = renderReport({
    aiBase: "X", target: "t", versions: {}, buckets, patchCount: 1,
    baseline: { version: "v", applied: [80], skipped: [] },
  });
  // S4 的抱怨是"同一批 id 打两遍"：只数出现 #80 的行。
  const idLines = lines.filter((l) => l.includes("#80"));
  assert.equal(idLines.length, 1, "漂移 id 只许出现一处，实际：" + JSON.stringify(idLines));
  assert.ok(idLines[0].includes("相对基线漂移"), idLines[0]);
  assert.ok(!lines.some((l) => l.includes("比基线多出来的")), "第二条漂移段落必须删掉：" + JSON.stringify(lines));
  assert.equal(lines.filter((l) => l.includes("相对基线")).length, 1, "基线段落只许一处");
  assert.equal(verdict.code, 2);
});

test("结论行与退出码一致", () => {
  const ok = renderReport({ buckets: bucketsOf({ skipped: [patch(1, { optional: true })] }), patchCount: 1 });
  assert.equal(ok.verdict.code, 0);
  assert.ok(ok.lines[ok.lines.length - 1].includes("可以换包"), ok.lines[ok.lines.length - 1]);
  const bad = renderReport({ buckets: bucketsOf({ skipped: [patch(1)] }), patchCount: 1 });
  assert.equal(bad.verdict.code, 2);
  assert.ok(bad.lines[bad.lines.length - 1].includes("要处理"), bad.lines[bad.lines.length - 1]);
});
