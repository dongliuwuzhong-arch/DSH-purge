import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  applyChainStatus, bucketPatches, chainDryRun, chainTargetFiles, classifyShellPatches,
  computeDrift, exitVerdict, renderReport, summarizeCounts,
} from "../scripts/preflight-upgrade.mjs";
import { ALL_PATCHES, patchFileOutcome } from "../lib/core.js";

// C1 · 2026-11-16：预检的链式判定。
//
// 背景（rc.5 实测）：预检报 drift = #24 #46 #71 #84 #91 #101，但其中四条是**二段补丁**——
// #46 的锚点由 #45 插入、#84 由 #83 插入、#91 由 #83 插入、#101 由 #87 插入。
// 1.5（V15 补丁表）：#46 已移出主表（冷存进 patches-legacy.js），本组用例的"二段补丁"
// 主体改用 #91 ← #83（同一条实证链，仍在主表）。
// 逐条独立判定时它们在 pristine 树上必然 skipped，于是整批被当成"模式对不上"。
//
// 这组用例锁三件事：
//   ①二段补丁在链上能贴（而且依赖是实证出来的，不是 last-writer）；
//   ②链上仍贴不上、又不是 profile 专属的 → 照旧报"要重锚"（真坏不许被吞）；
//   ③profile 专属目标（key 在候选树里不存在）→ profile 提供，不进漂移。

const root = fs.mkdtempSync(path.join(os.tmpdir(), "dshpurge-preflight-chain-"));
test.after(() => { fs.rmSync(root, { recursive: true, force: true }); });

const byId = (id) => ALL_PATCHES.find((p) => p.id === id);
const rep0 = (id, i = 0) => byId(id).replacements[i].pattern;
const ids = (list) => list.map((p) => p.id).sort((a, b) => a - b);

/** 把一段文本落成候选树里的一个目标文件，返回 {files, fp}。 */
function target(name, text, key = "desktop-shell") {
  const fp = path.join(root, name);
  fs.writeFileSync(fp, text, "utf8");
  return { fp, files: { [key]: fp } };
}

/** 真实桌面壳的 pristine 片段：#45 的两个锚点 + #83 的锚点块。 */
function shellText({ breakHandoff = false, breakShell = false } = {}) {
  return [
    "var DesktopUpdateCoordinator = class {",
    "\tconstructor(app) {",
    "\t\tchild.once(\"error\", () => {});",
    breakShell ? rep0(83).replace(/^\s*/, "\t\t// moved: ") : rep0(83),
    "\t}",
    "\tapplyUpdate() {",
    "\t\t\t\tthis.updater.quitAndInstall(true, true);",
    "\t}",
    "};",
  ].join("\n").replace(
    "var DesktopUpdateCoordinator = class {",
    breakHandoff ? "var DesktopUpdateCoordinatorBroken = class {" : "var DesktopUpdateCoordinator = class {",
  );
}

/** main() 里那一步的等价物：单文件上逐条问结论，得到 status 底稿。 */
function baseStatus(patches, text, fp) {
  const status = {};
  for (const p of patches) status[p.id] = patchFileOutcome(text, p, fp);
  return status;
}

test("二段补丁：#91 在原始文本上贴不上，链上能贴，依赖实证到 #83", () => {
  const patches = [byId(45), byId(83), byId(84), byId(91)];
  const text = shellText();
  const { fp, files } = target("chain-91-main.js", text);

  // 孤立判定：pristine 树上 #91 就是 skipped —— 旧版预检的"漂移"正是这么来的。
  assert.equal(patchFileOutcome(text, byId(91), fp), "skipped");

  const chain = chainDryRun(patches, chainTargetFiles(files));
  const rec = chain.get(91);
  assert.notEqual(rec.verdict, "skipped", "#91 链上必须贴得上，实际 " + rec.verdict);
  assert.equal(rec.chainOnly, true, "#91 是二段补丁，chainOnly 必须为真");
  assert.deepEqual(rec.deps, [83], "#91 的锚点由 #83 插入，依赖必须指到 #83");
});

test("二段补丁：#84 / #91 都靠 #83 插入的锚点，依赖不许记成 last-writer", () => {
  const patches = [byId(45), byId(83), byId(84), byId(91)];
  const { fp, files } = target("chain-83-main.js", shellText());
  const chain = chainDryRun(patches, chainTargetFiles(files));

  for (const id of [84, 91]) {
    const rec = chain.get(id);
    assert.notEqual(rec.verdict, "skipped", "#" + id + " 链上必须贴得上，实际 " + rec.verdict);
    assert.deepEqual(rec.deps, [83],
      "#" + id + " 的直接前序是 #83；记成 last-writer（#84）就说明依赖判定退化了");
  }
  // #84 会改写同一块文本，所以 #91 的 last-writer 其实是 #84——两者的区别就是本用例的价值。
  assert.equal(patchFileOutcome(shellText(), byId(91), fp), "skipped");
});

test("真坏：前序锚点被改掉 → 链上仍 skipped，不进 chainOnly、不编依赖", () => {
  const patches = [byId(45), byId(83), byId(84), byId(91)];
  const { files } = target("chain-broken-main.js", shellText({ breakHandoff: true, breakShell: true }));
  const chain = chainDryRun(patches, chainTargetFiles(files));
  const rec = chain.get(91);
  assert.equal(rec.verdict, "skipped", "#83 插不进锚点时 #91 就该老老实实 skipped");
  assert.equal(rec.chainOnly, false);
  assert.deepEqual(rec.deps, []);
  assert.deepEqual(rec.absentKeys, [], "目标文件在树里，不许被说成 profile 专属");
});

test("真坏仍报「要重锚」：链上贴不上、没有 profile key 的留在 skipped", () => {
  const anchor = "function dshChainHelper() {\n\treturn 1;\n}";
  const dep = {
    id: 900, name: "FAKE_INSERT_ANCHOR", file: "fake", optional: false,
    replacements: [{ pattern: "var FakeHost = class {", replace: anchor + "\nvar FakeHost = class {" }],
    markers: ["function dshChainHelper"],
  };
  const dependent = {
    id: 901, name: "FAKE_SECOND_STAGE", file: "fake", optional: false,
    replacements: [{ pattern: anchor, replace: anchor + " // [dsh-purge] second stage" }],
    markers: ["[dsh-purge] second stage"],
  };
  const patches = [dep, dependent];

  // ①锚点在前序补丁里 → 二段补丁成立
  const good = target("fake-good.js", "var FakeHost = class {\n};", "fake");
  const treeGood = chainDryRun(patches, good.files);
  assert.equal(treeGood.get(901).verdict, "pending");
  assert.equal(treeGood.get(901).chainOnly, true);
  assert.deepEqual(treeGood.get(901).deps, [900]);

  const statusGood = baseStatus(patches, fs.readFileSync(good.fp, "utf8"), good.fp);
  const mergedGood = applyChainStatus({ status: statusGood, chain: treeGood, patches });
  assert.equal(statusGood[901], "pending", "链上可贴 → 记待贴（装的时候会打上）");
  assert.deepEqual(mergedGood.chainRescued.map((r) => r.id), [901]);
  assert.deepEqual(mergedGood.profileProvided, []);

  // ②前序补丁的锚点不在（真坏）→ 两条都必须留在 skipped，且报"要重锚"
  const bad = target("fake-bad.js", "var FakeOther = class {\n};", "fake");
  const treeBad = chainDryRun(patches, bad.files);
  assert.equal(treeBad.get(901).verdict, "skipped");
  const statusBad = baseStatus(patches, fs.readFileSync(bad.fp, "utf8"), bad.fp);
  const mergedBad = applyChainStatus({ status: statusBad, chain: treeBad, patches });
  assert.deepEqual([statusBad[900], statusBad[901]], ["skipped", "skipped"]);
  assert.deepEqual(mergedBad.chainRescued, [], "贴不上就不许记成链上可贴");
  assert.deepEqual(mergedBad.profileProvided, [], "目标文件在树里，不许推给 profile");

  const buckets = bucketPatches(patches, statusBad);
  assert.deepEqual(ids(buckets.skipped), [900, 901]);
  const { lines, verdict } = renderReport({ aiBase: "X", target: "t", versions: {}, buckets, patchCount: 2, files: bad.files });
  assert.ok(lines.some((l) => l.includes("⚠ 模式对不上、要重锚")), "真坏必须报要重锚：" + JSON.stringify(lines));
  assert.equal(verdict.code, 2);
  assert.ok(lines[lines.length - 1].includes("要处理"), lines[lines.length - 1]);
});

test("链上可贴会在报告里单独成段，并写清依赖", () => {
  const { lines } = renderReport({
    aiBase: "X", target: "t", versions: {},
    buckets: { applied: [], pending: [], skipped: [], na: [], missing: [], excluded: [] },
    patchCount: 0,
    chainRescued: [{ id: 91, name: "DESKTOP_HOST_CLOSE_NO_FATAL", verdict: "applied", deps: [83] }],
  });
  const line = lines.find((l) => l.includes("链上可贴"));
  assert.ok(line, "链上可贴必须单独成段：" + JSON.stringify(lines));
  assert.ok(lines.some((l) => l.includes("#91 ← #83")), "依赖要写清：" + JSON.stringify(lines));
});

test("profile 提供：key 在候选树里不存在 → missing 桶 + 明说 profile 提供，不算坏", () => {
  const patch = {
    id: 902, name: "FAKE_PROFILE_ONLY", file: ["preset-not-here"],
    replacements: [{ pattern: "fetch: false", replace: "fetch: true" }],
    markers: ["fetch: true"],
  };
  const chain = chainDryRun([patch], {}); // 这棵树里没有任何目标文件
  assert.equal(chain.get(902).verdict, "profile");
  assert.deepEqual(chain.get(902).absentKeys, ["preset-not-here"]);

  const status = { 902: "missing_file" };
  const merged = applyChainStatus({ status, chain, patches: [patch] });
  assert.equal(status[902], "missing", "profile 专属目标归 missing 桶");
  assert.deepEqual(merged.profileProvided.map((r) => r.id), [902]);

  const buckets = bucketPatches([patch], status);
  const { lines, verdict } = renderReport({
    aiBase: "X", target: "t", versions: {}, buckets, patchCount: 1, profileProvided: merged.profileProvided,
  });
  assert.ok(lines.some((l) => l.includes("profile 提供")), "必须明写 profile 提供：" + JSON.stringify(lines));
  assert.ok(!lines.some((l) => l.includes("⚠ 模式对不上、要重锚")),
    "profile 提供不许报成要重锚：" + JSON.stringify(lines));
  assert.ok(!lines.some((l) => l.includes("相对基线漂移")), "profile 提供也不许进漂移段：" + JSON.stringify(lines));
  assert.equal(verdict.code, 0, "profile 提供不算坏，退出码必须 0");
});

test("profile 提供：树内 key 也贴不上时，报告要点名那几个 key（不许悄悄吞）", () => {
  const mixed = {
    id: 903, name: "FAKE_MIXED", file: ["preset-in-tree", "preset-profile"],
    replacements: [{ pattern: "fake-fetch: false", replace: "fake-fetch: true // [dsh-purge] fake" }],
    markers: ["[dsh-purge] fake"],
  };
  const { files } = target("preset-in-tree.yml", "- fake-web:\n    fake-fetch: true\n", "preset-in-tree");
  const chain = chainDryRun([mixed], files);
  const rec = chain.get(903);
  assert.equal(rec.verdict, "skipped");
  assert.deepEqual(rec.absentKeys, ["preset-profile"]);
  assert.deepEqual(rec.skippedKeys, ["preset-in-tree"]);

  const status = { 903: "skipped" };
  const merged = applyChainStatus({ status, chain, patches: [mixed] });
  assert.equal(status[903], "missing");
  const buckets = bucketPatches([mixed], status);
  const { lines } = renderReport({
    aiBase: "X", target: "t", versions: {}, buckets, patchCount: 1, profileProvided: merged.profileProvided,
  });
  const line = lines.find((l) => l.includes("#903"));
  assert.ok(line && line.includes("preset-in-tree"), "树内贴不上的 key 必须点名：" + JSON.stringify(lines));
});

test("na（这套 surface 不适用）不被链式判定改写", () => {
  const patch = { id: 904, name: "FAKE_NA", file: ["nope"], surfaces: ["tui"], replacements: [] };
  const status = { 904: "na" };
  const merged = applyChainStatus({ status, chain: chainDryRun([patch], {}), patches: [patch] });
  assert.equal(status[904], "na");
  assert.deepEqual(merged.profileProvided, []);
});

test("退出码：profile 提供不计漂移，但必须单独列出来", () => {
  const patch = (id) => ({ id, name: "P" + id, file: "core" });
  const buckets = {
    applied: [], pending: [], skipped: [], na: [], missing: [patch(71), patch(24)], excluded: [],
  };
  const baseline = { applied: [24, 71, 12], skipped: [] };
  assert.deepEqual(computeDrift(buckets, [], baseline), [24, 71], "不豁免时这两条就是漂移");
  assert.deepEqual(computeDrift(buckets, [], baseline, [24, 71]), [], "豁免之后不留残余");
  const v = exitVerdict({ buckets, baseline, profileIds: [24, 71] });
  assert.deepEqual(v.drift, []);
  assert.deepEqual(v.profileDrift, [24, 71], "被豁免的那部分要单独看得见");
  assert.equal(v.code, 0);
  // 真漂移照样拦：#12 不属于 profile
  assert.deepEqual(exitVerdict({ buckets: { ...buckets, missing: [patch(12)] }, baseline, profileIds: [24] }).drift, [12]);
});

test("链式判定不动文件：干跑前后候选树字节不变", () => {
  const text = shellText();
  const { fp, files } = target("readonly-main.js", text);
  chainDryRun([byId(45), byId(83), byId(84), byId(91)], chainTargetFiles(files));
  assert.equal(fs.readFileSync(fp, "utf8"), text, "预检只读，内存干跑不许落盘");
});

test("分桶对账：链式改写之后仍然 合计 + 排除 = 总数", () => {
  const patches = [byId(45), byId(83), byId(84), byId(91)];
  const { fp, files } = target("account-main.js", shellText());
  const chain = chainDryRun(patches, chainTargetFiles(files));
  const status = baseStatus(patches, fs.readFileSync(fp, "utf8"), fp);
  assert.equal(status[91], "skipped");
  applyChainStatus({ status, chain, patches });
  assert.notEqual(status[91], "skipped", "链上可贴 → 不再留在 skipped");
  const sum = summarizeCounts(bucketPatches(patches, status), patches.length);
  assert.ok(sum.balanced, "改写之后分桶必须仍然对得上：" + JSON.stringify(sum));
});
