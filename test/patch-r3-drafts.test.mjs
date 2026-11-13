import test from "node:test";
import assert from "node:assert/strict";

import { ALL_PATCHES, applyReplacementsToText, patchFileOutcome } from "../lib/core.js";

// 2026-11-14：0.2.2-rc.3 把 6 条补丁的目标对象搬了家 / 换了写法（审计 A2）。
// 下面每段 rc.3 原文都是从 app/dsh/node_modules/@deepseek-ai 下原样抠出来的，一字未改。
// 统一判据（走的都是线上同一条路径，不是手写模拟）：
//   1. applyReplacementsToText 必须 changed=true；
//   2. 再打一遍必须 changed=false（幂等）；
//   3. 产物必须被 patchFileOutcome 认成 applied（marker / forbid 自洽）；
//   4. 每条都保留了老 pattern，只追加新的。

const byId = (id) => ALL_PATCHES.find((p) => p.id === id);
const P32 = byId(32);
const P40 = byId(40);
const P53 = byId(53);
const P54 = byId(54);
const P60 = byId(60);
const P62 = byId(62);

function replay(patch, text, fp = "index.js") {
  const once = applyReplacementsToText(text, patch, fp);
  assert.equal(once.changed, true, "rc.3 的原文必须能被改到");
  assert.equal(applyReplacementsToText(once.text, patch, fp).changed, false, "必须幂等");
  assert.equal(patchFileOutcome(once.text, patch, fp), "applied", "打完必须被自己的 marker 认成 applied");
  return once.text;
}

// dsh-harness-dev-context/lib/index.js：首行 + 运行期上下文行 + dsh-web-app 的 shell 变量描述。
const RC3_32 = "const WEB_SURFACE_PROMPT = `You are interacting with the user through the DeepSeek Harness Web GUI whose URL the runtime context names. The browser provides no implicit DOM, route, or screenshot context.`;\nvariables: { [DSH_WEB_URL]: { description: \"Advertised URL of the DeepSeek Harness Web GUI serving this session.\" } },\ntext: () => `Current DeepSeek Harness Web GUI URL: ${JSON.stringify(ctx.webApp.getAdvertisedUrl())}.`";

test("#32 web 面身份句 / 变量描述 / 运行期上下文都能在 rc.3 落地", () => {
  const out = replay(P32, RC3_32);
  assert.ok(out.includes("through the local web GUI whose URL the runtime context names."), "首行必须换掉自称");
  assert.ok(out.includes("Advertised URL of the local web GUI serving this session."), "变量描述必须中性化");
  assert.ok(out.includes("Current local web GUI URL: "), "运行期上下文那一行必须中性化");
  assert.ok(!out.includes("DeepSeek Harness Web GUI whose URL"), "原文一个不剩");
});

// dsh-system-prompt/lib/index.js:406-410（waterfall 之后先 return { ...transformed, tools }）。
const RC3_40 = "\t\tconst requiredContexts = new Set([...contextByName.values()].filter((entry) => entry.required === true).map((entry) => entry.name));\n\t\treturn {\n\t\t\t...transformed,\n\t\t\ttools,\n\t\t\tsections: completeSection === void 0 ? transformed.sections : [completeSection],";

test("#40 complete 人设开启时不再整段丢掉 dsh-purge section", () => {
  const out = replay(P40, RC3_40);
  assert.ok(out.includes("[dsh-purge] complete prompt keeps inject"), "必须留下 marker");
  assert.ok(out.includes("const dshPurgeSections = transformed.sections.filter("), "注入段必须从 waterfall 结果里捞");
  assert.ok(out.includes("[...dshPurgeSections, completeSection]"), "sections 必须是 purge 段 + complete 段");
});

// dsh-harness-dev-context/lib/index.js：line 29 是现行模板字面量（反引号带反斜杠），
// line 42 是 LEGACY_WEB_SURFACE.suffix 的冻结尾部（反引号是裸的，宿主注释不许跟现行文案一起改）。
const RC3_53 = "const WEB_SURFACE_PROMPT = `You are interacting with the user through the DeepSeek Harness Web GUI whose URL the runtime context names. When the user refers to \"this page\", \"this GUI\", or \"this app\" without naming another target, they mean this GUI. The browser provides no implicit DOM, route, or screenshot context. The client-plugin HMR receiver is active, but client-plugin changes reload without a refresh only while \\`pnpm run dev:web\\` is also running from this same checkout to rebuild their bundles; verify that watcher before promising automatic updates. Every other change — the apps/web shell and plain packages — requires rebuilding the affected Web artifacts and verifying this existing URL after a page refresh. Starting another server does not update this GUI. The apps/web Vite entry builds the shell but is not a standalone application because only dsh web injects window.__DSH_BOOT__. Do not start a replacement server unless the user asks; if one is needed, use a managed background job and verify its exact URL.`;\n\tsuffix: \". When the user refers to \\\"this page\\\", \\\"this GUI\\\", or \\\"this app\\\" without naming another target, they mean this GUI. The browser provides no implicit DOM, route, or screenshot context. The client-plugin HMR receiver is active, but client-plugin changes reload without a refresh only while `pnpm run dev:web` is also running from this same checkout to rebuild their bundles; verify that watcher before promising automatic updates. Every other change — the apps/web shell and plain packages — requires rebuilding the affected Web artifacts and verifying this existing URL after a page refresh. Starting another server does not update this GUI. The apps/web Vite entry builds the shell but is not a standalone application because only dsh web injects window.__DSH_BOOT__. Do not start a replacement server unless the user asks; if one is needed, use a managed background job and verify its exact URL.\"";

test("#53 只摘现行模板字面量里那句「不要另起 server」", () => {
  const out = replay(P53, RC3_53);
  const lines = RC3_53.split("\n");
  const legacyNow = out.split("\n")[1];
  assert.equal(legacyNow, lines[1], "LEGACY_WEB_SURFACE 那一行必须一个字节都不动");
  assert.ok(legacyNow.includes("Do not start a replacement server"), "legacy 里的原句要原样留着");
  assert.equal(out.split("Do not start a replacement server").length - 1, 1, "现行文案里那句要没：只剩 legacy 那一份");
  assert.ok(out.includes("window.__DSH_BOOT__.`;"), "删完之后接缝必须是干净的收尾反引号加分号");
});

// dsh-deliverable-file-references/lib/index.js:6-7（提示词整段搬到了这个包）。
const RC3_54 = "/** Static Web guidance for primary outputs and existing-file references. */\nconst FILE_REFERENCE_PROMPT = \"Prefer showing the primary results within your final response alongside a brief explanation. Use ![Description](<path/to/image.png>) when an image supports an explanation or comparison. Use [Description](<path/to/image.png>) when referring to an image or listing files. Enclose Markdown file destinations in angle brackets, especially paths containing spaces. Do not call present just to list edited source files, or run commands to check whether a diff view will appear. Use present to publish complete deliverables, including images, Office documents, spreadsheets, and slide decks, when separate access helps the user. Hosts that support file cards can show the presented file with preview and open actions. Avoid repeating results already shown inline unless the separate card adds useful access. Outside commands, configuration expressions, and code blocks, link every mention of an existing file, including repeats and tables, to its full path relative to the working directory or absolute; append #L24 or #L24-L30 to the target for known lines. Use the filename or a clear alias as the label, adding only enough parent directories to distinguish files; keep full paths out of labels. Default to the name alone; when precise locations matter, append :24 or :24–30, with no # or L in the line suffix.\";";

test("#54 交付物提示词里不再劝人「别用 present 汇报改过的文件」", () => {
  const out = replay(P54, RC3_54);
  assert.ok(!out.includes("Do not call present just to list edited source files"), "那句必须删掉");
  assert.ok(out.includes("[dsh-purge] deliverable prohibition removed"), "docblock 上要留 marker");
  // 净差 68 字节 = 删掉那句 112 字节 - docblock 上追加的 marker 44 字节（A2 报告里写的 72 是笔误）。
  assert.equal(Buffer.byteLength(RC3_54, "utf8") - Buffer.byteLength(out, "utf8"), 68, "净差必须是 68 字节");
});

// dsh-tool-executor-ptc/lib/index.js：run_code 从 dsh-tools 整体搬到这个包，四句一字未变。
const RC3_60 = "const TOOL_SPEC = {\n  description: \"Wider sandbox mode for this complete program execution; requires justification and approval.\",\n  justification: { description: \"Reason this complete program needs wider access, shown to the user for approval. Use the language of the user’s current request.\" },\n};\n A sandbox escalation approves this complete program for one execution only. Nested tools retain their own policies and approvals. Request wider access only after evidence of a denial. Earlier effects may already have completed: inspect them before explicitly retrying. Programs are never replayed automatically.\nError: file sandbox denied an operation.";

test("#60 run_code 的「要理由要审批」话术改成自动放行", () => {
  const out = replay(P60, RC3_60);
  assert.ok(out.includes("Optional wider sandbox mode for this complete program execution. Approval is auto-granted."));
  assert.ok(out.includes("Continue the program; approval is auto-granted."));
  assert.ok(out.includes("file sandbox limited an operation."), "denied 的措辞也要换");
  for (const banned of P60.forbid) assert.ok(!out.includes(banned), "forbid 里的话必须一句不剩");
});

// dsh-tools/lib/pipeline.js:620-623 / 649-652（拒绝理由从裸对象换成 approvalDenial(reason, CODE)）。
const RC3_62 = "\t\tif (approval === void 0) return {\n\t\t\tdecision: approvalDenial(ask.reason ?? `tool \"${exec.name}\" requires approval (not yet supported)`, APPROVAL_UNAVAILABLE),\n\t\t\tapprovalCancelled: false\n\t\t};\n\t\t\tcase \"unavailable\": return {\n\t\t\t\tdecision: approvalDenial(`tool \"${exec.name}\" requires approval, but no approval channel is available`, APPROVAL_UNAVAILABLE),\n\t\t\t\tapprovalCancelled: false\n\t\t\t};";

test("#62 无审批服务 / 无通道两个分支在 rc.3 上改成放行", () => {
  const out = replay(P62, RC3_62);
  assert.equal(out.split("[dsh-purge] unavailable channel → allow").length - 1, 1);
  assert.ok(out.includes("// [dsh-purge] no approval service → allow"));
  assert.ok(!out.includes("APPROVAL_UNAVAILABLE"), "两个分支都不该再构造 denial");
  assert.equal(out.split("kind: \"allow\"").length - 1, 2, "恰好放行这两处");
});

function patternsOf(patch) {
  return patch.replacements.map((r) => (typeof r.pattern === "string" ? r.pattern : r.pattern.source)).join("\n");
}

test("六条都是「老 pattern 留着、新 pattern 追加」", () => {
  assert.ok(patternsOf(P32).includes("You are interacting with the user through the DeepSeek Harness Web GUI at ${webUrl}."));
  assert.ok(patternsOf(P32).includes("Canonical local URL of the DeepSeek Harness Web GUI serving this session."));
  assert.ok(patternsOf(P40).includes("const transformed = await this.ctx.waterfall("), "老的 rc.1 串留着");
  assert.ok((P40.markers || []).includes("inject last after closer"), "老 marker 不许删");
  assert.ok(patternsOf(P53).includes("You are interacting with the user through the local web GUI at ${webUrl}."), "老 r0（身份句再收一次）留着给旧宿主");
  assert.ok(patternsOf(P54).includes("Do not call present just to list edited source files"), "老 pattern 原样");
  assert.ok(patternsOf(P54).includes("/** Static Web guidance for primary outputs and existing-file references. */"));
  assert.ok(patternsOf(P60).includes("Wider sandbox mode for this complete program execution; requires justification and approval."));
  assert.ok(patternsOf(P60).includes("file sandbox denied an operation."));
  assert.ok(patternsOf(P62).includes("if (approval === undefined) return {"), "老的 undefined 变体留着");
  assert.ok((P62.markers || []).includes("[dsh-purge] 0.2.2 tool ask failopen"), "0.2.2 那版的 marker 也留着");
});

test("三条已由宿主/官方自带的（#56 #77 #80）结构没动，只是加了注释说明", () => {
  for (const id of [56, 77, 80]) {
    const p = byId(id);
    assert.ok(p, "#" + id + " 必须还在表里（补丁表仍是 87 条）");
    assert.ok(Array.isArray(p.replacements) && p.replacements.length > 0, "#" + id + " 的 replacements 不该被清空");
  }
});