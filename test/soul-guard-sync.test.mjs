import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compareSlot, syncProblems } from "../scripts/assert-soul-guard.mjs";
import { openSlot } from "../lib/table-read.js";

// 2026-11-22（V15 工程 P0-1 / F-01）：soul-guard 以前只哈希 md，而运行时注入的是密封槽。
// 这门必须守"真正注入的字节"，所以同步检查本身要有能红的用例 —— 不然它只是又一层全绿。
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const MD = "第一行\n第二行\n第三行\n";

test("同步检查：源与槽完全一致 → 无问题、无提示", () => {
  const { problems, notices } = syncProblems(MD, MD, 0);
  assert.deepEqual(problems, []);
  assert.deepEqual(notices, []);
});

test("同步检查：只差行尾且差值记在基线里 → 放行，但要说出来", () => {
  const slot = MD.replace(/\n/g, "\r\n");
  const { problems, notices, sync } = syncProblems(MD, slot, -3);
  assert.deepEqual(problems, []);
  assert.equal(notices.length, 1);
  assert.equal(sync.eolDelta, -3);
});

test("同步检查：只差行尾但差值对不上基线（槽被单独动过）→ 红", () => {
  const slot = MD.replace(/\n/g, "\r\n");
  const { problems } = syncProblems(MD, slot, -2);
  assert.equal(problems.length, 1, JSON.stringify(problems));
  assert.match(problems[0], /不再是"已知的行尾差"/);
});

test("同步检查：正文差一个字（改了 md 没重跑 embed）→ 红", () => {
  const slot = MD.replace("第三行", "第三行（旧）");
  const { problems, sync } = syncProblems(MD, slot, 0);
  assert.equal(sync.contentEqual, false);
  assert.equal(problems.length, 1, JSON.stringify(problems));
  assert.match(problems[0], /注入的字节与源不同步/);
});

test("同步检查：槽解不出来（空）→ 红，且不能说成行尾问题", () => {
  const { problems } = syncProblems(MD, "", 0);
  assert.equal(problems.length, 1, JSON.stringify(problems));
  assert.match(problems[0], /密封槽解不出来/);
});

test("同步检查：源文件不在 → 红", () => {
  const { problems } = syncProblems(null, MD, 0);
  assert.equal(problems.length, 1, JSON.stringify(problems));
  assert.match(problems[0], /不在仓库里/);
});

test("compareSlot：行尾差只影响 identical，不影响 contentEqual", () => {
  const slot = MD.replace(/\n/g, "\r\n");
  const sync = compareSlot(MD, slot);
  assert.equal(sync.identical, false);
  assert.equal(sync.contentEqual, true);
  assert.equal(sync.firstDiff, 3, "首差是字符偏移（第 3 个字符处 md 是 \\n、槽是 \\r）");
});

test("真仓库现状：源 md 与运行时注入的槽同步（基线 eolDelta 与实测一致）", () => {
  const md = fs.readFileSync(path.join(ROOT, "lib", "default-prompt-inject.md"), "utf8");
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, "soul-guard.lock"), "utf8"));
  const { problems } = syncProblems(md, openSlot(), lock.eolDelta);
  assert.deepEqual(problems, [], "源与槽不同步：重跑 npm run embed-prompt 或查清谁动了槽");
  assert.ok(String(openSlot()).trim().length > 0, "槽解不出来 = 运行时注入空正文");
});
