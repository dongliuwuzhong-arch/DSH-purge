import test from "node:test";
import assert from "node:assert/strict";

import { ALL_PATCHES, applyReplacementsToText, patchFileOutcome } from "../lib/core.js";

// A1 审计（2026-11-14）在 rc.3 上抓到的两处：
// #104 —— dsh-agent/lib/index.js:235 还有一处 decision.messages 裸解引用，
//         它在 pre-step waterfall 里比 #67 守的 agent-loop 更早执行，#67 兜不住。
// #73  —— 它的 marker 和 #70 撞了，skipIfMarked 一命中就判 applied，删除从没执行过（假绿）。

const P104 = ALL_PATCHES.find((p) => p.id === 104);
const P73 = ALL_PATCHES.find((p) => p.id === 73);

const HOST_104 = [
  "function preStep(decision, step, messages) {",
  "\tif (decision.messages.length === 0 && (step === 1 || messages.length > 0)) return decision;",
  "\treturn decision;",
  "}",
  "",
].join("\n");

test("#104 在 dsh-agent 的裸解引用上能命中、幂等、marker 自洽", () => {
  const once = applyReplacementsToText(HOST_104, P104, "index.js");
  assert.equal(once.changed, true);
  assert.match(once.text, /decision\.messages\?\.length \?\? 0/);
  assert.equal(applyReplacementsToText(once.text, P104, "index.js").changed, false, "必须幂等");
  assert.equal(patchFileOutcome(once.text, P104, "index.js"), "applied");
});

test("#73 不能再靠 #70 的 marker 蒙混：skipIfMarked 必须关掉", () => {
  assert.equal(!!P73.skipIfMarked, false, "#73 挂 skipIfMarked 就永远不会真去删那行");
  const fake = "  description: |\n      * Network access depends on the task environment. Prefer configured mirrors/proxies when they are available.\n      * other line\n";
  const once = applyReplacementsToText(fake, P73, "minimal.patch.yml");
  assert.equal(once.changed, true, "那行还在时必须真的删掉");
  assert.ok(!once.text.includes("Network access depends on the task environment"));
});
