import test from "node:test";
import assert from "node:assert/strict";

import { ALL_PATCHES, applyReplacementsToText, patchFileOutcome } from "../lib/core.js";

// rc.5 适配（2026-11-16）。下面的片段是**逐字节**从两棵树抄来的，不是凭记忆排的：
//   rc.3 现网 %INSTALL_DIR%/resources/app　rc.5 候选 C:/DSH沙箱/rc5/tree
// 已实测：dsh-tools/lib/pipeline.js、dsh-agent-instructions/lib/index.js、
// dsh-client-ui-conversation/lib/client.js、minimal 预设 —— 两棵树同字节；
// lib/main.js 只差版本串，但 rc.5 的 wscript 模板安装器整段没了。
// 这里钉「两版都能贴 / 都不能贴」这件事，用片段而不是宿主文件，测试不依赖那两棵树。

const byId = (id) => ALL_PATCHES.find((p) => p.id === id);

// rc.5 pipeline.js:618-649（rc.3 未打补丁原文逐字节相同，35733 B）。
const PIPELINE_APPROVAL = [
	"\tasync serviceAsk(exec, ask) {",
	"\t\tconst approval = this.ctx.get(\"approval\");",
	"\t\tif (approval === void 0) return {",
	"\t\t\tdecision: approvalDenial(ask.reason ?? `tool \"${exec.name}\" requires approval (not yet supported)`, APPROVAL_UNAVAILABLE),",
	"\t\t\tapprovalCancelled: false",
	"\t\t};",
	"\t\tif (exec.agent === void 0) return {",
	"\t\t\tdecision: approvalDenial(`tool \"${exec.name}\" requires approval, but the call has no agent to route it through`, APPROVAL_UNAVAILABLE),",
	"\t\t\tapprovalCancelled: false",
	"\t\t};",
	"\t\tconst outcome = await approval.request({",
	"\t\t\tagent: exec.agent,",
	"\t\t\ttoolName: exec.name,",
	"\t\t\tcallId: exec.callId,",
	"\t\t\t...ask.reason !== void 0 ? { reason: ask.reason } : {},",
	"\t\t\t...ask.displayReason !== void 0 ? { displayReason: ask.displayReason } : {},",
	"\t\t\tsignal: exec.signal",
	"\t\t});",
	"\t\tswitch (outcome) {",
	"\t\t\tcase \"allowed-once\": return {",
	"\t\t\t\tdecision: { kind: \"allow\" },",
	"\t\t\t\tapprovalCancelled: false",
	"\t\t\t};",
	"\t\t\tcase \"rejected\": return {",
	"\t\t\t\tdecision: approvalDenial(`the user rejected tool \"${exec.name}\"`, APPROVAL_REJECTED),",
	"\t\t\t\tapprovalCancelled: false",
	"\t\t\t};",
	"\t\t\tcase \"cancelled\": return {",
	"\t\t\t\tdecision: approvalDenial(`approval for tool \"${exec.name}\" was cancelled`, APPROVAL_CANCELLED),",
	"\t\t\t\tapprovalCancelled: true",
	"\t\t\t};",
	"\t\t\tcase \"unavailable\": return {",
	"\t\t\t\tdecision: approvalDenial(`tool \"${exec.name}\" requires approval, but no approval channel is available`, APPROVAL_UNAVAILABLE),",
	"\t\t\t\tapprovalCancelled: false",
	"\t\t\t};",
	"\t\t\tdefault: return assertNever(outcome, \"ApprovalOutcome\");",
	"",
].join("\n");

test("#62 rc.3 / rc.5 的 pipeline.js 同文：两版都待贴，贴上去翻 fail-open", () => {
  const p = byId(62);
  assert.equal(patchFileOutcome(PIPELINE_APPROVAL, p, "pipeline.js"), "pending", "原文上必须待贴");
  const once = applyReplacementsToText(PIPELINE_APPROVAL, p, "pipeline.js");
  assert.equal(once.changed, true);
  assert.match(once.text, /if \(approval === void 0\) return \{ decision: \{ kind: "allow" \}, approvalCancelled: false \};/);
  assert.match(once.text, /case "unavailable": return \{ decision: \{ kind: "allow" \}, approvalCancelled: false \};/);
  assert.equal(applyReplacementsToText(once.text, p, "pipeline.js").changed, false, "必须幂等");
  assert.equal(patchFileOutcome(once.text, p, "pipeline.js"), "applied");
});

test("#62 的 repl[5]/[6] 就是 rc.5 原文，不用再补一条 rc.5 变体", () => {
  const patterns = (byId(62).replacements ?? []).map((r) => r.pattern).filter((x) => typeof x === "string");
  assert.equal(patterns.filter((x) => x.includes("approvalDenial(ask.reason")).length, 1);
  assert.equal(patterns.filter((x) => x.includes("approvalDenial(") && x.includes("no approval channel is available")).length, 1);
  assert.equal(patterns.filter((x) => PIPELINE_APPROVAL.includes(x)).length, 2, "两处 approvalDenial 站点逐字在原文里");
  assert.match(byId(62).desc, /fail-closed/);
});

// rc.5 minimal.patch.yml:17-24（rc.3 同文，行号晚 4 行）。
const MINIMAL_FS = [
	"          - id: tool-fs",
	"            name: '@deepseek-ai/dsh-tool-fs'",
	"            config:",
	"              read: false",
	"              readImage: true",
	"              write: false",
	"              edit: false",
	"          - id: compaction",
	"",
].join("\n");

// rc.5 dsh-sdk-minimal/cordis.patch.yml:44-52（rc.3 同文同址）。
const SDK_MINIMAL_FS = [
	"    - id: tool-fs",
	"      name: '@deepseek-ai/dsh-tool-fs'",
	"      config:",
	"        read: false",
	"        readImage: true",
	"        write: false",
	"        edit: false",
	"",
	"    - id: working-directory",
	"",
].join("\n");

test("#80 官方 tool-fs 块（minimal 10 空格 / sdk-minimal 4 空格）都锚得上，只补标记不动权限", () => {
  const p = byId(80);
  for (const [fixture, fp] of [[MINIMAL_FS, "minimal.patch.yml"], [SDK_MINIMAL_FS, "dsh-sdk-minimal/cordis.patch.yml"]]) {
    assert.equal(patchFileOutcome(fixture, p, fp), "pending", fp);
    const once = applyReplacementsToText(fixture, p, fp);
    assert.equal(once.changed, true, fp);
    assert.ok(once.text.includes("[dsh-purge] minimal official toolset"), fp);
    assert.match(once.text, /read: false[\s\S]*write: false[\s\S]*edit: false/, fp + " 不得放开 fs 权限");
    assert.equal(applyReplacementsToText(once.text, p, fp).changed, false, fp + " 必须幂等");
    assert.equal(patchFileOutcome(once.text, p, fp), "applied", fp);
  }
});

test("#80 旧的中间态形态（minimal fs tool parity + fs-search/web）不再是锚点", () => {
  const stale = [
	"          - id: tool-fs # [dsh-purge] minimal fs tool parity",
	"            name: '@deepseek-ai/dsh-tool-fs'",
	"          - id: tool-fs-search",
	"            name: '@deepseek-ai/dsh-tool-fs-search'",
	"          - id: persistent-shell",
	"",
].join("\n");
  assert.equal(applyReplacementsToText(stale, byId(80), "minimal.patch.yml").changed, false);
});

test("#46 rc.5 上 #45 → #46 不重复插函数；repl[1] 只留给 rc.3 老安装器", () => {
  const p45 = byId(45);
  const p46 = byId(46);
  const shell = ["var DesktopUpdateCoordinator = class {", "\tconstructor(owner) { this.owner = owner; }", "};", ""].join("\n");
  const after45 = applyReplacementsToText(shell, p45, "main.js");
  assert.equal(after45.changed, true);
  assert.equal(after45.text.split("function dshPurgeWshLiteral(").length - 1, 1, "#45 自带一份");
  const after46 = applyReplacementsToText(after45.text, p46, "main.js");
  assert.equal(after46.changed, false, "#45 之后 #46 必须空转");
  assert.equal(after46.text.split("function dshPurgeWshLiteral(").length - 1, 1, "不得重复插入");
  assert.equal(patchFileOutcome(after45.text, p46, "main.js"), "applied");
  assert.ok(p46.replacements[1].pattern.includes("__EXE_JSON__"), "repl[1] 守的还是 rc.3 的模板拼接形态");
  assert.equal(after45.text.includes("join(JSON.stringify(exe))"), false, "#45 产出的是已修好的形态");
  assert.match(p46.desc, /rc\.5/);
});

// 两版 client.js 同为 704147 B：压缩构建里 4 条 pattern 全 0 命中。
const CLIENT_APPEND = "append(record){const event=record.event;if(this.inputs.has(event.seq))return`none`;if(this.revised.size>0)this.revised.clear();this.inputs.set(event.seq,record);let publication=`none`;";
const CLIENT_REPLACE_WINDOW = "replaceWindow(entries,hasMore){this.contexts.clear();this.contextsByKind.clear();this.contextsBySeq.clear();this.contextsByTarget.clear();";

test("#56 / #77 两版都不命中就等于空操作，desc 必须写明", () => {
  const fixture = CLIENT_APPEND + "\n" + CLIENT_REPLACE_WINDOW + "\n";
  const p56 = byId(56);
  const p77 = byId(77);
  assert.equal(patchFileOutcome(fixture, p56, "client.js"), "skipped");
  assert.equal(patchFileOutcome(fixture, p77, "client.js"), "skipped");
  assert.equal(p56.optional, true);
  assert.equal(p77.optional, true);
  assert.match(p56.desc, /704147 B/);
  assert.match(p56.desc, /空操作/);
  assert.match(p77.desc, /空操作/);
});

// rc.5 agent-loop/lib/index.js:849-853（#87 已经直接产出终态，dshPurge 全无）。
const AGENT_LOOP_HEAD = [
	"\t\t/* v8 ignore next -- private callers establish the running phase before executing a step */",
	"\t\tif (this.phase.kind !== \"running\") throw new Error(`agent \"${this.id}\": step outside running phase`);",
	"\t\tconst { turn, step, abort: { signal } } = this.phase;",
	"\t\tsignal.throwIfAborted();",
	"\t\tconst { assembly } = decision;",
	"\t\tconst renderedPrompt = renderPrompt(assembly);",
	"\t\tlet firstAttempt = true;",
	"\t\twhile (true) {",
	"",
].join("\n");

test("#88 已标 optional、desc 说明只给历史版本用，锚点本身仍能把宽判据收严", () => {
  const p = byId(88);
  assert.equal(p.optional, true);
  assert.match(p.desc, /仅历史版本需要/);
  assert.equal(patchFileOutcome(AGENT_LOOP_HEAD, p, "agent-loop/index.js"), "skipped", "rc.5 原文上没有对象");
  const oldForm = p.replacements[0].pattern;
  const applied = applyReplacementsToText(oldForm, p, "agent-loop/index.js");
  assert.equal(applied.changed, true, "只剩中间态时才动手");
  assert.ok(applied.text.includes("[dsh-purge-88]"));
});

test("#105 仍然幂等，desc 记明与上游 syncInbox 的去重判据并存", () => {
  const p = byId(105);
  const host = [
	"\t\tfor (const message of pending) agent.inbox.remove(message.id);",
	"\t\tif (desired === void 0 || decision.messages.some((message) => sameContextPayload(message, desired))) return decision;",
	"\t\tconst lastClaimedIndex = decision.messages.findLastIndex((message) => messages.includes(message));",
	"",
].join("\n");
  assert.equal(patchFileOutcome(host, p, "index.js"), "pending");
  const once = applyReplacementsToText(host, p, "index.js");
  assert.equal(once.changed, true);
  assert.equal(applyReplacementsToText(once.text, p, "index.js").changed, false, "必须幂等");
  assert.equal(once.text.split("[dsh-purge] baseline already on surface").length - 1, 1, "只插一处");
  assert.match(p.desc, /syncInbox/);
  assert.match(p.desc, /幂等/);
});
