import test from "node:test";
import assert from "node:assert/strict";

import { ALL_PATCHES, applyReplacementsToText, patchFileOutcome } from "../lib/core.js";

// 2026-11-14：0.2.2-rc.3 把裸 `throw new Error(...)` 换成了带错误码的
// `SandboxEscalationError(..., "SANDBOX_ESCALATION_*")`，#13/#35/#18 三条（都非可选）
// 的 pattern 因此全部失配。下面三段就是从 rc.3 的 app.asar 里抠出来的原文，一字未改。
// 三条都是"给老宿主留老 pattern、给新宿主加新 pattern"，所以这里同时钉：
// rc.3 能命中 + 幂等 + 打完自己的 marker 认得出 + 老的 rc.1 条目没被删掉。

const P13 = ALL_PATCHES.find((p) => p.id === 13);
const P35 = ALL_PATCHES.find((p) => p.id === 35);
const P18 = ALL_PATCHES.find((p) => p.id === 18);

const RC3_13 = "\tif (!(WIDER_MODES[effectiveMode] ?? []).includes(mode)) throw new SandboxEscalationError(`sandbox escalation to \"${mode}\" is not strictly wider than this call's current \"${effectiveMode}\" mode`, \"SANDBOX_ESCALATION_INVALID_ARGUMENT\");\n\tif (approval.approver === void 0) throw new SandboxEscalationError(`sandbox escalation to \"${mode}\" requires approval, but no approval service is composed`, \"SANDBOX_ESCALATION_UNAVAILABLE\");\n\tif (approval.agent === void 0) throw new SandboxEscalationError(`sandbox escalation to \"${mode}\" requires approval, but the call has no agent to route it through`, \"SANDBOX_ESCALATION_UNAVAILABLE\");";
const RC3_35 = "\tswitch (outcome) {\n\t\tcase \"allowed-once\": return mode;\n\t\tcase \"rejected\": throw new SandboxEscalationError(`the user rejected escalating this ${subject} to \"${mode}\"; it stays denied, so stop and explain instead of working around it`, \"SANDBOX_ESCALATION_REJECTED\");\n\t\tcase \"cancelled\":\n\t\t\tapproval.signal?.throwIfAborted();\n\t\t\tthrow new SandboxEscalationError(`approval for escalating to \"${mode}\" was cancelled`, \"SANDBOX_ESCALATION_CANCELLED\");\n\t\tcase \"unavailable\": throw new SandboxEscalationError(`sandbox escalation to \"${mode}\" requires approval, but no approval channel is available`, \"SANDBOX_ESCALATION_UNAVAILABLE\");\n\t\tdefault: return assertNever(outcome, \"EscalationOutcome\");\n\t}";
const RC3_18 = "\tctx.on(\"tools/post-execute\", async (exec, _result, next) => {\n\t\tconst reminder = observe(exec);\n\t\tconst downstream = await next();\n\t\tif (!reminder) return downstream;\n\t\treturn {\n\t\t\t...downstream,\n\t\t\tadditionalContexts: prependContext(reminder, downstream.additionalContexts)\n\t\t};\n\t});\n\tctx.on(\"agent/pre-step\", ({ agent, messages }, next) => {\n\t\tif (messages.some((message) => message.source.kind === \"user\")) chains.delete(agent);\n\t\treturn next();\n\t});";

const cases = [
  [P13, "rc.3 升级阶梯", RC3_13],
  [P35, "rc.3 升级结果 switch", RC3_35],
  [P18, "rc.3 重复调用守卫", RC3_18],
];

for (const [patch, label, text] of cases) {
  test("#" + patch.id + " 在 " + label + " 上能命中、幂等、marker 自洽", () => {
    const once = applyReplacementsToText(text, patch, "index.js");
    assert.equal(once.changed, true, "rc.3 的原文必须能被改到");
    assert.equal(applyReplacementsToText(once.text, patch, "index.js").changed, false, "必须幂等");
    assert.equal(patchFileOutcome(once.text, patch, "index.js"), "applied");
    for (const marker of patch.markers || []) {
      assert.ok(once.text.includes(marker), "产物里必须有 marker：" + marker);
    }
  });
}

test("三条都保留了老的 rc.1 形态（换成新 pattern 不等于删掉旧的）", () => {
  for (const patch of [P13, P35, P18]) {
    assert.ok((patch.replacements || []).length >= 2, "#" + patch.id + " 至少要有旧+新两条 pattern");
  }
});
