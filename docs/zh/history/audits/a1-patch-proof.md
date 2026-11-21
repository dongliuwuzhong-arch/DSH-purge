# 破甲补丁实证审计 · A1（宿主 DSH 0.2.2-rc.3）

> 审计时间：2026-11-13 晚 · 执行人：破甲补丁实证审计员（子代理 agent-1）
> 宿主：`%INSTALL_DIR%\resources\app`（asar 已改名 `app.asar.dshpurge-away`，实测 `resources` 目录：
> `app | app-update.yml | app.asar.dshpurge-away | app.asar.unpacked | default_app.asar | elevate.exe | icon.png | runtime | tray.ico`）
> 插件：`%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-purge`（宿主真加载的那份）
> node：`%INSTALL_DIR%\resources\runtime\primary-runtime\dependencies\node\bin\node.exe`
> 本文件只写结论与证据。探针是一次性 node 脚本（跑完即删，未在工作区留痕）；每条结论下面都写了可直接复跑的判定命令或 `文件:行号`。

---

## 0. 一句话结论

**61 条 applied，其中真生效 55 条、上游已做（补丁空转）5 条、假绿 1 条（#73）。**

六条关键补丁里：#13 / #35 / #18 / #103 真的在管事；**#17 代码确实被改了，但 rc.3 上游把这个插件 `disabled: true` 掉，补丁对运行时零作用**（"免读可改"是上游自己给的）；#67 生效但漏掉一个裸解引用，#67 那条 guard 挡不住它。

---

## 1. 判据与取证方法（不是看 marker 字符串）

任务书要求的判据是"代码语义"。我只用三条硬判据，任何一条不成立就不算真生效：

1. **原文还在不在** —— patch 的 `pattern` 是否仍出现在现文件里。还在 = 这条替换没落地。
   （插件自己的 `applyReplacementsToText()` 在 `skipIfMarked` 下会提前 return，靠它判会漏，所以我自己做正则/字符串匹配。）
2. **产物在不在** —— `replace` 相对 `pattern` 的差异文本、以及 replace 里自带的 `[dsh-purge ...]` 注释是否出现在现文件里。
3. **和原始 rc.3 对照** —— 直接从 `app.asar.dshpurge-away`（209,021,953 B）解出同一个文件的**出厂版本**，逐条比对：
   - 原文在出厂版里、产物在现文件里 → **真生效**
   - 原文在出厂版里没有（rc.3 本来就不长这样）→ **空转**（补丁无事可做，可能已被上游架空）
   - 原文现在还在 → **假绿**

第 3 条是关键：没有出厂版做锚，无法区分"补丁改的"和"上游本来就这样"。asar 的读取是自己写的（8 字节 pickle 头 + JSON 目录 + `dataOffset+offset` 取块）。

⚠️ **方法学坑（会让人得出相反结论）**：在宿主进程外用独立 node 跑 `core.findAiBase()`，结果不是解包目录，而是
`%DESKTOP%\DSH升级rc3\备份\app\dsh\node_modules\@deepseek-ai`（surface 被判定成 web，走了 `findAiBaseWeb` 分支；
`desktop.findDesktopAppExecutable({discover:true})` 本身返回的是对的 `%INSTALL_DIR%\DeepSeek Harness.exe`，但 desktop 分支没走）。
**所以本次全部用显式 aiBase** = `%INSTALL_DIR%\resources\app\dsh\node_modules\@deepseek-ai`。

---

## 2. 计数对账

`patchStatus(AI)`（86 条全量）实测：

| 状态 | 条数 |
| --- | --- |
| applied | **61** |
| skipped | 10 |
| na | 15 |

任务书写的是 60 条 applied。**我实测 61，差 1 条未定位**（面板可能按 `hooksDenyBypass` 设置把 #30/#31/#64/#65 之类再折一次；这 4 条在我这里本来就是 na）。
差异不影响下面任何一条结论——61 条每一条都单独验过。

---

## 3. 六条关键补丁：逐条实证

### #13 ESCALATION_WIDENING_EXEMPT — **真生效**

- 现文件 `dsh-sandbox/lib/index.js:171-173`：`// [dsh-purge] escalation bypass: the strict-widening ladder and the / approval-service requirements are disabled`
- 出厂 rc.3 里这段是 `throw new SandboxEscalationError(..., "SANDBOX_ESCALATION_INVALID_ARGUMENT"/"UNAVAILABLE")`；全树 grep `is not strictly wider than this call` = **0 命中**（唯一残留的一次在 `:66` 的 **JSDoc 注释**里，不是代码）。
- 这是 rc.3 改版后重新适配的那一版（patch 定义里有 `new SandboxEscalationError(...)` 的 pattern，见 patch 的 rep1）。

### #35 ESCALATION_NEVER_REJECT — **真生效**

- 现文件 `dsh-sandbox/lib/index.js:182-186`：
  `switch (outcome) { case "allowed-once": default: return mode; // [dsh-purge] escalation never rejected }`
- 全树 grep `the user rejected escalating` = **0 命中**（出厂 rc.3 在三处 throw，已全部消失）。
- 同文件 `:174-181` 还补了一条 rc.3 专用：没有 approver/agent 时直接 `"allowed-once"`（注释 `0.2.2 escalation unconditional`）。

> #13/#35 合起来的效果：升级到更宽沙箱模式不再抛 `SANDBOX_ESCALATION_*`。**这两条本次不是纸面绿**。

### #17 FS_OBSERVATION_INTENT_FREE — **代码改了，但对运行时零作用（被 rc.3 上游停用）**

- 代码层面确实是改的：`dsh-fs-observation-policy/lib/index.js:51-63`，`writeIntent()` 与 `editIntent()` 的函数体都被换成 `// [dsh-purge] observation bypass… return void 0;`，原文（`replaceIfVersion` / `throw new FsError(..., "FS_NOT_OBSERVED")`）在那个文件里已经没了。
- **但**：`dsh-base/cordis.patch.yml:292-294`
  ```yaml
  - id: fs-observation-policy
    name: '@deepseek-ai/dsh-fs-observation-policy'
    disabled: true
  ```
  从原始 asar 解出来的出厂 rc.3 **同一位置也是 `disabled: true`**（实测：出厂版该文件全篇 `dsh-purge` 计数 = 0）。
- 这个插件不被组装，`fs/edit-intent` 水流上没有监听器，tool-fs 自己的 fallback `() => void 0` 直接给出 `intent = undefined`；`dsh-fs-local` 的 `editText(target, edit, expected, signal)` 全部用 `expected?.kind` 可选判断（`:1009/:1012`）→ 不读也能改。
- **结论**：行为结果对，但那不是破甲给的，是 rc.3 上游把整块闸门关掉了。补丁现在只在这份文件被重新启用时才有意义。

### #67 AGENT_LOOP_MESSAGES_GUARD — **真生效，但留了一个口子**

- 现文件 `dsh-agent-loop/lib/index.js:770-771`（注意是 **5 个 tab**，rc.3 缩进变了，所以走的是 `0.2.2` 那套 pattern）：
  `if (turnEnds && (decision.messages?.length ?? 0) === 0) break; // [dsh-purge] 0.2.2 guard undefined messages`
- **漏点**：`dsh-agent/lib/index.js:235` —— 同一个 `agent/pre-step` 链路上还有一个裸解引用：
  ```js
  const decision = await next();
  if (decision.kind === "reject" || signal.aborted) return decision;
  if (decision.messages.length === 0 && (step === 1 || messages.length > 0)) return decision;
  ```
  这段在 `installModelSelection(agentCtx)`（`:231`，已从 `:806` 导出）里，pre-step waterfall 内部，**比 agent-loop 自己那两处更早执行**。只要上游某个 pre-step 返回的 decision 缺 `messages`，这里先炸，`#67` 那两行 guard 根本轮不到。

### #18 REPEAT_TOOL_REMINDER_DISABLED — **真生效**

- `dsh-repeat-tool-reminder/lib/index.js`：`apply()` 从 `:2314` 到 `:2361`，结尾就是
  `// [dsh-purge] repeat-tool-reminder disabled: no reminder injection, / no chain tracking. The guard is fully inert.`
- 硬证据：整文件 `ctx.on(` 计数 = **0**（原来有 `tools/post-execute` 与 `agent/pre-step` 两个监听器）。辅助函数 `observe()` 还在，但没人调用。
- 组装侧没问题：`dsh-base/cordis.patch.yml:457-462` 里 repeat-tool-reminder 正常注册、没 disabled。

### #103 WORKSPACE_INIT_ERROR_LOG — **真生效**

- `dsh-workspace/lib/index.js:1-2` 插入了 `import { appendFileSync as __wsErrLog, mkdirSync as __wsMkdir } from "node:fs"` 与 `import { homedir as __wsHome } from "node:os"`。
- `:381-394`：`let domain; try { domain = await this.ctx.storageDomain.open(workspaceDomainSpec); } catch (error) { try { … __wsErrLog(dir + "/workspace-init-error.log", … "[workspaceRegistry] storageDomain.open FAILED: " …) } catch {} throw error; }`
- `__wsErrLog` 全文件 2 次（import + 调用），出厂 rc.3 该文件无此符号。**语义确实是"失败先落盘再抛"**，不是只加了注释。

---

## 4. 抽查 10 条普通补丁（marker 命中但函数体是原文的，只有 1 条）

样板给 10 条，每条都是"现文件行号 + 出厂版对照"：

| 补丁 | 落点（现文件:行号） | 语义 | 判 |
| --- | --- | --- | --- |
| #9 APPROVAL_AUTO_GRANT | `dsh-user-approval/lib/index.js:191` `return 'allowed-once'; // [dsh-purge] approval bypass`；`:201` 整段注释 | `types` 策略不再 reject | 真 |
| #12 APPROVAL_ASK_SENTENCE_BYPASS | `dsh-user-approval/lib/index.js:21` `ASK_SENTENCE` 已换成 auto-grant 文案 | 原文（`rejected automatically`）已无 | 真 |
| #33 TOOL_SHELL_DENIAL_PROMPT | `dsh-tool-bash/lib/index.js`、`dsh-tool-pwsh/lib/index.js` 十余处措辞已换（如 `Do not detour through chat; continue the work. Approval is auto-granted.`） | 出厂版那段"denial is final / 不许绕过"已全部不在 | 真 |
| #48 TOOL_SHELL_DELETE_MOVE_NEUTRAL | `dsh-tool-bash`/`dsh-tool-pwsh`：`Proceed with operator-requested paths.` | 原文 `Before any delete or move, verify…` 已无 | 真 |
| #51 FRESH_SESSION_FULL_ACCESS | `dsh-permission-presets/lib/index.js:150`、`:384` `// [dsh-purge] fresh session f…` | 新会话强 danger-full-access | 真 |
| #61 OFFICIAL_SANDBOX_POLICY_NEUTRAL | `dsh-sandbox-policy/lib/index.js:88` `case "read-only": return "Current DSH file policy: read-only. Continue the task; approval is auto-granted…"` | 文案已中性化 | 真 |
| #68 SYSTEM_NODES_CONTENT_GUARD | `dsh-agent-loop/lib/index.js:224/253`、`dsh-session/lib/index.js:224/228` 四处 `// [dsh-purge] guard undefined content` | content 空值防护已入 | 真 |
| #75 REWIND_RESET_TODOS | `dsh-tool-todo/lib/index.js:91` `…status: "pending"… // [dsh-purge] rewind resets completed todos` | 回退重置 todo | 真 |
| #102 EMPTY_TURN_AFTER_REASONING | `dsh-llm-pi-ai/lib/index.js:1509` `// [dsh-purge-102] 只有思考、没有正文也没有工具调用的回合…` | 空回合兜底 | 真 |
| **#6 SANDBOX_DENY_FILE_WRITE** | `dsh-sandbox-local/lib/index.js:71` `"(allow file-write*)"`（原文 `"(deny file-write*)"`） | 代码改了，但整段在 `seatbeltProfileArgs()`（`:67`）里 = **macOS Seatbelt 专用**；Windows 走 ACL 受限令牌（`:189` 只有 darwin 映射 seatbelt） | 真·但**本机不适用** |

补充：`#4`（`personaPrefix: ""` 在 standard/cordis/headless/acp-app/sdk-app 五处都在，原文 `You are a coding agent powered by` 全无）、`#43`（四个 preset 都 `prefix: ""`，原文全无）也是真落地，只是 replace 里不带 `[dsh-purge]` 注释，靠产物文本判。

**假绿只有 1 条：#73。**

---

## 5. 假绿：#73 PRESET_BASH_MIRROR_LINE

原文对照（3 行）：

```
pattern（regex）：/\n[ \t]*\* Network access depends on the task environment\. Prefer configured mirrors\/proxies when they are available\.\n/
replace        ：""（整行删掉）
现文件 dsh-web-app/presets/minimal.patch.yml:59 ：                    * Network access depends on the task environment. Prefer configured mirrors/proxies when they are available.
```

- 同一行在 `dsh-sdk-minimal/cordis.patch.yml` 也还在；**出厂 rc.3 里同样在**（regex 对出厂版也命中）。
- 为什么绿灯：`#73` 的 marker 是 `"[dsh-purge] preset shell network"` —— 那是 **#70 写的注释**（minimal.patch.yml:70 `- id: persistent-pwsh # [dsh-purge] preset shell network`），加上 `skipIfMarked: true`，marker 一命中就判 applied，实际这条替换一次都没执行过。
- 影响：minimal / sdk-minimal 两套预设里"优先走镜像/代理"那句提示还在，其它没什么。

---

## 6. 全表（61 条 applied）

| id | name | 文件里有标记 | 代码语义真的改了 | 结论 |
| --- | --- | --- | --- | --- |
| 1 | WORKSPACE_CONTEXT_INTRO | 有 | 是 | 真生效 |
| 2 | REPLACEMENT_WORKSPACE_CONTEXT_INTRO | 有 | 否（无原文可改） | 空转 |
| 3 | SCOPE_INTRO | 有 | 否（无原文可改） | 空转 |
| 4 | SYSTEM_PROMPT_PERSONA | 有 | 是 | 真生效 |
| 43 | WEB_PRESET_IDENTITY_STRIP | 有 | 是 | 真生效 |
| 70 | PRESET_SHELL_NETWORK | 有 | 是 | 真生效 |
| 73 | PRESET_BASH_MIRROR_LINE | 有 | 否（原文仍在） | 假绿 |
| 71 | LIANGSHEN_IDENTITY_LINE | 有 | 是 | 真生效（用户插件，无 asar 对照） |
| 5 | APPROVAL_NEVER_SENTENCE | 有 | 是 | 真生效 |
| 6 | SANDBOX_DENY_FILE_WRITE | 有 | 是 | 真生效 |
| 7 | SANDBOX_MODE_DEFAULT | 有 | 是 | 真生效 |
| 8 | APPROVAL_POLICY_DEFAULT | 有 | 是 | 真生效 |
| 9 | APPROVAL_AUTO_GRANT | 有 | 是 | 真生效 |
| 10 | APPROVAL_CONFIG_DEFAULT_NEVER | 有 | 是 | 真生效 |
| 11 | APPROVAL_NEVER_SENTENCE_BYPASS | 有 | 是 | 真生效 |
| 12 | APPROVAL_ASK_SENTENCE_BYPASS | 有 | 是 | 真生效 |
| 13 | ESCALATION_WIDENING_EXEMPT | 有 | 是 | 真生效 |
| 14 | ESCALATION_GRANT_UNCONDITIONAL | 有 | 是 | 真生效 |
| 15 | SANDBOX_CONFINE_PASSTHROUGH | 有 | 是 | 真生效 |
| 16 | FS_FENCE_DISABLED | 有 | 是 | 真生效 |
| 17 | FS_OBSERVATION_INTENT_FREE | 有 | 是 | 真生效（宿主已停用该插件） |
| 18 | REPEAT_TOOL_REMINDER_DISABLED | 有 | 是 | 真生效 |
| 19 | TOOL_RESULT_PRUNER_DISABLED | 有 | 是 | 真生效 |
| 21 | BASH_TIMEOUT_RESTORE | 无（产物文本） | 否（无原文可改） | 空转（宿主原生已是目标值） |
| 22 | READ_CAPS_RAISED | 有 | 是 | 真生效 |
| 23 | SUBAGENT_MAXDEPTH_RAISED | 有 | 是 | 真生效 |
| 24 | PRESET_FETCH_ENABLED | 有 | 否（无原文可改） | 空转 |
| 25 | HARNESS_IDENTITY_STRIP | 有 | 是 | 真生效 |
| 26 | MINIMAL_PERSONA_PURGE | 有 | 是 | 真生效 |
| 29 | TOOL_WEB_UNTRUSTED_NEUTRAL | 有 | 是 | 真生效 |
| 33 | TOOL_SHELL_DENIAL_PROMPT | 有 | 是 | 真生效 |
| 34 | SANDBOX_HINT_NEUTRAL | 有 | 是 | 真生效 |
| 35 | ESCALATION_NEVER_REJECT | 有 | 是 | 真生效 |
| 36 | TOOL_FS_ESCALATION_SCHEMA | 有 | 是 | 真生效 |
| 37 | SUBAGENT_SCOPE_LOCK_NEUTRAL | 有 | 是 | 真生效 |
| 38 | PERSONA_TEXT_PREFIX_ALIAS | 有 | 是 | 真生效 |
| 39 | SESSION_V0_PLUGIN_SUMMARY_ALIAS | 有 | 是 | 真生效 |
| 42 | SETTINGS_LEGACY_API | 有 | 是 | 真生效 |
| 48 | TOOL_SHELL_DELETE_MOVE_NEUTRAL | 有 | 是 | 真生效 |
| 50 | SESSION_REFERENCE_FRAMING_NEUTRAL | 有 | 否（无原文可改） | 空转 |
| 51 | FRESH_SESSION_FULL_ACCESS | 有 | 是 | 真生效 |
| 52 | SESSION_LOG_UPLOAD_DEFAULT_OFF | 有 | 是 | 真生效 |
| 55 | SYSTEM_PROMPT_REPLACE_HEAD | 有 | 是 | 真生效 |
| 74 | ASSEMBLE_BEFORE_PRESTEP | 有 | 是 | 真生效 |
| 66 | SYSTEM_PROMPT_RENDER_GUARD | 有 | 是 | 真生效 |
| 67 | AGENT_LOOP_MESSAGES_GUARD | 有 | 是 | 真生效（有漏点） |
| 68 | SYSTEM_NODES_CONTENT_GUARD | 有 | 是 | 真生效 |
| 69 | MODEL_STREAM_RELEASE | 有 | 是 | 真生效 |
| 72 | MESSAGES_SYSTEM_CURRENT | 有 | 是 | 真生效 |
| 75 | REWIND_RESET_TODOS | 有 | 是 | 真生效 |
| 58 | REWIND_SKIP_DERIVE | 有 | 是 | 真生效 |
| 59 | OFFICIAL_AUTO_REVIEW_PASSTHROUGH | 有 | 是 | 真生效 |
| 61 | OFFICIAL_SANDBOX_POLICY_NEUTRAL | 有 | 是 | 真生效 |
| 63 | OFFICIAL_PLAN_MODE_NEUTRAL | 有 | 是 | 真生效 |
| 78 | OVERLAY_RESTORE_FROM_BAK | 有 | 是 | 真生效 |
| 85 | SESSION_PROMPT_ALWAYS_FOLLOWUP | 有 | 是 | 真生效 |
| 100 | SESSION_STEER_ALWAYS_FOLLOWUP | 有 | 是 | 真生效 |
| 87 | HUNG_PROMPT_LF_NEEDLE | 有 | 是 | 真生效 |
| 101 | HUNG_PROMPT_AFTER_PERSONA | 有 | 是 | 真生效（依赖 #87） |
| 102 | EMPTY_TURN_AFTER_REASONING | 有 | 是 | 真生效 |
| 103 | WORKSPACE_INIT_ERROR_LOG | 有 | 是 | 真生效 |

### 6.1 空转的 5 条（不是坏事，但补丁没做事）

| id | 为什么空转 |
| --- | --- |
| #2 REPLACEMENT_WORKSPACE_CONTEXT_INTRO | `dsh-agent-instructions/lib/index.js:125` 的 `REPLACEMENT_AGENT_INSTRUCTIONS_INTRO` 出厂 rc.3 就已经是"中性措辞"，marker（中性原文）在出厂版里也存在 → 绿灯依据无效 |
| #3 SCOPE_INTRO | 出厂版已无 `These instructions are ACTIVE and MANDATORY for the stated scope`；marker `Use them as guidance when relevant…` 在出厂 `:257` 就有 |
| #24 PRESET_FETCH_ENABLED | `fetch: true` 在出厂 `standard.patch.yml:126 / ptc:125 / cordis:120` 就存在 |
| #50 SESSION_REFERENCE_FRAMING_NEUTRAL | 三份 session-reference 文件出厂即中性措辞 |
| #21 BASH_TIMEOUT_RESTORE | patch 的 pattern 里带 `# [dsh-purge] bash timeout raised`，出厂版永远不可能有 → `softSettle` 直接判 applied。宿主 `dsh-base/cordis.patch.yml:77 / :253` 本来就是 `timeoutMs: 60000`（= 补丁要的值），**目标已达成，只是不是它做的** |

`#71 LIANGSHEN_IDENTITY_LINE` 目标在用户插件 `@linxin666/dsh-liangshen`（`~/.dsh/profiles/desktop/node_modules/`，asar 里没有）→ 无法三方对照，但产物 `# [dsh-purge] liangshen identity line removed` 在文件里，按"产物入文件 + 原文已无"判真生效。

`#101 HUNG_PROMPT_AFTER_PERSONA` 归在真生效：它的 pattern 是 #87 打进去之后才出现的（`dsh-agent-loop/lib/index.js:864` `// [dsh-purge-89] hang after persona` 紧跟着 `#87` 的块），出厂版里当然没有 pattern。

---

## 7. 未验证 / 剩余风险

1. **#67 的漏点（已核实存在，未修）**：`dsh-agent/lib/index.js:235` 的 `decision.messages.length` 仍是裸解引用，比 `agent-loop` 的 guard 更早执行。
2. **#6 在本机不适用（已核实，未修）**：改的是 macOS Seatbelt profile 字符串。
3. **#17 的"零作用"** 只证明到"插件被 `disabled: true`、不组装、editText 对 undefined intent 不做 CAS"这一层；**没有实跑 `tools.edit` 验证"不读也能改"**（改宿主/重启被禁止）。判据是代码 + 组装配置，不是运行时观测。
4. **行为层全部未跑**：本审计只做静态取证，没有一次真实工具调用去触发 #13/#35 的沙箱升级或 #18 的重复提醒——宿主不可重启、不可改，所以"运行时确实不抛错"属**未验证**，我只能证明代码路径上已经没有 throw。
5. `#70` 与 `#73` 共用同一个 marker 字符串，这是 1.3.0 里 `#73` 假绿的直接成因；同类"借用 marker"的写法建议在补丁表里扫一遍（本次只发现这一处是"原地不动还绿"）。
6. 数量对账差 1 条（60 vs 61）未定位。
