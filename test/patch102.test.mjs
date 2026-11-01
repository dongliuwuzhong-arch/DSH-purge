import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ALL_PATCHES, applyReplacementsToText, targetLooksPatched } from "../lib/core.js";

// #90 要改的是宿主里 126 KB 的适配器，不能整个 import（会拉起 pi-ai 的依赖树）。
// 这里只把它自己的 mapStopReason 抠出来，配上最小桩，直接验判据行为。
const PATCH = ALL_PATCHES.find((p) => p.id === 102);
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
  assert.ok(body.includes("[dsh-purge-102]"), "成品里没有 marker");
  const fn = buildMapper(body);
  assert.equal(typeof fn, "function");
});

test("#90 打上之后语法成立：case 块被完整包住", () => {
  // 只断言「有开括号」是抓不到「块被套进第二个花括号」的——那正是这条补丁
  // 在已手打文件上二次叠加时的形态。所以按大括号配对真数一遍。
  const open = (patched.match(/\{/g) || []).length;
  const close = (patched.match(/\}/g) || []).length;
  assert.equal(open, close, "花括号不配对，说明块被套错了");
  // case "stop": 后面必须紧跟一个块，且这个块在同级上闭合
  assert.ok(patched.includes('case "stop": {'));
  assert.ok(!patched.includes('case "stop": {\n\t\t\tcase "stop":'), "出现了嵌套的 case stop");
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
  assert.ok(PATCH.markers.includes("[dsh-purge-102]"));
  assert.ok(PATCH.markers.includes("[dsh-fix 2026-11-01]"));

  // 关键：手打版和自动产物的标记不一样。手打那份只有 [dsh-fix 2026-11-01]，
  // 没有 dsh-purge 字样、没有原文 pattern、也没有 replace 的前 160 字符——
  // targetLooksPatched 的三级判据里只剩 marker 这一条能认出它。
  // 所以这里必须构造"只有手打标记"的样本，不能拿 replace 串冒充。
  const handwritten = PATCH.replacements[0].replace;
  assert.ok(handwritten.includes("[dsh-purge-102]"));
  assert.ok(!handwritten.includes("[dsh-fix 2026-11-01]"));

  const oldStyle = handwritten.split("[dsh-purge-102]").join("[dsh-fix 2026-11-01]");
  assert.ok(!oldStyle.includes("dsh-purge"), "旧标记样本里不该有 dsh-purge 字样");

  // 承重的是"认不认得出已打过"，不是"会不会重打"——原文 pattern 在产物里已经没了，
  // apply 当然是空转。真正会出事的是 targetLooksPatched 认不出它：
  // 那样 backupAll 会把已打补丁的版本当成干净原件存成 .dshpurge.bak，还原就失效了。
  assert.equal(targetLooksPatched(oldStyle, "llm-pi-ai"), true, "认双 marker 时必须能认出旧样本");

  // 反向对照：把 markers 缩成只认新标记，同一个旧样本就认不出来了。
  // targetLooksPatched 的 key 参数只能查表里的补丁，所以这里直接验判据本身：
  // markersAny + every/some 的语义就是"任一命中即算打过"。
  const newOnly = ["[dsh-purge-102]"];
  const hitUnder = (markers) => markers.some((m) => oldStyle.includes(m));
  assert.equal(hitUnder(newOnly), false, "只认新标记时，旧样本必须认不出来");
  assert.equal(hitUnder(PATCH.markers), true, "认双标记时，旧样本必须认得出");
});

test("#90 补丁挂在 llm-pi-ai 上，不是 pi-ai-* 上游库", () => {
  assert.deepEqual(PATCH.file, ["llm-pi-ai"]);
  assert.equal(PATCH.optional, true);
  assert.equal(PATCH.skipIfMarked, true);
});
