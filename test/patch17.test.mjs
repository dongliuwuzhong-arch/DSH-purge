import test from "node:test";
import assert from "node:assert/strict";

import { ALL_PATCHES, applyReplacementsToText, patchFileOutcome } from "../lib/core.js";

// 2026-11-13 审计抓到的两笔：
// #17 只打了一半 —— 0.2.2-rc.1 把 editIntent 简化成复用 requirePresent，老 pattern 再也命中不了，
//     于是写放行了、改仍要求先读（tools.edit 实测报 "file has not been read"）。
// #67 打完之后面板恒判 skipped —— 它自己产出的标记带 "0.2.2"，markers 里没有那一条。

const P17 = ALL_PATCHES.find((p) => p.id === 17);
const P67 = ALL_PATCHES.find((p) => p.id === 67);

// 0.2.2-rc.1 的真实形状：writeIntent 还是老结构，editIntent 只剩一行 requirePresent
const HOST_022 = [
  "class Gate {",
  "\twriteIntent(target, actor) {",
  "\t\tconst owner = this.owner(actor);",
  "\t\tconst prior = owner ? this.get(owner, target.targetKey) : void 0;",
  '\t\treturn prior?.kind === "present" ? {',
  '\t\t\tkind: "replaceIfVersion",',
  "\t\t\tversion: prior.version",
  '\t\t} : { kind: "createIfAbsent" };',
  "\t}",
  "\teditIntent(target, actor) {",
  '\t\treturn this.requirePresent(target, actor, "edit");',
  "\t}",
  "}",
  "",
].join("\n");

test("#17 两条都改得到（0.2.2 的 editIntent + 老的 writeIntent）", () => {
  const once = applyReplacementsToText(HOST_022, P17, "index.js");
  assert.equal(once.changed, true, "0.2.2 那版 editIntent 必须能被改到");
  assert.match(once.text, /observation bypass: writes are unconditional/);
  assert.match(once.text, /observation bypass: edits are unconditional/);
  assert.equal(applyReplacementsToText(once.text, P17, "index.js").changed, false, "必须幂等");
  assert.equal(patchFileOutcome(once.text, P17, "index.js"), "applied");
});

test("#17 只打了一半时不会被当成 applied（半打就是没打完）", () => {
  // 只有 writeIntent 那条命中时，edits 标记缺席 → 不能判 applied
  const half = [
    "class Gate {",
    "\twriteIntent(target, actor) {",
    "\t\t// [dsh-purge] observation bypass: writes are unconditional.",
    "\t\treturn void 0;",
    "\t}",
    "\teditIntent(target, actor) {",
    '\t\treturn this.requirePresent(target, actor, "edit");',
    "\t}",
    "}",
    "",
  ].join("\n");
  assert.equal(patchFileOutcome(half, P17, "index.js"), "pending");
  assert.equal(applyReplacementsToText(half, P17, "index.js").changed, true, "半打状态还得能补完");
});

test("#67 打完之后的文件必须被自己的 markers 认出来（0.2.2 那条也要认）", () => {
  const src67 = [
    "\t\t\t\t\tif (turnEnds && decision.messages.length === 0) break;",
    "\t\t\t\t\tif (phase.step === 0 && decision.messages.length === 0) {",
    "",
  ].join("\n");
  const once = applyReplacementsToText(src67, P67, "index.js");
  assert.equal(once.changed, true);
  assert.ok(once.text.includes("0.2.2 guard undefined messages"), "0.2.2 缩进版会写出带 0.2.2 的标记");
  assert.equal(patchFileOutcome(once.text, P67, "index.js"), "applied", "自己的产出要能被自己认成 applied");
});
