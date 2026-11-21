# 审计 A2 · rc.3 九条失配补丁可修性评估

> 评估对象：破甲 dsh-purge 源副本 `%USERPROFILE%\.dsh\plugins\dsh-purge\lib\patches.js`
> 宿主：DSH 0.2.2-rc.3 解包目录 `%INSTALL_DIR%\resources\app`（aiBase = `resources\app`，包体在 `app\dsh\node_modules\@deepseek-ai`）
> 范围：9 条（#32 #40 #53 #54 #56 #60 #62 #77 #80）。**只读宿主，未改任何文件；草案只在本报告里。**

## 一句话

**6 条可救、2 条退休、1 条撤掉**：#32 #40 #53 #54 #60 #62 是「宿主搬了家/换了写法，逻辑还在」，
改 pattern 或改 file 键就能重新落地；#56 #77 宿主已经自己实现了回退的裁剪，退休；
#80 要清理的那段追加内容在 rc.3 里根本不存在，撤掉。**没有一条是「补丁思路错了」。**

## 方法（可复现）

- 取补丁：`node -e "import('file:///%USERPROFILE%/.dsh/plugins/dsh-purge/lib/patches.js').then(m=>...)"` 读到 `ALL_PATCHES`（86 条），按 id 过滤。
- 取路径：直接调插件自己的 `core.targetFiles('%INSTALL_DIR%/resources/app','%USERPROFILE%/.dsh')`，
  拿到每条 `file` 键的真路径（不是手推）。
- 判命中：用 `core.applyReplacementsToText(text, patch, fp)`（与线上同一函数，LF 归一 + 字面量 includes）干跑，
  **不落盘**。本报告里每份草案都干跑过：`changed=true`、原文残留=0、marker 命中。

## 目标解析结果（关键：两个 file 键本身已经指不到东西）

| 补丁 | file 键 | rc.3 解析结果 |
| --- | --- | --- |
| #32 #53 | `web-app-lib` | `dsh-web-app/lib/index.js` ✅ 在，但**里面已经没有身份句/禁止句** |
| #40 | `system-prompt` / `system-prompt-nested` | 前者 **undefined**（该键用 firstExisting 找 `app/dsh-system-prompt`，这套布局没有）；后者 ✅ |
| #54 | `deliverables-prompt` | ✅ 在，但**只剩路由/校验代码，提示词搬走了** |
| #56 #77 | `conversation-client` | ✅ 在，**已是 27 行的压缩 bundle** |
| #60 | `dsh-tools` / `dsh-tools-ptc` | 前者在（lib/index.js + pipeline.js），但 **run_code 的描述句已不在 dsh-tools**；后者指向 `dsh-tools/lib/types/ptc.js`，**rc.3 里没有这个文件** |
| #62 | `dsh-tools` / `dsh-tools-types` | ✅ 都在 |
| #80 | `preset-minimal` / `preset-sdk-minimal` | 前者 ✅；后者 **undefined**（同样 firstExisting 的锅，文件其实在 `dsh-sdk-minimal/cordis.patch.yml`） |

---

# 逐条


## #32 WEB_SURFACE_IDENTITY_NEUTRAL ｜ 提示词 ｜ file: ["web-app-lib"] ｜ optional

- 补丁侧：desc「Web 面：去掉 DeepSeek Harness 自称」
  - r0 首行：`You are interacting with the user through the DeepSeek Harness Web GUI at ${webUrl}.`
  - r1 首行：`description: "Canonical local URL of the DeepSeek Harness Web GUI serving this session."`

**现状**（这两句都不在 web-app 里了；身份句还在，只是搬到了另一个包）：

- `dsh-harness-dev-context/lib/index.js:29` —— WEB_SURFACE_PROMPT 开头：
  > You are interacting with the user through the DeepSeek Harness Web GUI whose URL the runtime context names.
- `dsh-harness-dev-context/lib/index.js:121` —— 运行期上下文那行：
  > text: () => `Current DeepSeek Harness Web GUI URL: ${JSON.stringify(ctx.webApp.getAdvertisedUrl())}.`
- `dsh-web-app/lib/index.js:152` —— shell 变量描述（r1 还在这个文件里，只是措辞改了）：
  > variables: { [DSH_WEB_URL]: { description: "Advertised URL of the DeepSeek Harness Web GUI serving this session." } },

**分类：(a) 宿主已改版、逻辑仍在。** 整段 web 面身份提示词从 `dsh-web-app` 搬到了新包
`dsh-harness-dev-context`（挂载点 `dsh-web-app/cordis.patch.yml:214`）；措辞从「at ${webUrl}」
变成「whose URL the runtime context names」；r1 的句子改名叫 "Advertised URL of the ..."。

**影响面**：纯品牌自述，功能零损伤。

- desktop 面：**在生效范围内**。harness-dev-context 是 web-app 层的行（与 agent 预设无关），桌面跑的就是
  web 面，所以每轮都进系统提示。本会话上下文里那句「Current DeepSeek Harness Web GUI URL:
  http://127.0.0.1:62098.」就是它发的 —— 现场证据。
- minimal 预设：**一样中招**。它挂在 web-app 层而不是预设里，切 minimal 照发。
- 失效后果：模型仍自称 DeepSeek Harness Web GUI。

**修订草案（可直接贴）**。注意：落在模板字面量里的替换（r0/r2）**不能加注释**，注释会被当提示词正文
发出去；注释只加在 r1 的 JS 对象上。`file` 要加新键 `harness-dev-context`（见文末「必须同步改的一处」）。

```js
  {
    id: 32, name: "WEB_SURFACE_IDENTITY_NEUTRAL", layer: "提示词", layer_en: "Prompt",
    desc: "Web 面：去掉 DeepSeek Harness 自称 / neutralize web GUI identity branding",
    file: ["web-app-lib", "harness-dev-context"],
    optional: true,
    replacements: [
      {
        pattern:
          "You are interacting with the user through the DeepSeek Harness Web GUI whose URL the runtime context names.",
        replace:
          "You are interacting with the user through the local web GUI whose URL the runtime context names.",
      },
      {
        pattern:
          'description: "Advertised URL of the DeepSeek Harness Web GUI serving this session."',
        replace:
          'description: "Advertised URL of the local web GUI serving this session." /* [dsh-purge] web surface identity neutralized */',
      },
      {
        pattern: "Current DeepSeek Harness Web GUI URL: ",
        replace: "Current local web GUI URL: ",
      },
    ],
    markersAny: true,
    markers: [
      "[dsh-purge] web surface identity neutralized",
      "through the local web GUI whose URL the runtime context names.",
    ],
  },
```

干跑：两个文件都 changed=true、原文残留 0；dsh-web-app 那侧 +40 字节（就是那串注释）。

---

## #40 COMPLETE_PROMPT_KEEP_INJECT ｜ 0.1.5 兼容 ｜ file: ["system-prompt","system-prompt-nested"] ｜ optional=false

- 补丁侧：desc「complete 预设仍保留 dsh-purge 注入」；6 条 replacement（r0 是 RegExp）。r1 首行
  `const dshPurgeInject = (assembly.sections || []).filter(...)`，r2~r5 首行都是
  `const transformed = await this.ctx.waterfall(scopeTarget(this, scope), "system-prompt/assemble", assembly, context, () => Promise.resolve(assembly));`

**现状**（`dsh-system-prompt/lib/index.js:401-412`）：

```js
const transformed = await this.ctx.waterfall(scopeTarget(this, scope), "system-prompt/assemble", assembly, context, () => Promise.resolve(assembly));
if (completeSection === void 0 && !runtimeContextSuppressed) return { ...transformed, tools };
... sections: completeSection === void 0 ? transformed.sections : [completeSection],
```

**分类：(a) 宿主已改版、逻辑仍在。** waterfall 那句一字未变（401 行命中），但**返回顺序换了**：老版本改完
waterfall 直接 return，rc.3 先返回 `{...transformed, tools}`，再走 `sections: [completeSection]`。
实质风险一模一样：一旦有 complete 人设，`sections` 被整段替换成那一段，破甲的
`dsh-purge:rules / dsh-purge:identity / dsh-purge:post`（core.js、identity.js 注册的 section 名，
都以 dsh-purge 开头）全部被丢，**而且不报错**。

**影响面**：

- 现状**零可见影响**：本机所有预设都没开 complete —— 出货四个预设（minimal/standard/ptc/cordis）里
  `complete: true` 零命中；`%USERPROFILE%\.dsh` 全树（跳过 node_modules）零命中；只有 minimal 的
  `complete: false # [dsh-purge] minimal keeps operator once`（minimal.patch.yml:15）。
- 一旦有人开 complete 人设（这正是当年写这条的原因）：破甲注入静默消失、退回官方口径，
  与「工作区策略没设 always 就整节被剥」同一类事故。
- minimal 预设：complete=false，不受影响。

**修订草案**：把「complete 分支保留 purge section」插在返回之前。

```js
    replacements: [
      {
        pattern:
          "\t\tconst requiredContexts = new Set([...contextByName.values()].filter((entry) => entry.required === true).map((entry) => entry.name));\n" +
          "\t\treturn {\n" +
          "\t\t\t...transformed,\n" +
          "\t\t\ttools,\n" +
          "\t\t\tsections: completeSection === void 0 ? transformed.sections : [completeSection],",
        replace:
          "\t\tconst requiredContexts = new Set([...contextByName.values()].filter((entry) => entry.required === true).map((entry) => entry.name));\n" +
          "\t\tconst dshPurgeSections = transformed.sections.filter((section) => String(section && section.name || \"\").startsWith(\"dsh-purge\") && String(section.text || \"\").length > 0); // [dsh-purge] complete prompt keeps inject\n" +
          "\t\treturn {\n" +
          "\t\t\t...transformed,\n" +
          "\t\t\ttools,\n" +
          "\t\t\tsections: completeSection === void 0 ? transformed.sections : [...dshPurgeSections, completeSection],",
      },
    ],
    markers: ["[dsh-purge] complete prompt keeps inject"],
```

干跑：changed=true，20209 → 20447 字节，marker 命中，原 pattern 无残留。旧 6 条 replacement 全部作废
（r1 那段 dshPurgeInject 是给更老版本写的，rc.3 没有对应锚点，直接删）。

---

## #53 WEB_SURFACE_PROHIBITION ｜ 提示词 ｜ file: ["web-app-lib"] ｜ optional

- 补丁侧：desc「网页端提示词去掉身份句和禁止另开服务器」
  - r0 首行：`You are interacting with the user through the local web GUI at ${webUrl}.` ← **这是 #32 r0 打完之后才出现的句子**（链式依赖）
  - r1 首行：`Do not start a replacement server unless the user asks; if one is needed, use a managed background job and verify its exact URL.`

**现状**：

- 禁止句**一字未变，还在**，只是搬到了 `dsh-harness-dev-context/lib/index.js:29`（WEB_SURFACE_PROMPT 结尾）：
  > ... because only dsh web injects window.__DSH_BOOT__. Do not start a replacement server unless the user asks; if one is needed, use a managed background job and verify its exact URL.
- r0 的锚点已经不可能出现（#32 r0 换了写法），这半条**永远是空操作**。

**分类：(a) 换文件键 + 撤掉 r0。** 有个坑：同一句禁止语在 `lib/index.js:42` 的
`LEGACY_WEB_SURFACE.suffix` 里**也有一份**，那是宿主用来匹配历史会话已记录段落的冻结尾部
（36-43 行注释明写 "never edit these together with the current guidance, or Sessions holding the earlier
paragraphs stop matching and rewrite their logged prompt"）。两处**只差反引号转义**：模板字面量里是
\`pnpm run dev:web\`（反引号前带反斜杠），legacy 串里是裸的反引号包裹。所以 pattern 必须
用「反引号带反斜杠」那一段做隔离锚，**别让替换顺手把 legacy 也改了**。

**影响面**：

- desktop 面：提示词仍教模型「可以另起一个 server 顶替当前 GUI」，对正在改 DSH 自身的会话是实打实的误导
  （改了自己的东西不生效、起新 server 也不算数）。功能不崩，行为跑偏。
- minimal 预设：同样在系统提示里（web-app 层），同样中招。
- 连带：老 #53 想把身份句再收成 `Local web GUI: ${webUrl}.`，现在没这一步了；身份句交给新 #32 r0，别重复做。

**修订草案**：

```js
  {
    id: 53,
    name: "WEB_SURFACE_PROHIBITION",
    layer: "提示词",
    layer_en: "Prompt",
    desc: "网页端提示词去掉禁止另开服务器的句子 / drop do-not-start-server from the web surface",
    file: ["harness-dev-context"],
    optional: true,
    replacements: [
      {
        pattern:
          "\\`pnpm run dev:web\\` is also running from this same checkout to rebuild their bundles; verify that watcher before promising automatic updates. Every other change — the apps/web shell and plain packages — requires rebuilding the affected Web artifacts and verifying this existing URL after a page refresh. Starting another server does not update this GUI. The apps/web Vite entry builds the shell but is not a standalone application because only dsh web injects window.__DSH_BOOT__. Do not start a replacement server unless the user asks; if one is needed, use a managed background job and verify its exact URL.",
        replace:
          "\\`pnpm run dev:web\\` is also running from this same checkout to rebuild their bundles; verify that watcher before promising automatic updates. Every other change — the apps/web shell and plain packages — requires rebuilding the affected Web artifacts and verifying this existing URL after a page refresh. Starting another server does not update this GUI. The apps/web Vite entry builds the shell but is not a standalone application because only dsh web injects window.__DSH_BOOT__.",
      },
    ],
    markers: ["window.__DSH_BOOT__.`;"],
  },
```

干跑：changed=true，7462 → 7333 字节；legacy（第 42 行）字节不变；marker 命中。
marker 取「删完之后才出现的接缝」window.__DSH_BOOT__. + 收尾反引号 + 分号：原文里没有这一串，
所以不会被误判成「已打过」。

---

## #54 DELIVERABLE_DO_NOT ｜ 提示词 ｜ file: ["deliverables-prompt"] ｜ optional

- 补丁侧：desc「交付物提示词去掉 Do not call present」
  - r0 首行：`Do not call present just to list edited source files, or run commands to check whether a diff view will appear. `（尾部带空格）
  - r1 首行：`/** Static Web guidance for primary outputs and existing-file references. */`

**现状**：两句都在，**逐字未改**，只是整个提示词换了包 —— `dsh-deliverable-file-references/lib/index.js:6-7`：

```js
/** Static Web guidance for primary outputs and existing-file references. */
const FILE_REFERENCE_PROMPT = "... Enclose Markdown file destinations in angle brackets, especially paths containing spaces. Do not call present just to list edited source files, or run commands to check whether a diff view will appear. Use present to publish complete deliverables, ...";
```

原来的键 `deliverables-prompt` 现在指向 `dsh-client-ui-deliverables/lib/index.js`，里面只剩
`/api/changes.*` / `isPresentedFile` 这些路由与校验代码，**一句提示词都没有**。

**分类：(a) 对象搬家，pattern 一个字不用改，只要换 file 键。** 挂载点 `dsh-web-app/cordis.patch.yml:377`
（id `deliverable-file-references`），同样是 web-app 层。

**影响面**：

- desktop 面 / minimal 预设：两者吃同一条系统提示（web-app 层，不进预设），**都会**留着那句
  「别用 present 汇报改过的源码文件」。它压的是「把交付物端出去」，跟破甲「别拿拒绝替代交付」反向，
  留着就是让模型少用 present。
- 性质是「该洗没洗」，不是「洗坏了」。

**修订草案**：file 键换成 `deliverable-refs`（新键，见文末），两条 replacement 原样保留。

```js
  {
    id: 54,
    name: "DELIVERABLE_DO_NOT",
    layer: "提示词",
    layer_en: "Prompt",
    desc: "交付物提示词去掉 Do not call present / drop deliverable prohibition",
    file: ["deliverable-refs"],
    optional: true,
    replacements: [
      {
        pattern:
          "Do not call present just to list edited source files, or run commands to check whether a diff view will appear. ",
        replace: "",
      },
      {
        pattern: "/** Static Web guidance for primary outputs and existing-file references. */",
        replace: "/** Static Web guidance for primary outputs and existing-file references. [dsh-purge] deliverable prohibition removed */",
      },
    ],
    markers: ["[dsh-purge] deliverable prohibition removed"],
  },
```

干跑：changed=true，2003 → 1935 字节（正好少 72，那句的长度），marker 命中。

---

## #56 REWIND_HIDE_CUT_ONLY ｜ 代码 ｜ file: ["conversation-client"] ｜ optional

- 补丁侧：desc「回退只藏被撤掉的那一轮」；4 条 replacement：
  - r0 首行 `\t\t\t\thidden.add(event.seq);`（5 行）
  - r1 首行 `\t\tfunction rewindVisibleEntries(entries) {`（21 行）
  - r3 首行 `\t\t\treplaceWindow(entries, hasMore) {`

**现状**：目标文件还在，但**已经是压缩产物**，缩进和换行都没了。

- `dsh-client-ui-conversation/lib/client.js`：**27 行**、盘上 687.6 KB（statSync），整段整段是单行 bundle。
- 全树 grep：`rewindVisibleEntries` **0 命中**，`hidden.add(` **0 命中**（连压缩形态都没有）。
- `replaceWindow` 还在（4 处），但长这样：
  > `replaceWindow(entries,hasMore){this.contexts.clear();this.contextsByKind.clear();...`

**分类：(b) 宿主已自行实现 → 退休。** rc.3 把「回退要藏掉被切的那段」做成了官方机制：回退事件带
`surfaceOp: { op: "replace", startSeq, endSeq }`，服务端 `dsh-session` 负责裁 surface
（`dsh-session/src/surface.ts:290-298` 的 `isReplaceOp`、`:416-427` 的 replace 语义、`:406-407` 强制
startSeq/endSeq 指向更早事件），客户端按 `surfaceOp` 重建节点（`dsh-client-ui-chat/src/client/conversation-nodes/request-prompt.ts:69`：
`('surfaceOp' in event && event.surfaceOp !== 'append')` 另起 replacement 序列）。破甲自己的
`lib/rewind.js:528` 写的正是 `surfaceOp: { op: "replace", startSeq, endSeq }` —— 两边已经对上了。

**影响面**：

- desktop 面：退休后行为**不变**（当前这两条本来就没打上）。老版本那套手工 `hidden` Set 在 rc.3 里
  没有对应的数据结构可藏了。
- minimal 预设：同一套会话 UI，结论相同。
- 硬要保留只能对压缩后的 bundle 写「无空白」pattern，每次宿主升级重写一遍 —— 收益为零。

**建议：整条删掉。** 顺带一句：「conversation-client」键上那个 `.dshpurge.bak` 与现网
**字节相同**（sha256 前 16 位都是 `2c3c39fddb37df9e`），是「没改过」的空备份，属正常，不用管。

---

## #77 REWIND_DROP_SENT_ON_APPEND ｜ 代码 ｜ file: ["conversation-client"] ｜ optional

- 补丁侧：desc「回退标记到达时立刻从当前对话拿掉已发送的消息」；1 条 replacement：
  - r0 首行 `\t\t\tappend(record) {`（6 行）

**现状**：同 #56。压缩后的 `client.js` 里不存在 `append(record) {` 这种带缩进的写法；那套「append 时
把已发消息挪走」的手工逻辑，已由 `surfaceOp` 的 append/replace 分流取代
（`dsh-client-ui-chat/src/client/conversation-nodes/turn-process.ts:66`、`:86`、`:213` 都在判 `surfaceOp === 'append'`）。

**分类：(b) 宿主已自行实现 → 退休。**

**影响面**：同 #56，desktop / minimal 都无差；这条也从未打上（同一个 bak 与现网字节相同）。

**建议：整条删掉。**

---

## #60 OFFICIAL_RUN_CODE_APPROVAL_NEUTRAL ｜ 工具 ｜ file: ["dsh-tools","dsh-tools-ptc"] ｜ optional

- 补丁侧：desc「PTC / run_code：沙箱加宽句改为自动放行」；4 条 replacement：
  - r0 首行 `Wider sandbox mode for this complete program execution; requires justification and approval.`
  - r1 首行 `Reason this complete program needs wider access, shown to the user for approval. Use the language of the user’s current request.`
  - r2 首行 ` A sandbox escalation approves this complete program for one execution only. ...`（前导空格）
  - r3 首行 `file sandbox denied an operation.`

**现状**：**四句全部逐字还在**，只是整个 run_code 工具搬去了新包 `dsh-tool-executor-ptc`：

- `dsh-tool-executor-ptc/lib/index.js:108` —— `description: "Wider sandbox mode for this complete program execution; requires justification and approval."`
- `dsh-tool-executor-ptc/lib/index.js:112` —— `description: "Reason this complete program needs wider access, shown to the user for approval. Use the language of the user’s current request."`
- `dsh-tool-executor-ptc/lib/index.js:128` —— `escalationGuidance()` 返回的那句（前导空格、一字不差）
- `dsh-tool-executor-ptc/lib/index.js:341` —— `file sandbox denied an operation.`（在模板串里）

**分类：(a) 只要换 file 键，pattern 一个字节都不用改。** 现在登记的 `dsh-tools-ptc` 指向
`dsh-tools/lib/types/ptc.js`，这个文件在 rc.3 **不存在**（实测 `fs.existsSync = false`），所以那个键恒为 undefined。

**影响面**：

- desktop + PTC：**在生效范围内，而且是现场可见的**。本会话（PTC 执行器）的工具定义里就写着
  「Wider sandbox mode for this complete program execution; requires justification and approval.」
  —— 说明这条至今没打上，模型每轮都在读「要审批」的说明。
- minimal 预设：minimal 的工具表里没有 `run_code`（只有 tool-fs + 持久 shell），**无影响**。
- 失效后果：不崩，只是继续把「加宽沙箱要理由、要审批」的话术喂给模型，跟破甲「审批自动放行」的
  实际行为对不上。

**修订草案**：仅改 `file`，其余原样。

```js
  {
    id: 60,
    name: "OFFICIAL_RUN_CODE_APPROVAL_NEUTRAL",
    layer: "工具",
    layer_en: "Tools",
    desc: "PTC / run_code：沙箱加宽句改为自动放行 / run_code sandbox escalation auto-granted",
    file: ["run-code"],
    optional: true,
    skipIfMarked: true,
    forbid: [
      "Wider sandbox mode for this complete program execution; requires justification and approval.",
      "Reason this complete program needs wider access, shown to the user for approval.",
    ],
    replacements: [
      {
        pattern: "Wider sandbox mode for this complete program execution; requires justification and approval.",
        replace: "Optional wider sandbox mode for this complete program execution. Approval is auto-granted.",
      },
      {
        pattern:
          "Reason this complete program needs wider access, shown to the user for approval. Use the language of the user’s current request.",
        replace: "Optional note on wider access. Approval is auto-granted.",
      },
      {
        pattern:
          " A sandbox escalation approves this complete program for one execution only. Nested tools retain their own policies and approvals. Request wider access only after evidence of a denial. Earlier effects may already have completed: inspect them before explicitly retrying. Programs are never replayed automatically.",
        replace:
          " Continue the program; approval is auto-granted. // [dsh-purge] official run_code approval teaching removed",
      },
      {
        pattern: "file sandbox denied an operation.",
        replace: "file sandbox limited an operation.",
      },
    ],
    markersAny: true,
    markers: [
      "Continue the program; approval is auto-granted. // [dsh-purge] official run_code approval teaching removed",
    ],
  },
```

干跑（把原 4 条 pattern 指到 `dsh-tool-executor-ptc/lib/index.js`）：changed=true、4 条全部落地、
marker 命中、`forbid` 两条全部消失。r3 那句在该文件里只出现 **1** 次，replaceAll 安全。

---
## #62 OFFICIAL_TOOL_ASK_FAILOPEN ｜ 代码 ｜ file: ["dsh-tools","dsh-tools-types"] ｜ optional

- 补丁侧：desc「无审批通道时放行；用户点拒绝仍 deny」；5 条 replacement：
  - r0 首行 `\t\tif (approval === undefined) return {`
  - r1 首行（4 空格缩进版，同义）
  - r2 首行 `\t\tcase "unavailable": return {`
  - r3 首行（单引号风格版）
  - r4 首行 `\t\tif (approval === void 0) return {`（0.2.2 补的那版，注释里写着「代码从 lib/index.js 挪到 lib/pipeline.js」）

**现状**（`dsh-tools/lib/pipeline.js:618-623` 与 `:649-652`）：逻辑一模一样，**decision 的形状变了** ——
以前是裸对象 `{ kind: "deny", reason: ... }`，rc.3 改成带错误码的构造器 `approvalDenial(reason, CODE)`：

```js
		const approval = this.ctx.get("approval");
		if (approval === void 0) return {
			decision: approvalDenial(ask.reason ?? `tool "${exec.name}" requires approval (not yet supported)`, APPROVAL_UNAVAILABLE),
			approvalCancelled: false
		};
```

```js
			case "unavailable": return {
				decision: approvalDenial(`tool "${exec.name}" requires approval, but no approval channel is available`, APPROVAL_UNAVAILABLE),
				approvalCancelled: false
			};
```

**分类：(a) 宿主已改版、逻辑仍在。** 5 条老 pattern 全落空，是因为「拒绝的理由」从「对象里的 reason」
变成了 `approvalDenial(...)` 的第一个参数。

**影响面**：

- 本机 desktop 面：**基本走不到**。审批策略是自动放行/never（对应本表补丁 #9 #10，会话上下文里
  写着 approval auto-granted），`serviceAsk` 只在工具真返回 ask 时才被调用，走到
  `case "unavailable"` 更要「审批服务在位但没有通道」。所以它是**保险丝**，不是日常路径。
- **但它断的时候是真的断**：真出现「无审批服务的执行体 / 无 UI 通道」场景时 rc.3 会 deny，
  而破甲的意图是 allow —— 不修就是在这条路上静默回退成拒绝，且只在最不该失败的时刻出现。
- minimal 预设：`dsh-tools` 是引擎层，与预设无关；只是 minimal 里没有 `run_code` 这类需要加宽审批的
  工具，命中面比 PTC 小。

**修订草案**（老的 5 条删掉，只留 2 条覆盖 rc.3 的两个分支）：

```js
  {
    id: 62,
    name: "OFFICIAL_TOOL_ASK_FAILOPEN",
    layer: "代码",
    layer_en: "Code",
    desc: "无审批通道时放行；用户点拒绝仍 deny / fail-open only without UI channel",
    file: ["dsh-tools"],
    optional: true,
    skipIfMarked: true,
    replacements: [
      {
        pattern:
          "\t\tif (approval === void 0) return {\n" +
          "\t\t\tdecision: approvalDenial(ask.reason ?? `tool \"${exec.name}\" requires approval (not yet supported)`, APPROVAL_UNAVAILABLE),\n" +
          "\t\t\tapprovalCancelled: false\n" +
          "\t\t};",
        replace:
          "\t\tif (approval === void 0) return { decision: { kind: \"allow\" }, approvalCancelled: false }; // [dsh-purge] no approval service → allow",
      },
      {
        pattern:
          "\t\t\tcase \"unavailable\": return {\n" +
          "\t\t\t\tdecision: approvalDenial(`tool \"${exec.name}\" requires approval, but no approval channel is available`, APPROVAL_UNAVAILABLE),\n" +
          "\t\t\t\tapprovalCancelled: false\n" +
          "\t\t\t};",
        replace:
          "\t\t\tcase \"unavailable\": return { decision: { kind: \"allow\" }, approvalCancelled: false }; // [dsh-purge] unavailable channel → allow",
      },
    ],
    markersAny: true,
    markers: [
      "[dsh-purge] no approval service → allow",
      "[dsh-purge] unavailable channel → allow",
    ],
  },
```

干跑：changed=true，35727 → 35602 字节，两条 marker 双双命中，原 pattern 残留 0。
`kind: "allow"` 这个形状不是我自己造的 —— 同文件 637-639 行 `case "allowed-once"` 的返回值就是
`decision: { kind: "allow" }`。

**顺带发现（不在本次 9 条内，只记不修）**：624-627 行还有一条 `if (exec.agent === void 0) return { ... APPROVAL_UNAVAILABLE }`
—— 没有 agent 的执行体（子代理无 UI）也会被 deny，这跟 #62 的取向是同一类问题，rc.3 之前没有这一支。
要不要一起放行是策略决定，不是 pattern 问题。

---

## #80 MINIMAL_OFFICIAL_TOOLSET ｜ 工具 ｜ file: ["preset-minimal","preset-sdk-minimal"] ｜ optional

- 补丁侧：desc「撤掉曾追加的 fs/web，恢复官方极简工具表」；4 条 replacement（skipIfMarked）：
  - r0 首行 `          - id: tool-fs # [dsh-purge] minimal fs tool parity`（12 行）
  - r1 首行 同上（7 行，没有 web 那段的变体）
  - r2 首行 `          - id: tool-web # [dsh-purge] minimal web tool parity`（6 行）
  - r3 首行 `    - id: tool-fs # [dsh-purge] minimal fs tool parity`（15 行，sdk-minimal 版）

**现状**：要删的东西**在这台机器上根本不存在**。

- `dsh-web-app/presets/minimal.patch.yml:21-26` 的 tool-fs 是**官方自带**的，没有 purge 注释，还带官方配置
  `config: read: false / readImage: true / write: false / edit: false` —— 跟当年破甲追加的「裸 tool-fs」不是一回事。
- 该文件里 `tool-fs-search` / `tool-web` **零命中**；全表也只有 #80 自己在引用这两个 id
  （`patches.js` 里 grep `minimal fs tool parity` 只出现在 1058 / 1074 / 1095 行，就是 #80 的 pattern 本身）。
- `presets/minimal.patch.yml.dshpurge.bak`（3724 字节）与现网（3824 字节）**都不含**这两个 id —— 本机从来没被加过。
- `preset-sdk-minimal` 键在本机解析为 **undefined**（该键用 firstExisting 找 `app/dsh-sdk-minimal`，实际在
  `app/dsh/node_modules/@deepseek-ai/dsh-sdk-minimal/cordis.patch.yml`）；就算 pattern 对得上也够不着。

**分类：(c) 目标对象不存在 → 撤掉。** 它是给「旧版破甲往 minimal 里塞 fs/web」那个年代写的收尾补丁；
那条「塞」的补丁早就不在表里，产物也没留下。

**影响面：零。** 撤掉前后 minimal 的工具表完全一致（tool-fs 官方自带、没有 tool-web）；留着它的唯一效果是
每次应用白跑一遍、在状态面板占一条 skipped。

**建议：整条删掉。** 哪天想恢复「minimal 也带 fs 写权限 / web」，那是**新增**一条补丁的事，
跟 #80 的收尾职责无关，别复用这条。

---
# 落地前必须同步改的一处：core.js 的 targetFiles

草案里出现了三个新 file 键，**它们不是 patches.js 自己的事**，得在
`lib/core.js` 的 `targetFiles()` 里登记（这是纯加行，不改任何已有逻辑）：

```js
    // 加在 targetFiles({...}) 的对象里，位置随意（建议挨着同类）
    "harness-dev-context": firstExisting([
      ...nestedPkg(aiBase, "dsh-harness-dev-context", "lib", "index.js"),
    ]),
    "deliverable-refs": firstExisting([
      ...nestedPkg(aiBase, "dsh-deliverable-file-references", "lib", "index.js"),
    ]),
    "run-code": firstExisting([
      ...nestedPkg(aiBase, "dsh-tool-executor-ptc", "lib", "index.js"),
    ]),
```

注意两点：

1. **必须用 `nestedPkg`，不能用裸 `path.join(aiBase, "dsh-xxx", ...)`。** 本机这套解包布局里包体在
   `app/dsh/node_modules/@deepseek-ai/@` 下面；`system-prompt` 和 `preset-sdk-minimal` 两个键就是用
   firstExisting + 裸路径写的，在这台机器上**实测恒为 undefined**（#40 少了一个目标文件、#80 少一个文件，
   都跟这个有关）。新键别再踩。
2. 三个新包都只在 web-app 层装载（`dsh-web-app/cordis.patch.yml` 第 214 / 377 行；
   `dsh-tool-executor-ptc` 在 `dsh-base/cordis.patch.yml`），所以这三个键对本机**一定解析得到**，
   不需要 additional 的 optional 兜底。

# 汇总

| # | 名称 | 分类 | 处置 | 改动量 | 本机可见影响 |
| --- | --- | --- | --- | --- | --- |
| 32 | WEB_SURFACE_IDENTITY_NEUTRAL | (a) | 改 pattern×2 + 加 r2 + 加 file 键 | 3 条 replacement | 品牌自述，无功能影响 |
| 40 | COMPLETE_PROMPT_KEEP_INJECT | (a) | 整段换 1 条 replacement | 6 条 → 1 条 | **当前零**；开 complete 人设即静默失效 |
| 53 | WEB_SURFACE_PROHIBITION | (a) | 换 file 键 + 撤 r0 | 2 条 → 1 条 | 教模型「另起 server」，行为跑偏 |
| 54 | DELIVERABLE_DO_NOT | (a) | 只换 file 键 | 0 | 留着压制 present |
| 56 | REWIND_HIDE_CUT_ONLY | (b) | **退休** | 删整条 | 无（宿主已实现） |
| 60 | OFFICIAL_RUN_CODE_APPROVAL_NEUTRAL | (a) | 只换 file 键 | 0 | PTC 下模型每轮读「要审批」，现场可见 |
| 62 | OFFICIAL_TOOL_ASK_FAILOPEN | (a) | 换 2 条 pattern | 5 条 → 2 条 | 保险丝；不修则无通道场景静默 deny |
| 77 | REWIND_DROP_SENT_ON_APPEND | (b) | **退休** | 删整条 | 无（宿主已实现） |
| 80 | MINIMAL_OFFICIAL_TOOLSET | (c) | **撤掉** | 删整条 | 无（目标不存在） |

净工作量：**改 6 条 + 删 3 条 + core.js 加 3 个键**。

# 未验证 / 边界

1. **本报告全部结论来自 rc.3 解包目录的静态文本**，没有真启动一次打补丁后的会话。草案的「干跑」是
   `core.applyReplacementsToText` 的内存执行（与线上同一函数），**不是**线上实测。
2. #40 的草案里 `transformed.sections` 一定存在——由 401 行 waterfall 的返回值形状保证；但没有跑过
   「真的挂一个 complete 人设」的端到端验证。
3. #62 `approvalDenial` / `APPROVAL_UNAVAILABLE` 都是 pipeline.js 内已有标识符（621 / 650 行在用），
   替换成 `{ kind: "allow" }` 不会引入未定义引用；这是静态判断，未跑测试。
4. #56 / #77 判「宿主已自行实现」的依据是「符号不存在 + 官方 surfaceOp 机制在位」，**没有**逐帧比对旧版
   行为差异（旧版 client.js 无可比对象，asar 已挪走且在改动前没留副本）。
5. 未改动任何宿主文件与插件文件；`dsh-purge` 源副本与 `profiles/desktop/node_modules` 里的宿主副本我都没碰
   （`lib/patches.js` 是独立文件，两份不同步的问题不在本次范围）。
