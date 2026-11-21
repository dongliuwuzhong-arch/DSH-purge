import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// 1.5：unmatched 进软失败表（F10 的第一刀）。
//
// 背景：同一个「原文对不上」在报告侧叫 pattern_not_found、在状态侧叫 unmatched。
// 1.4.4 的软失败表（ALWAYS_SOFT_STATUSES）不认 unmatched，patchStatusReady 里那两条
// 判 pattern_not_found 的分支又永远走不到 —— 于是面板上 unmatched 只能当硬失败显示。

const root = fs.mkdtempSync(path.join(os.tmpdir(), "purge-unmatched-soft-"));
process.env.DSH_HOME = path.join(root, "home");
fs.mkdirSync(process.env.DSH_HOME, { recursive: true });

const core = await import("../lib/core.js");

test.after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const ROW = { patch_id: 43, name: "strict-pattern", status: "unmatched", strictFiles: true };

test("isPatchResultSoftOk 认 unmatched（否则它会掉进 failed 桶）", () => {
  assert.equal(core.isPatchResultSoftOk(ROW), true);
});

test("summarizeApplyReport：unmatched 落 soft，不落 failed", () => {
  const summary = core.summarizeApplyReport([ROW], [{ id: 43, name: "strict-pattern", strictFiles: true }]);
  assert.equal(summary.failed.length, 0, "unmatched 不该算硬失败");
  assert.equal(summary.soft.length, 1);
});

test("真正的硬失败仍然硬（pattern_not_found + strictFiles）", () => {
  const hard = { patch_id: 43, name: "strict-pattern", status: "pattern_not_found" };
  assert.equal(core.isPatchResultSoftOk(hard, { id: 43, strictFiles: true }), false);
  assert.equal(core.isPatchResultSoftOk({ ...hard, status: "pending" }), false);
});

test("patchStatusReady 不再保留两条走不到的 pattern_not_found 分支", () => {
  // 状态侧的词表里没有 pattern_not_found（collectPatchStatus 只产出六桶），
  // 所以它一律 false —— 这条钉住「别再把它加回来」。
  assert.equal(core.patchStatusReady("pattern_not_found", { strictFiles: true }), false);
  assert.equal(core.patchStatusReady("pattern_not_found", { optional: true }), false);
  // 现有六桶的结论不变。
  assert.equal(core.patchStatusReady("applied"), true);
  assert.equal(core.patchStatusReady("skipped"), true);
  assert.equal(core.patchStatusReady("missing_file"), true);
  assert.equal(core.patchStatusReady("pending"), false);
  assert.equal(core.patchStatusReady("na"), false);
  // unmatched 是「软失败」，不是「已就绪」：列表不能把它算成没事。
  assert.equal(core.patchStatusReady("unmatched", { strictFiles: true }), false);
});

test("exclude 生效点是六个入口（注释数错会让人漏掉 gatherState）", () => {
  const src = fs.readFileSync(new URL("../lib/core.js", import.meta.url), "utf8");
  const at = src.indexOf("生效点（六个入口");
  assert.ok(at > 0, "readExcludePatches 的注释应写六个入口");
  const block = src.slice(at, at + 400);
  for (const entry of ["applyPatches", "applyPatchesAllHosts", "collectPatchStatus", "hookDenyPaths", "patchWatchedClientBundlesSync", "gatherState"]) {
    assert.ok(block.includes(entry), "注释里应当点名 " + entry);
  }
});
