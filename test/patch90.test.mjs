import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ALL_PATCHES, applyReplacementsToText } from "../lib/core.js";

// #90 要改的是宿主里 126 KB 的适配器，不能整个 import（会拉起 pi-ai 的依赖树）。
// 这里只把它自己的 mapStopReason 抠出来，配上最小桩，直接验判据行为。
const PATCH = ALL_PATCHES.find((p) => p.id === 90);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 补丁表里的 pattern 只是 `case "stop":` 这一段，不是整个函数。
 * 给它套一个最小 switch 外壳，才能当真正的 mapStopReason 跑起来 ——
 * 顺带也证明了「成品能塞进 switch 里」这件事本身（#90 把 case 改成了块作用域）。
 */
function wrapAsMapper(caseBlock) {
  return (
    "function mapStopReason(message, contextWindow) {\n" +
    "\tswitch (message.stopReason) {\n" +
    caseBlock +
    "\n\t}\n}"
  );
}

/** 用桩把切出来的函数变成可调用的。 */
function buildMapper(source) {
  const stubs = [
    "const CONTEXT_WINDOW_EXCEEDED_CODE = 'CONTEXT_WINDOW_EXCEEDED';",
    "const EMPTY_RESPONSE_CODE = 'EMPTY_RESPONSE';",
    "function isContextOverflow() { return false; }",
    "function isContextWindowExceededError() { return false; }",
  ].join("\n");
  return new Function(stubs + "\n" + source + "\nreturn mapStopReason;")();
}

// 打补丁前后的两份源码：原文取自补丁表的 pattern，成品直接对它 apply。
const pristine = PATCH.replacements[0].pattern;
const patched = applyReplacementsToText(pristine, PATCH, "index.js").text;

test("#90 打上之后 mapStopReason 仍然可解析", () => {
  const body = wrapAsMapper(patched);
  assert.ok(body.includes("[dsh-purge-90]"), "成品里没有 marker");
  const fn = buildMapper(body);
  assert.equal(typeof fn, "function");
});

test("#90 打上之后语法成立：case 块被完整包住", () => {
  assert.ok(patched.includes('case "stop": {'));
  assert.ok(patched.trimEnd().endsWith("}") || patched.includes('\n\t\t}'));
  // 成品再打一次不应该有变化
  assert.equal(applyReplacementsToText(patched, PATCH, "index.js").changed, false);
});

// 六种情形逐条验，判据来自 knowledge/ops/宿主空回合判定补丁.md 第四节。
const cases = [
  { name: "正常文字回复", content: [{ type: "text", text: "答案" }], want: "stop" },
  { name: "只有思考（吞句）", content: [{ type: "thinking", thinking: "想完了但没写" }], want: "EMPTY_RESPONSE" },
  { name: "只有工具调用", content: [{ type: "toolCall", name: "read" }], want: "stop" },
  { name: "思考+工具", content: [{ type: "thinking", thinking: "想" }, { type: "toolCall", name: "read" }], want: "stop" },
  { name: "完全空", content: [], want: "EMPTY_RESPONSE" },
  { name: "思考+空白正文", content: [{ type: "thinking", thinking: "想" }, { type: "text", text: "   " }], want: "EMPTY_RESPONSE" },
  { name: "reasoning 别名（上游改名兜底）", content: [{ type: "reasoning", text: "想" }], want: "EMPTY_RESPONSE" },
  { name: "tool-call 别名（上游改名兜底）", content: [{ type: "tool-call", name: "read" }], want: "stop" },
];

for (const c of cases) {
  test("#90 判据：" + c.name + " → " + c.want, () => {
    const fn = buildMapper(wrapAsMapper(patched));
    const reason = fn({ stopReason: "stop", content: c.content, model: "test-model" }, 128000);
    if (c.want === "stop") assert.equal(reason.kind, "stop");
    else {
      assert.equal(reason.kind, "error");
      assert.equal(reason.failure.code, c.want);
    }
  });
}

test("#90 对照：官方原版对「只有思考」判成正常结束（这正是要修的）", () => {
  const fn = buildMapper(wrapAsMapper(pristine));
  const reason = fn({ stopReason: "stop", content: [{ type: "thinking", thinking: "想" }], model: "m" }, 128000);
  assert.equal(reason.kind, "stop");
});

test("#90 对照：官方原版对空 content 已经判 EMPTY_RESPONSE（不是新加的）", () => {
  const fn = buildMapper(wrapAsMapper(pristine));
  const reason = fn({ stopReason: "stop", content: [], model: "m" }, 128000);
  assert.equal(reason.failure.code, "EMPTY_RESPONSE");
});

test("#90 marker 认旧手打标记，避免二次叠加", () => {
  assert.equal(PATCH.markersAny, true);
  assert.ok(PATCH.markers.includes("[dsh-purge-90]"));
  assert.ok(PATCH.markers.includes("[dsh-fix 2026-11-01]"));
  // 手工打过的那份再 apply 必须是空转
  const handwritten = PATCH.replacements[0].replace;
  assert.equal(applyReplacementsToText(handwritten, PATCH, "index.js").changed, false);
});

test("#90 补丁挂在 llm-pi-ai 上，不是 pi-ai-* 上游库", () => {
  assert.deepEqual(PATCH.file, ["llm-pi-ai"]);
  assert.equal(PATCH.optional, true);
  assert.equal(PATCH.skipIfMarked, true);
});
