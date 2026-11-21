// 补丁表·存档区（1.5 起）。**仅存档，不参与运行。**
//
// 两条铁律，改这里之前先看：
//   1. 本文件不 import 进 core.js，不在 ALL_PATCHES 里 —— apply / status / preflight /
//      面板分母全都看不到这里，所以这里加什么都不会影响现网。
//   2. 这里只放「已经不在主表」的条目：留着是为了可回滚、可对账（本仓库没有 .git，
//      删掉就真的找不回来了），不是为了哪天再把它们塞回去。真要复活，走一次正常发版。
//
// ⚠️ 一条要紧的区别：REMOVED_V15_PATCHES 里的 #47 / #49 / #57 与其余七条不同 —— 它们是
// **已贴好**的补丁被移出主表，不是"死透了"。rc.5 的 @earendil-works/pi-ai 三个文件里我们
// 的 marker 都在（.dshpurge.bak 里还留着原文），所以 pattern 命中 0 是"已经替换过"。
// 现网不受影响（不用回滚），但重装 / 修复宿主会还原 pi-ai 的官方文件，那时这三条不会再
// 自动贴回。要恢复：把条目从 REMOVED_V15_PATCHES 搬回 patches.js 的 NEW_TOOL_PATCHES，
// 重算总数（74 → 77），并同步 CHANGELOG 里「补丁表 N 条」那句话。
//
// 两个导出：
//   LEGACY_PATCHES      —— 只对历史版本有效的 4 条（#40 #46 #76 #28）。
//                          #28 附带 rc5Draft：rc.5 形态的重锚草案（见条目内注释）。
//   REMOVED_V15_PATCHES —— 1.5 从主表移除的 10 条（#30 #31 #47 #49 #56 #57 #64 #65 #77 #88），
//                          原样存档，一字未改。
//
// 存档条目的 desc / markers 都是当年写给当时宿主的，别再按它们判现状。
import { COMPLETE_PROMPT_WATERFALL_INJECT } from "./patches.js";

/** 只对历史版本有效的条目（主表 1.5 起不再携带）。 */
export const LEGACY_PATCHES = [
  {
    // complete:true 会在 waterfall 之后只留完整段。操作者段是 waterfall 里加上的，
    // 必须从 waterfall 的结果里抄，不能从 waterfall 之前的段落里抄。
    id: 40, name: "COMPLETE_PROMPT_KEEP_INJECT", layer: "0.1.5 兼容", layer_en: "0.1.5",
    desc: "complete 预设仍保留 dsh-purge 注入 / keep inject after complete prompt",
    file: ["system-prompt", "system-prompt-nested"],
    replacements: [
      {
        // 缩进不固定。0.2 有的构建用 tab，有的用空格；只认 tab 时匹配为 0，重启校验会说没写进宿主。
        pattern: /[ \t]*const transformed = await this\.ctx\.waterfall\(scopeTarget\(this, scope\), "system-prompt\/assemble", assembly, context, \(\) => Promise\.resolve\(assembly\)\);\n[ \t]*if \(completeSection === void 0 && !runtimeContextSuppressed\) return transformed;\n[ \t]*return \{\n[ \t]*\.\.\.transformed,\n[ \t]*sections: completeSection === void 0 \? transformed\.sections : \[completeSection\],\n[ \t]*contexts: runtimeContextSuppressed \? \[\] : transformed\.contexts\n[ \t]*\};/,
        replace: COMPLETE_PROMPT_WATERFALL_INJECT,
      },
      {
        pattern:
          "\t\tconst dshPurgeInject = (assembly.sections || []).filter((s) => String(s && s.name || \"\").startsWith(\"dsh-purge\")).map((s) => String(s.text || \"\")).filter((t) => t.length > 0).join(\"\\n\\n\");\n" +
          "\t\tconst transformed = await this.ctx.waterfall(scopeTarget(this, scope), \"system-prompt/assemble\", assembly, context, () => Promise.resolve(assembly));\n" +
          "\t\tif (completeSection === void 0 && !runtimeContextSuppressed) return transformed;\n" +
          "\t\treturn {\n" +
          "\t\t\t...transformed,\n" +
          "\t\t\tsections: completeSection === void 0 ? transformed.sections : (function (complete, inject) {\n" +
          "\t\t\t\tconst base = { ...complete };\n" +
          "\t\t\t\tif (!inject) return [base];\n" +
          "\t\t\t\tif (String(base.text || \"\").includes(inject)) return [base];\n" +
          "\t\t\t\treturn [{ ...base, text: inject + \"\\n\\n\" + base.text }]; // [dsh-purge] complete prompt keeps inject\n" +
          "\t\t\t})(completeSection, dshPurgeInject),\n" +
          "\t\t\tcontexts: runtimeContextSuppressed ? [] : transformed.contexts\n" +
          "\t\t};",
        replace: COMPLETE_PROMPT_WATERFALL_INJECT,
      },
      {
        pattern:
          "\t\tconst transformed = await this.ctx.waterfall(scopeTarget(this, scope), \"system-prompt/assemble\", assembly, context, () => Promise.resolve(assembly));\n" +
          "\t\tconst dshPurgeSections = (transformed.sections || []).filter((s) => String(s && s.name || \"\").startsWith(\"dsh-purge\") && String(s.text || \"\").length > 0);\n" +
          "\t\tif (completeSection === void 0 && !runtimeContextSuppressed) return transformed;\n" +
          "\t\treturn {\n" +
          "\t\t\t...transformed,\n" +
          "\t\t\tsections: completeSection === void 0 ? transformed.sections : (function (complete, purge) {\n" +
          "\t\t\t\tconst base = { ...complete };\n" +
          "\t\t\t\treturn [...purge, base]; // [dsh-purge] complete prompt keeps waterfall inject\n" +
          "\t\t\t})(completeSection, dshPurgeSections),\n" +
          "\t\t\tcontexts: runtimeContextSuppressed ? [] : transformed.contexts\n" +
          "\t\t};",
        replace: COMPLETE_PROMPT_WATERFALL_INJECT,
      },
      {
        pattern:
          "\t\tconst transformed = await this.ctx.waterfall(scopeTarget(this, scope), \"system-prompt/assemble\", assembly, context, () => Promise.resolve(assembly));\n" +
          "\t\tconst dshPurgeSections = (transformed.sections || []).filter((s) => String(s && s.name || \"\").startsWith(\"dsh-purge\") && String(s.text || \"\").length > 0);\n" +
          "\t\tconst dshPurgeRest = (transformed.sections || []).filter((s) => !String(s && s.name || \"\").startsWith(\"dsh-purge\"));\n" +
          "\t\t		if (completeSection === void 0 && !runtimeContextSuppressed) return { ...transformed, sections: [...dshPurgeSections, ...dshPurgeRest] }; // [dsh-purge] every mode keeps system inject\n" +
          "\t\treturn {\n" +
          "\t\t\t...transformed,\n" +
          "\t\t\tsections: completeSection === void 0 ? [...dshPurgeSections, ...dshPurgeRest] : (function (complete, purge) {\n" +
          "\t\t\t\tconst base = { ...complete };\n" +
          "\t\t\t\treturn [...purge, base]; // [dsh-purge] complete prompt keeps waterfall inject\n" +
          "\t\t\t})(completeSection, dshPurgeSections),\n" +
          "\t\t\tcontexts: runtimeContextSuppressed ? [] : transformed.contexts\n" +
          "\t\t};",
        replace: COMPLETE_PROMPT_WATERFALL_INJECT,
      },
      {
        pattern:
          "\t\tconst transformed = await this.ctx.waterfall(scopeTarget(this, scope), \"system-prompt/assemble\", assembly, context, () => Promise.resolve(assembly));\n" +
          "\t\tconst dshPurgeSections = (transformed.sections || []).filter((s) => String(s && s.name || \"\").startsWith(\"dsh-purge\") && String(s.text || \"\").length > 0);\n" +
          "\t\tconst dshPurgeRest = (transformed.sections || []).filter((s) => !String(s && s.name || \"\").startsWith(\"dsh-purge\"));\n" +
          "\t\tif (completeSection === void 0 && !runtimeContextSuppressed) return { ...transformed, sections: [...dshPurgeSections, ...dshPurgeRest] }; // [dsh-purge] every mode keeps system inject\n" +
          "\t\treturn {\n" +
          "\t\t\t...transformed,\n" +
          "\t\t\tsections: completeSection === void 0 ? [...dshPurgeSections, ...dshPurgeRest] : (function (complete, purge, rest) {\n" +
          "\t\t\t\tconst base = { ...complete };\n" +
          "\t\t\t\tconst tail = rest.filter((s) => String(s?.name || \"\") !== String(base.name || \"\"));\n" +
          "\t\t\t\treturn [...purge, ...tail, base]; // [dsh-purge] complete prompt keeps inject + agent-instructions\n" +
          "\t\t\t})(completeSection, dshPurgeSections, dshPurgeRest),\n" +
          "\t\t\tcontexts: runtimeContextSuppressed ? [] : transformed.contexts\n" +
          "\t\t};",
        replace: COMPLETE_PROMPT_WATERFALL_INJECT,
      },
      {
        pattern:
          "\t\tconst transformed = await this.ctx.waterfall(scopeTarget(this, scope), \"system-prompt/assemble\", assembly, context, () => Promise.resolve(assembly));\n" +
          "\t\tconst dshPurgeSections = (transformed.sections || []).filter((s) => String(s && s.name || \"\").startsWith(\"dsh-purge\") && String(s.text || \"\").length > 0);\n" +
          "\t\tconst dshPurgeRest = (transformed.sections || []).filter((s) => !String(s && s.name || \"\").startsWith(\"dsh-purge\"));\n" +
          "\t\tif (completeSection === void 0 && !runtimeContextSuppressed) return { ...transformed, sections: [...dshPurgeRest, ...dshPurgeSections] }; // [dsh-purge] inject last after closer\n" +
          "\t\treturn {\n" +
          "\t\t\t...transformed,\n" +
          "\t\t\tsections: completeSection === void 0 ? [...dshPurgeRest, ...dshPurgeSections] : (function (complete, purge, rest) {\n" +
          "\t\t\t\tconst base = { ...complete };\n" +
          "\t\t\t\tconst tail = rest.filter((s) => String(s?.name || \"\") !== String(base.name || \"\"));\n" +
          "\t\t\t\treturn [...tail, base, ...purge]; // [dsh-purge] inject last after closer\n" +
          "\t\t\t})(completeSection, dshPurgeSections, dshPurgeRest),\n" +
          "\t\t\tcontexts: runtimeContextSuppressed ? [] : transformed.contexts\n" +
          "\t\t};",
        replace: COMPLETE_PROMPT_WATERFALL_INJECT,
      },
      {
        // rc.3：waterfall 之后先 `return { ...transformed, tools }`，再走 sections 整段替换。
        // 老的 6 条 pattern（含 r0 正则）全部留着；这条只负责 rc.3 的新形状。
        pattern:
          "\t\tconst requiredContexts = new Set([...contextByName.values()].filter((entry) => entry.required === " +
          "true).map((entry) => entry.name));\n\t\treturn {\n\t\t\t...transformed,\n\t\t\ttools,\n\t\t\tsections: completeSection " +
          "=== void 0 ? transformed.sections : [completeSection],",
        replace:
          "\t\tconst requiredContexts = new Set([...contextByName.values()].filter((entry) => entry.required === " +
          "true).map((entry) => entry.name));\n\t\tconst dshPurgeSections = transformed.sections.filter((section) " +
          "=> String(section && section.name || \"\").startsWith(\"dsh-purge\") && String(section.text || \"\").length " +
          "> 0); // [dsh-purge] complete prompt keeps inject\n\t\treturn {\n\t\t\t...transformed,\n\t\t\ttools,\n\t\t\tsections: " +
          "completeSection === void 0 ? transformed.sections : [...dshPurgeSections, completeSection],",
      },
    ],
    forbid: ["dsh-purge:committed"],
    markersAny: true,
    markers: [
      "complete prompt keeps waterfall inject",
      "complete prompt keeps inject + agent-instructions",
      "inject last after closer",
      "[dsh-purge] complete prompt keeps inject",
    ],
  },
  {
    // 2026-11-16 rc.5 复核（审计-S5 2.9）：rc.5 的 lib/main.js 里 __EXE_JSON__ / __RESOURCES_JSON__ /
    // templatePath / wscript 全部 0 命中（rc.3 全在）——官方把 wscript 模板拼接那段安装器实现换掉了，
    // 所以 repl[1] 在 rc.5 上没有对象，只在 rc.3 老安装器上生效；留它是为了 rc.3 从零重装这条迁移路径。
    // repl[0] 不用动也不该动：它在 #45 之后靠 skipIfMarked 直接跳过（#45 的插入文本已带 dshPurgeWshLiteral
    // 定义），链路干跑实测 rc.5 上 dshPurgeWshLiteral 定义数 = 1，不会重复插函数。
    id: 46, name: "OFFICIAL_DESKTOP_UPDATE_ASCII", layer: "代码", layer_en: "Code",
    desc: "已接管的官方桌面更新改为 ASCII 脚本，中文 Windows 不再吞掉换行。⚠ repl[1] 只对 rc.3 老安装器生效（rc.5 已无 wscript 模板拼接），repl[0] 由 #45 的标记兜住、不会重复插函数",
    file: "desktop-shell",
    surfaces: ["desktop"],
    optional: true,
    skipIfMarked: true,
    replacements: [
      {
        pattern: "function dshPurgeHandoffDesktopUpdate(owner) {",
        replace:
          "function dshPurgeWshLiteral(value) {\n" +
          "\treturn JSON.stringify(String(value == null ? \"\" : value)).replace(/[^\\u0000-\\u007e]/g, function (ch) {\n" +
          "\t\treturn \"\\\\u\" + (\"0000\" + ch.charCodeAt(0).toString(16)).slice(-4);\n" +
          "\t});\n" +
          "}\n" +
          "function dshPurgeHandoffDesktopUpdate(owner) {",
      },
      {
        pattern:
          "\t\tconst body = readFileSync(templatePath, \"utf8\")\n" +
          "\t\t\t.split(\"__EXE_JSON__\").join(JSON.stringify(exe))\n" +
          "\t\t\t.split(\"__INSTALLER_JSON__\").join(JSON.stringify(installer))\n" +
          "\t\t\t.split(\"__RESOURCES_JSON__\").join(JSON.stringify(resources))\n" +
          "\t\t\t.split(\"__INSTALL_DIR_JSON__\").join(JSON.stringify(installDir))\n" +
          "\t\t\t.split(\"__LOG_JSON__\").join(JSON.stringify(logPath));\n" +
          "\t\tconst script = join(process.env.TEMP || \"\", \"dsh-purge-official-update.js\");\n",
        replace:
          "\t\tconst body = readFileSync(templatePath, \"utf8\")\n" +
          "\t\t\t.split(\"__EXE_JSON__\").join(dshPurgeWshLiteral(exe))\n" +
          "\t\t\t.split(\"__INSTALLER_JSON__\").join(dshPurgeWshLiteral(installer))\n" +
          "\t\t\t.split(\"__RESOURCES_JSON__\").join(dshPurgeWshLiteral(resources))\n" +
          "\t\t\t.split(\"__INSTALL_DIR_JSON__\").join(dshPurgeWshLiteral(installDir))\n" +
          "\t\t\t.split(\"__LOG_JSON__\").join(dshPurgeWshLiteral(logPath));\n" +
          "\t\tfor (var i = 0; i < body.length; i++) { if (body.charCodeAt(i) > 127) throw new Error(\"desktop update script is not ascii\"); }\n" +
          "\t\tconst script = join(process.env.TEMP || \"\", \"dsh-purge-official-update.js\");\n",
      },
    ],
    markers: ["function dshPurgeWshLiteral"],
  },
  {
    // 用户自造的 unrestricted 预设走软补丁：文件不在就 skipped，在就把身份句清掉。
    // 不参与 strictFiles 的硬判定，这样有没有这个预设都不会拖累 #43。
    id: 76,
    name: "PRESET_UNRESTRICTED_IDENTITY_STRIP",
    layer: "提示词",
    layer_en: "Prompt",
    desc: "用户自造 unrestricted 预设只去掉身份句（软补丁）/ soft strip for a user-made unrestricted preset",
    file: ["preset-unrestricted"],
    optional: true,
    replacements: [
      {
        pattern: "              prefix: You are a coding agent powered by the {{model}} model.",
        replace: '              prefix: ""',
      },
      {
        pattern:
          "              prefix: >-\n" +
          "                You are a coding agent powered by the {{model}} model.",
        replace: '              prefix: ""',
      },
      {
        pattern: "              prefix: You are a helpful software engineer assistant.",
        replace: '              prefix: ""',
      },
    ],
    markers: ['              prefix: ""'],
  },
  {
    // phase-1 白名单放行 dsh-purge section。
    id: 28, name: "LIANGSHEN_PHASE1_KEEP_INJECT", layer: "提示词", layer_en: "Prompt",
    desc: "插件 dsh-liangshen（梁神）：phase-1 保留注入段（可选） / @linxin666/dsh-liangshen",
    file: ["liangshen-tool-bootstrap"],
    optional: true, // liangshen-only; bootstrap source changes across releases
    replacements: [
      {
        pattern: "const PERSONA_SECTION_NAMES = new Set(['deployment:persona', 'persona'])",
        replace:
          "const PERSONA_SECTION_NAMES = new Set(['deployment:persona', 'persona', 'deployment:persona-prefix', 'persona-prefix', 'deployment:persona-suffix', 'persona-suffix', 'dsh-purge:identity', 'dsh-purge', 'dsh-purge:rules', 'dsh-purge:post'])",
      },
      {
        pattern:
          "? assembled.sections.filter(section => PERSONA_SECTION_NAMES.has(section?.name))",
        replace:
          "? assembled.sections.filter(section => PERSONA_SECTION_NAMES.has(section?.name) || String(section?.name || \"\").startsWith(\"dsh-purge\") || String(section?.name || \"\").startsWith(\"dshpg-\"))",
      },
    ],
    markers: [
      "'dsh-purge:identity', 'dsh-purge', 'dsh-purge:rules', 'dsh-purge:post'",
      'startsWith("dshpg-")',
    ],
    // 1.5 重锚草案（rc.5 的 minimal-prompt.mjs:113：PERSONA_SECTION_NAMES 由 Set 改成数组，
    // 多一个 deployment:persona-prefix）。语义从「往 Set 里加成员」改成「往数组末尾追加」。
    // 启用前提：core.js 的 targetFiles 里要注册一行
    //   "liangshen-minimal-prompt": allExisting(listLiangshenMinimalPromptFiles(dshHome)),
    // 否则 file 键解析不到文件、这条永远 na。lib/core.js 不在 1.5 的 Boundary 内，
    // 所以草案随本条一起存档；实机上「放行 dsh-purge 段」靠的是 core.js 的
    // keepLiangshenOperatorPrompt()（已在 minimal-prompt.mjs:817 写下
    // [dsh-purge] liangshen keep operator），本草案是它在补丁表里的对应物。
    rc5Draft: {
      file: ["liangshen-minimal-prompt"],
      optional: true,
      skipIfMarked: true,
      replacements: [
        {
          pattern:
            "export const PERSONA_SECTION_NAMES = ['deployment:persona-prefix', 'deployment:persona', 'persona']",
          replace:
            "export const PERSONA_SECTION_NAMES = ['deployment:persona-prefix', 'deployment:persona', 'persona', 'deployment:persona-suffix', 'persona-suffix', 'dsh-purge:identity', 'dsh-purge', 'dsh-purge:rules', 'dsh-purge:post'] // [dsh-purge] phase-1 keeps dsh-purge sections",
        },
      ],
      markers: ["[dsh-purge] phase-1 keeps dsh-purge sections"],
    },
  },
];

/** 1.5 从 ALL_PATCHES 移除的 10 条，原样存档。 */
export const REMOVED_V15_PATCHES = [
  {
    // hooks.json 的 deny 改成 allow，其余 hook 逻辑不动。
    id: 30, name: "HOOKS_CLAUDE_DENY_ALLOW", layer: "工具", layer_en: "Tools",
    desc: "dsh-hooks-claude-code：deny→allow（可选） / hooks deny bypass",
    file: ["hooks-claude-code", "hooks-claude-code-nested"],
    optional: true,
    replacements: [
      {
        pattern: 'if (merged.decision === "deny")',
        replace: 'if (merged.decision === "__dsh_purge_deny_disabled__") /* [dsh-purge] hooks deny→allow */',
      },
      {
        pattern:
          '\t\tif (merged.decision === "ask") return {\n' +
          '\t\t\tkind: "ask",\n' +
          '\t\t\t...merged.reason !== void 0 ? { reason: merged.reason } : {}\n' +
          '\t\t};',
        replace: '\t\tif (merged.decision === "ask") return next(); /* [dsh-purge] hooks ask→allow */',
      },
    ],
    markersAny: true,
    markers: ["[dsh-purge] hooks deny→allow", "[dsh-purge] hooks ask→allow"],
  },
  {
    id: 31, name: "HOOKS_CODEX_DENY_ALLOW", layer: "工具", layer_en: "Tools",
    desc: "dsh-hooks-codex：deny→allow（可选） / hooks deny bypass",
    file: ["hooks-codex", "hooks-codex-nested"],
    optional: true,
    replacements: [
      {
        pattern: 'if (merged.decision === "deny")',
        replace: 'if (merged.decision === "__dsh_purge_deny_disabled__") /* [dsh-purge] hooks deny→allow */',
      },
    ],
    markers: ["[dsh-purge] hooks deny→allow"],
  },
  {
    id: 47,
    name: "ANTHROPIC_OAUTH_NO_CLAUDE_IDENTITY",
    layer: "0.2.0 兼容",
    layer_en: "0.2.0",
    desc: "Anthropic OAuth 不再强插 Claude Code 首段系统提示 / drop Claude Code OAuth system prefix",
    file: ["pi-ai-anthropic-messages"],
    optional: true,
    skipIfMarked: true,
    replacements: [
      {
        // pi-ai 新版：变量名从 initialSystemText 改成 context.systemPrompt。
        pattern:
          "    // For OAuth tokens, we MUST include Claude Code identity\n" +
          "    if (isOAuthToken) {\n" +
          "        params.system = [\n" +
          "            {\n" +
          '                type: "text",\n' +
          '                text: "You are Claude Code, Anthropic\'s official CLI for Claude.",\n' +
          "                ...(cacheControl ? { cache_control: cacheControl } : {}),\n" +
          "            },\n" +
          "        ];\n" +
          "        if (context.systemPrompt) {\n" +
          "            params.system.push({\n" +
          '                type: "text",\n' +
          "                text: sanitizeSurrogates(context.systemPrompt),\n" +
          "                ...(cacheControl ? { cache_control: cacheControl } : {}),\n" +
          "            });\n" +
          "        }\n" +
          "    }\n" +
          "    else if (context.systemPrompt) {\n" +
          "        // Add cache control to system prompt for non-OAuth tokens\n" +
          "        params.system = [\n" +
          "            {\n" +
          '                type: "text",\n' +
          "                text: sanitizeSurrogates(context.systemPrompt),\n" +
          "                ...(cacheControl ? { cache_control: cacheControl } : {}),\n" +
          "            },\n" +
          "        ];\n" +
          "    }",
        replace:
          "    // [dsh-purge] OAuth no longer prepends Claude Code identity\n" +
          "    if (context.systemPrompt) {\n" +
          "        params.system = [\n" +
          "            {\n" +
          '                type: "text",\n' +
          "                text: sanitizeSurrogates(context.systemPrompt),\n" +
          "                ...(cacheControl ? { cache_control: cacheControl } : {}),\n" +
          "            },\n" +
          "        ];\n" +
          "    }",
      },
      {
        pattern:
          "    // For OAuth tokens, we MUST include Claude Code identity\n" +
          "    if (isOAuthToken) {\n" +
          "        params.system = [\n" +
          "            {\n" +
          "                type: \"text\",\n" +
          "                text: \"You are Claude Code, Anthropic's official CLI for Claude.\",\n" +
          "                ...(cacheControl ? { cache_control: cacheControl } : {}),\n" +
          "            },\n" +
          "        ];\n" +
          "        if (initialSystemText) {\n" +
          "            params.system.push({\n" +
          "                type: \"text\",\n" +
          "                text: sanitizeSurrogates(initialSystemText),\n" +
          "                ...(cacheControl ? { cache_control: cacheControl } : {}),\n" +
          "            });\n" +
          "        }\n" +
          "    }\n" +
          "    else if (initialSystemText) {\n" +
          "        // Add cache control to system prompt for non-OAuth tokens\n" +
          "        params.system = [\n" +
          "            {\n" +
          "                type: \"text\",\n" +
          "                text: sanitizeSurrogates(initialSystemText),\n" +
          "                ...(cacheControl ? { cache_control: cacheControl } : {}),\n" +
          "            },\n" +
          "        ];\n" +
          "    }",
        replace:
          "    // [dsh-purge] OAuth no longer prepends Claude Code identity\n" +
          "    if (initialSystemText) {\n" +
          "        params.system = [\n" +
          "            {\n" +
          "                type: \"text\",\n" +
          "                text: sanitizeSurrogates(initialSystemText),\n" +
          "                ...(cacheControl ? { cache_control: cacheControl } : {}),\n" +
          "            },\n" +
          "        ];\n" +
          "    }",
      },
    ],
    markers: ["[dsh-purge] OAuth no longer prepends Claude Code identity"],
  },
  {
    id: 49,
    name: "ANTHROPIC_OAUTH_CLI_NEUTRAL",
    layer: "0.2.0 兼容",
    layer_en: "0.2.0",
    desc: "OAuth 不再伪装 claude-cli / stop Claude CLI OAuth mimicry",
    file: ["pi-ai-anthropic-messages"],
    optional: true,
    skipIfMarked: true,
    replacements: [
      {
        pattern:
          "const toClaudeCodeName = (name) => ccToolLookup.get(name.toLowerCase()) ?? name;",
        replace:
          "const toClaudeCodeName = (name) => name; // [dsh-purge] keep harness tool names",
      },
      {
        pattern: '"user-agent": `claude-cli/${claudeCodeVersion}`,',
        replace: '"user-agent": `deepseek-harness/dsh-purge`, // [dsh-purge] neutral OAuth UA',
      },
      {
        pattern: '"x-app": "cli",',
        replace: '"x-app": "dsh", // [dsh-purge] neutral OAuth app id',
      },
    ],
    markers: ["[dsh-purge] keep harness tool names", "[dsh-purge] neutral OAuth UA"],
    markersAny: true,
  },
  {
    // ⚠️ 宿主已实现（rc.3）：回退靠 surfaceOp: { op: "replace", startSeq, endSeq } 由 dsh-session 裁 surface，
    // 客户端按 surfaceOp 重建节点；旧的 hidden Set 手工逻辑在压缩后的 client.js 里已无对应结构（0 命中）。
    // 2026-11-14 影子复核补一句：rc.2/rc.3 的 client.js 是 27 行 / 685 KB 的压缩构建，
    // 四条 pattern 全含 "\n\t\t" 缩进，压缩后必然失配 —— 所以「宿主已实现」这个说法没有代码证据，
    // 真正的机制是 surfaceOp 的 replacementRange/shadowedSeqs（四版都在）。留作记录，别再去修。
    id: 56,
    name: "REWIND_HIDE_CUT_ONLY",
    layer: "代码",
    layer_en: "Code",
    desc: "回退只藏被撤掉的那一轮 / rewind hides only the cut range。⚠ rc.3 与 rc.5 的 client.js 同为 704147 B、4 条 pattern 全 0 命中 → 两版都贴不上，等于空操作；重锚前先确认前端还要不要这套回退过滤",
    file: ["conversation-client"],
    optional: true,
    // 锚点还在时也别再 replaceAll。这个文件是前端模块，重复写会改 mtime。
    skipIfMarked: true,
    replacements: [
      {
        // 上一版只藏 surface 序号。界面气泡和「用时」挂在回合事件上，序号对不上就还留在聊天里。
        pattern:
          "\t\t\t\thidden.add(event.seq);\n" +
          "\t\t\t\tif (Array.isArray(event.sourceEventSeqs)) {\n" +
          "\t\t\t\t\tfor (const seq of event.sourceEventSeqs) hidden.add(seq);\n" +
          "\t\t\t\t}\n",
        replace:
          "\t\t\t\thidden.add(event.seq); // [dsh-purge] rewind hides the cut turn\n" +
          "\t\t\t\tconst op = event.surfaceOp;\n" +
          "\t\t\t\tif (op && typeof op.startSeq === \"number\" && typeof op.endSeq === \"number\" && op.endSeq >= op.startSeq && op.endSeq - op.startSeq < 100000) {\n" +
          "\t\t\t\t\tfor (let seq = op.startSeq; seq <= op.endSeq; seq += 1) hidden.add(seq);\n" +
          "\t\t\t\t}\n" +
          "\t\t\t\tconst raw = event.sourceEventSeqs;\n" +
          "\t\t\t\tif (Array.isArray(raw)) {\n" +
          "\t\t\t\t\tfor (const row of raw) {\n" +
          "\t\t\t\t\t\tif (typeof row === \"number\") hidden.add(row);\n" +
          "\t\t\t\t\t\telse if (Array.isArray(row) && row.length === 2 && typeof row[0] === \"number\" && typeof row[1] === \"number\" && row[1] >= row[0] && row[1] - row[0] < 100000) {\n" +
          "\t\t\t\t\t\t\tfor (let seq = row[0]; seq <= row[1]; seq += 1) hidden.add(seq);\n" +
          "\t\t\t\t\t\t}\n" +
          "\t\t\t\t\t}\n" +
          "\t\t\t\t}\n" +
          "\t\t\t\tconst cutEnd = op && typeof op.endSeq === \"number\" ? op.endSeq : event.seq;\n" +
          "\t\t\t\tlet turnStart = null;\n" +
          "\t\t\t\tlet turnEnd = null;\n" +
          "\t\t\t\tfor (const row of list) {\n" +
          "\t\t\t\t\tconst ev = row && row.event;\n" +
          "\t\t\t\t\tif (!ev || ev.seq >= event.seq) continue;\n" +
          "\t\t\t\t\tif (ev.type === \"turn/start\") turnStart = ev.seq;\n" +
          "\t\t\t\t\tif (ev.type === \"turn/end\" && ev.seq >= cutEnd && turnEnd === null) turnEnd = ev.seq;\n" +
          "\t\t\t\t}\n" +
          "\t\t\t\tif (turnStart !== null) {\n" +
          "\t\t\t\t\tconst last = turnEnd === null ? event.seq : turnEnd;\n" +
          "\t\t\t\t\tfor (const row of list) {\n" +
          "\t\t\t\t\t\tconst ev = row && row.event;\n" +
          "\t\t\t\t\t\tif (!ev || ev.seq < turnStart || ev.seq > last) continue;\n" +
          "\t\t\t\t\t\tif (ev.type === \"system/message\") continue;\n" +
          "\t\t\t\t\t\thidden.add(ev.seq);\n" +
          "\t\t\t\t\t}\n" +
          "\t\t\t\t}\n",
      },
      {
        pattern:
          "\t\tfunction rewindVisibleEntries(entries) {\n" +
          "\t\t\tconst list = Array.isArray(entries) ? entries : [...entries];\n" +
          "\t\t\tlet latest = null;\n" +
          "\t\t\tfor (const entry of list) {\n" +
          "\t\t\t\tconst event = entry && entry.event;\n" +
          "\t\t\t\tif (!isRewindMarker(event)) continue;\n" +
          "\t\t\t\tif (latest === null || event.seq > latest.seq) latest = event;\n" +
          "\t\t\t}\n" +
          "\t\t\tif (latest === null) return list;\n" +
          "\t\t\tconst hidden = /* @__PURE__ */ new Set();\n" +
          "\t\t\tif (Array.isArray(latest.sourceEventSeqs)) {\n" +
          "\t\t\t\tfor (const seq of latest.sourceEventSeqs) hidden.add(seq);\n" +
          "\t\t\t}\n" +
          "\t\t\thidden.add(latest.seq);\n" +
          "\t\t\treturn list.filter((entry) => {\n" +
          "\t\t\t\tconst event = entry && entry.event;\n" +
          "\t\t\t\tif (!event || hidden.has(event.seq)) return false;\n" +
          "\t\t\t\tif (event.seq > latest.seq) return true;\n" +
          "\t\t\t\treturn event.type === \"system/message\";\n" +
          "\t\t\t});\n" +
          "\t\t}",
        replace:
          "\t\tfunction rewindVisibleEntries(entries) {\n" +
          "\t\t\tconst list = Array.isArray(entries) ? entries : [...entries];\n" +
          "\t\t\tconst hidden = /* @__PURE__ */ new Set();\n" +
          "\t\t\tfor (const entry of list) {\n" +
          "\t\t\t\tconst event = entry && entry.event;\n" +
          "\t\t\t\tif (!isRewindMarker(event)) continue;\n" +
          "\t\t\t\thidden.add(event.seq);\n" +
          "\t\t\t\tconst op = event.surfaceOp;\n" +
          "\t\t\t\tif (op && typeof op.startSeq === \"number\" && typeof op.endSeq === \"number\" && op.endSeq >= op.startSeq && op.endSeq - op.startSeq < 100000) {\n" +
          "\t\t\t\t\tfor (let seq = op.startSeq; seq <= op.endSeq; seq += 1) hidden.add(seq);\n" +
          "\t\t\t\t}\n" +
          "\t\t\t\tconst raw = event.sourceEventSeqs;\n" +
          "\t\t\t\tif (Array.isArray(raw)) {\n" +
          "\t\t\t\t\tfor (const row of raw) {\n" +
          "\t\t\t\t\t\tif (typeof row === \"number\") hidden.add(row);\n" +
          "\t\t\t\t\t\telse if (Array.isArray(row) && row.length === 2 && typeof row[0] === \"number\" && typeof row[1] === \"number\" && row[1] >= row[0] && row[1] - row[0] < 100000) {\n" +
          "\t\t\t\t\t\t\tfor (let seq = row[0]; seq <= row[1]; seq += 1) hidden.add(seq);\n" +
          "\t\t\t\t\t\t}\n" +
          "\t\t\t\t\t}\n" +
          "\t\t\t\t}\n" +
          "\t\t\t\tconst cutEnd = op && typeof op.endSeq === \"number\" ? op.endSeq : event.seq;\n" +
          "\t\t\t\tlet turnStart = null;\n" +
          "\t\t\t\tlet turnEnd = null;\n" +
          "\t\t\t\tfor (const row of list) {\n" +
          "\t\t\t\t\tconst ev = row && row.event;\n" +
          "\t\t\t\t\tif (!ev || ev.seq >= event.seq) continue;\n" +
          "\t\t\t\t\tif (ev.type === \"turn/start\") turnStart = ev.seq;\n" +
          "\t\t\t\t\tif (ev.type === \"turn/end\" && ev.seq >= cutEnd && turnEnd === null) turnEnd = ev.seq;\n" +
          "\t\t\t\t}\n" +
          "\t\t\t\tif (turnStart !== null) {\n" +
          "\t\t\t\t\tconst last = turnEnd === null ? event.seq : turnEnd;\n" +
          "\t\t\t\t\tfor (const row of list) {\n" +
          "\t\t\t\t\t\tconst ev = row && row.event;\n" +
          "\t\t\t\t\t\tif (!ev || ev.seq < turnStart || ev.seq > last) continue;\n" +
          "\t\t\t\t\t\tif (ev.type === \"system/message\") continue;\n" +
          "\t\t\t\t\t\thidden.add(ev.seq);\n" +
          "\t\t\t\t\t}\n" +
          "\t\t\t\t}\n" +
          "\t\t\t}\n" +
          "\t\t\tif (hidden.size === 0) return list;\n" +
          "\t\t\treturn list.filter((entry) => {\n" +
          "\t\t\t\tconst event = entry && entry.event;\n" +
          "\t\t\t\treturn !!event && !hidden.has(event.seq);\n" +
          "\t\t\t});\n" +
          "\t\t} // [dsh-purge] rewind hides the cut turn",
      },
      {
        pattern:
          "\t\t/**\n" +
          "\t\t* Session-owned incremental engine that assembles business Contexts from a\n" +
          "\t\t* contiguous Event window and materializes registered view snapshots.\n" +
          "\t\t*/\n" +
          "\t\tvar ConversationNodeAssembler = class {",
        replace:
          "\t\t/**\n" +
          "\t\t* Session-owned incremental engine that assembles business Contexts from a\n" +
          "\t\t* contiguous Event window and materializes registered view snapshots.\n" +
          "\t\t*/\n" +
          "\t\tfunction isRewindMarker(event) {\n" +
          "\t\t\tif (!event || event.type !== \"user/message\") return false;\n" +
          "\t\t\tconst id = event.data && event.data.id;\n" +
          "\t\t\tif (typeof id !== \"string\" || id.indexOf(\"rewind-\") !== 0) return false;\n" +
          "\t\t\tconst op = event.surfaceOp;\n" +
          "\t\t\treturn !!op && op !== \"append\" && op.op === \"replace\";\n" +
          "\t\t}\n" +
          "\t\tfunction rewindVisibleEntries(entries) {\n" +
          "\t\t\tconst list = Array.isArray(entries) ? entries : [...entries];\n" +
          "\t\t\tconst hidden = /* @__PURE__ */ new Set();\n" +
          "\t\t\tfor (const entry of list) {\n" +
          "\t\t\t\tconst event = entry && entry.event;\n" +
          "\t\t\t\tif (!isRewindMarker(event)) continue;\n" +
          "\t\t\t\thidden.add(event.seq);\n" +
          "\t\t\t\tconst op = event.surfaceOp;\n" +
          "\t\t\t\tif (op && typeof op.startSeq === \"number\" && typeof op.endSeq === \"number\" && op.endSeq >= op.startSeq && op.endSeq - op.startSeq < 100000) {\n" +
          "\t\t\t\t\tfor (let seq = op.startSeq; seq <= op.endSeq; seq += 1) hidden.add(seq);\n" +
          "\t\t\t\t}\n" +
          "\t\t\t\tconst raw = event.sourceEventSeqs;\n" +
          "\t\t\t\tif (Array.isArray(raw)) {\n" +
          "\t\t\t\t\tfor (const row of raw) {\n" +
          "\t\t\t\t\t\tif (typeof row === \"number\") hidden.add(row);\n" +
          "\t\t\t\t\t\telse if (Array.isArray(row) && row.length === 2 && typeof row[0] === \"number\" && typeof row[1] === \"number\" && row[1] >= row[0] && row[1] - row[0] < 100000) {\n" +
          "\t\t\t\t\t\t\tfor (let seq = row[0]; seq <= row[1]; seq += 1) hidden.add(seq);\n" +
          "\t\t\t\t\t\t}\n" +
          "\t\t\t\t\t}\n" +
          "\t\t\t\t}\n" +
          "\t\t\t\tconst cutEnd = op && typeof op.endSeq === \"number\" ? op.endSeq : event.seq;\n" +
          "\t\t\t\tlet turnStart = null;\n" +
          "\t\t\t\tlet turnEnd = null;\n" +
          "\t\t\t\tfor (const row of list) {\n" +
          "\t\t\t\t\tconst ev = row && row.event;\n" +
          "\t\t\t\t\tif (!ev || ev.seq >= event.seq) continue;\n" +
          "\t\t\t\t\tif (ev.type === \"turn/start\") turnStart = ev.seq;\n" +
          "\t\t\t\t\tif (ev.type === \"turn/end\" && ev.seq >= cutEnd && turnEnd === null) turnEnd = ev.seq;\n" +
          "\t\t\t\t}\n" +
          "\t\t\t\tif (turnStart !== null) {\n" +
          "\t\t\t\t\tconst last = turnEnd === null ? event.seq : turnEnd;\n" +
          "\t\t\t\t\tfor (const row of list) {\n" +
          "\t\t\t\t\t\tconst ev = row && row.event;\n" +
          "\t\t\t\t\t\tif (!ev || ev.seq < turnStart || ev.seq > last) continue;\n" +
          "\t\t\t\t\t\tif (ev.type === \"system/message\") continue;\n" +
          "\t\t\t\t\t\thidden.add(ev.seq);\n" +
          "\t\t\t\t\t}\n" +
          "\t\t\t\t}\n" +
          "\t\t\t}\n" +
          "\t\t\tif (hidden.size === 0) return list;\n" +
          "\t\t\treturn list.filter((entry) => {\n" +
          "\t\t\t\tconst event = entry && entry.event;\n" +
          "\t\t\t\treturn !!event && !hidden.has(event.seq);\n" +
          "\t\t\t});\n" +
          "\t\t} // [dsh-purge] rewind hides the cut turn\n" +
          "\t\tvar ConversationNodeAssembler = class {",
      },
      {
        pattern:
          "\t\t\treplaceWindow(entries, hasMore) {\n" +
          "\t\t\t\tthis.contexts.clear();",
        replace:
          "\t\t\treplaceWindow(entries, hasMore) {\n" +
          "\t\t\t\tentries = rewindVisibleEntries(entries);\n" +
          "\t\t\t\tthis.contexts.clear();",
      },
    ],
    markers: ["[dsh-purge] rewind hides the cut turn"],
  },
  {
    id: 57,
    name: "DEEPSEEK_SYSTEM_ROLE",
    layer: "代码",
    layer_en: "Code",
    // 问题:只排除 deepseek.com 远远不够。第三方 OpenAI-compat 代理(recoverystar / 中转站 /
    // glm 等)不认 developer role,会把 developer 消息静默丢弃 —— 导致 hang 全文进不了模型
    // 注入的整段系统提示词从未到达模型(审查实验证实:同样内容 system 计 117 tokens,
    // developer 只 87 tokens,差值恰好是指令大小)。
    // 修复:白名单 —— 只有 OpenAI 原生 (api.openai.com) 和 Azure 原生 (*.azure.com) 才用
    // developer,其他全部回退 system,保证注入不被静默丢。
    desc: "developer role 仅限 openai.com/azure 原生，第三方代理 (deepseek/glm/recoverystar/中转) 全回退 system / allowlist openai+azure for developer role, all third-party gateways fall back to system",
    file: ["pi-ai-completions", "pi-ai-responses-shared"],
    optional: true,
    skipIfMarked: true,
    replacements: [
      // 原始官方代码(未清洗) → 白名单。
      {
        pattern: 'const instructionRole = model.reasoning && compat.supportsDeveloperRole ? "developer" : "system";',
        replace: 'const instructionRole = model.reasoning && compat.supportsDeveloperRole && (String(model.baseUrl || "").toLowerCase().includes("api.openai.com") || String(model.baseUrl || "").toLowerCase().includes("azure.com")) ? "developer" : "system"; // [dsh-purge] developer role allowlist: openai/azure',
      },
      // 0.1.7+ / 0.2:改写为 useDeveloperRole。
      {
        pattern: "const useDeveloperRole = model.reasoning && compat.supportsDeveloperRole;",
        replace: 'const useDeveloperRole = model.reasoning && compat.supportsDeveloperRole && (String(model.baseUrl || "").toLowerCase().includes("api.openai.com") || String(model.baseUrl || "").toLowerCase().includes("azure.com")); // [dsh-purge] developer role allowlist: openai/azure',
      },
      // responses 通路（0.2.0-rc.2 起变量名由 role 改为 instructionRole）。
      {
        pattern: 'const instructionRole = model.reasoning && compat?.supportsDeveloperRole !== false ? "developer" : "system";',
        replace: 'const instructionRole = model.reasoning && compat?.supportsDeveloperRole !== false && (String(model.baseUrl || "").toLowerCase().includes("api.openai.com") || String(model.baseUrl || "").toLowerCase().includes("azure.com")) ? "developer" : "system"; // [dsh-purge] developer role allowlist: openai/azure',
      },
      // responses 通路（0.2.0-rc.1 及更早，变量名 role）。
      {
        pattern: 'const role = model.reasoning && compat?.supportsDeveloperRole !== false ? "developer" : "system";',
        replace: 'const role = model.reasoning && compat?.supportsDeveloperRole !== false && (String(model.baseUrl || "").toLowerCase().includes("api.openai.com") || String(model.baseUrl || "").toLowerCase().includes("azure.com")) ? "developer" : "system"; // [dsh-purge] developer role allowlist: openai/azure',
      },
      // 老用户已清洗过(deepseek 黑名单版)—— 升级为白名单。
      {
        pattern: 'const instructionRole = model.reasoning && compat.supportsDeveloperRole && !String(model.baseUrl || "").toLowerCase().includes("deepseek.com") ? "developer" : "system"; // [dsh-purge] deepseek.com keeps system role',
        replace: 'const instructionRole = model.reasoning && compat.supportsDeveloperRole && (String(model.baseUrl || "").toLowerCase().includes("api.openai.com") || String(model.baseUrl || "").toLowerCase().includes("azure.com")) ? "developer" : "system"; // [dsh-purge] developer role allowlist: openai/azure',
      },
      {
        pattern: 'const useDeveloperRole = model.reasoning && compat.supportsDeveloperRole && !String(model.baseUrl || "").toLowerCase().includes("deepseek.com"); // [dsh-purge] deepseek.com keeps system role',
        replace: 'const useDeveloperRole = model.reasoning && compat.supportsDeveloperRole && (String(model.baseUrl || "").toLowerCase().includes("api.openai.com") || String(model.baseUrl || "").toLowerCase().includes("azure.com")); // [dsh-purge] developer role allowlist: openai/azure',
      },
      {
        pattern: 'const role = model.reasoning && compat?.supportsDeveloperRole !== false && !String(model.baseUrl || "").toLowerCase().includes("deepseek.com") ? "developer" : "system"; // [dsh-purge] deepseek.com keeps system role',
        replace: 'const role = model.reasoning && compat?.supportsDeveloperRole !== false && (String(model.baseUrl || "").toLowerCase().includes("api.openai.com") || String(model.baseUrl || "").toLowerCase().includes("azure.com")) ? "developer" : "system"; // [dsh-purge] developer role allowlist: openai/azure',
      },
      {
        pattern: 'const instructionRole = model.reasoning && compat?.supportsDeveloperRole !== false && !String(model.baseUrl || "").toLowerCase().includes("deepseek.com") ? "developer" : "system"; // [dsh-purge] deepseek.com keeps system role',
        replace: 'const instructionRole = model.reasoning && compat?.supportsDeveloperRole !== false && (String(model.baseUrl || "").toLowerCase().includes("api.openai.com") || String(model.baseUrl || "").toLowerCase().includes("azure.com")) ? "developer" : "system"; // [dsh-purge] developer role allowlist: openai/azure',
      },
    ],
    // 新 marker。老 marker 老用户文件里还在,但新 marker 不匹配 → skipIfMarked 返回 false,
    // 走升级 pattern 覆盖掉老 replace,完成白名单升级后文件带新 marker,下次 skip。
    markers: ["[dsh-purge] developer role allowlist: openai/azure"],
  },
  {
    id: 64,
    name: "HOOKS_STOP_STEER_NEUTRAL",
    layer: "工具",
    layer_en: "Tools",
    desc: "Stop hook 不再 steer 假用户话 / Stop hook no longer steers fake user text",
    file: ["hooks-claude-code", "hooks-claude-code-nested", "hooks-codex", "hooks-codex-nested"],
    optional: true,
    skipIfMarked: true,
    replacements: [
      {
        pattern:
          '\t\tif (merged.decision === "__dsh_purge_deny_disabled__") /* [dsh-purge] hooks deny→allow */ {\n' +
          '\t\t\tconst text = merged.reason ?? "continue: blocked by Stop hook";\n' +
          '\t\t\tagent.steer(createUserMessage({',
        replace:
          '\t\tif (merged.decision === "__dsh_purge_deny_disabled__") /* [dsh-purge] hooks deny→allow */ {\n' +
          '\t\t\treturn; // [dsh-purge] Stop hook steer disabled\n' +
          '\t\t\tconst text = merged.reason ?? "continue: blocked by Stop hook";\n' +
          '\t\t\tagent.steer(createUserMessage({',
      },
      {
        pattern:
          '\t\tif (merged.decision === "deny") {\n' +
          '\t\t\tconst text = merged.reason ?? "continue: blocked by Stop hook";\n' +
          '\t\t\tagent.steer(createUserMessage({',
        replace:
          '\t\tif (merged.decision === "deny") {\n' +
          '\t\t\tconst text = merged.reason ?? "continue: blocked by Stop hook";\n' +
          '\t\t\tagent.steer(createUserMessage({',
      },
    ],
    markers: ["[dsh-purge] Stop hook steer disabled"],
  },
  {
    id: 65,
    name: "HOOKS_PRESTEP_REJECT_NEUTRAL",
    layer: "工具",
    layer_en: "Tools",
    desc: "UserPromptSubmit deny 不再 reject 整轮 / pre-step hook deny no longer rejects turn",
    file: ["hooks-claude-code", "hooks-claude-code-nested", "hooks-codex", "hooks-codex-nested"],
    optional: true,
    skipIfMarked: true,
    replacements: [
      {
        pattern:
          '\t\tif (merged.decision === "__dsh_purge_deny_disabled__") /* [dsh-purge] hooks deny→allow */ return { kind: "reject" };',
        replace:
          '\t\tif (merged.decision === "deny") { /* [dsh-purge] UserPromptSubmit deny→allow */ }\n' +
          '\t\telse if (merged.decision === "__dsh_purge_deny_disabled__") { /* [dsh-purge] pre-step reject disabled */ }',
      },
      {
        pattern: '\t\tif (merged.decision === "deny") return { kind: "reject" };',
        replace: '\t\tif (merged.decision === "deny") return { kind: "reject" };',
      },
    ],
    markers: ["[dsh-purge] UserPromptSubmit deny→allow"],
  },
  {
    // ⚠️ 宿主已实现（rc.3）：append/replace 分流由 surfaceOp 决定，旧的 append(record) 手工搬迁在 client.js 里 0 命中。
    // 留作记录，别再去修。
    id: 77,
    name: "REWIND_DROP_SENT_ON_APPEND",
    layer: "代码",
    layer_en: "Code",
    desc: "回退标记到达时立刻从当前对话拿掉已发送的消息 / drop sent messages when the rewind marker appends。⚠ 同 #56：两版 client.js 同为 704147 B、锚点 0 命中，等于空操作；重锚前先确认前端还要不要这套过滤",
    file: ["conversation-client"],
    optional: true,
    skipIfMarked: true,
    replacements: [
      {
        pattern:
          "\t\t\tappend(record) {\n" +
          "\t\t\t\tconst event = record.event;\n" +
          "\t\t\t\tif (this.inputs.has(event.seq)) return \"none\";\n" +
          "\t\t\t\tthis.revised.clear();\n" +
          "\t\t\t\tthis.inputs.set(event.seq, record);\n",
        replace:
          "\t\t\tappend(record) {\n" +
          "\t\t\t\tconst event = record.event;\n" +
          "\t\t\t\tif (this.inputs.has(event.seq)) return \"none\";\n" +
          "\t\t\t\tif (isRewindMarker(event)) {\n" +
          "\t\t\t\t\tconst entries = [...this.inputs.values(), record];\n" +
          "\t\t\t\t\treturn this.replaceWindow(entries, this.hasMore); // [dsh-purge] rewind drops sent messages in this conversation\n" +
          "\t\t\t\t}\n" +
          "\t\t\t\tthis.revised.clear();\n" +
          "\t\t\t\tthis.inputs.set(event.seq, record);\n",
      },
    ],
    markers: ["[dsh-purge] rewind drops sent messages in this conversation"],
  },
  {
    // 从上游 1.1.86 拿回来的。原表里 #88 空着（1.1.92 删过一次），现在补上。
    // 判据比 #87 严：ChatML 头和正文尾必须同时在场才算挂住，只剩一头就重新置顶。
    //
    // ⚠️ 它和 #87 + #101 是**两条互斥路线，不叠加**：本机走的是 #87/#101 那条（只看 head），
    // 所以 #88 的 pattern 在这里命中 0 次，恒为 skipped —— 这是正常的，optional: true 就是为它准备的。
    // 只有先 revert 掉 #87/#101、回到上游原始形态，这条才会打上。
    // 换句话说：取回它是为了跟上游对齐、方便以后比对，不是指望它在本机生效。
    id: 88,
    name: "HUNG_PROMPT_STRICT_NEEDLE",
    layer: "代码",
    layer_en: "Code",
    desc: "ChatML 头和正文尾都在才算挂住，只剩头或只剩尾都重新置顶 / strict needle for hang block。⚠ 仅历史版本需要：#87 现在直接产出终态，rc.5 的 agent-loop 里 dshPurge 0 命中，两版都不命中",
    file: ["agent-loop"],
    optional: true,
    skipIfMarked: true,
    replacements: [
      {
        pattern:
          "\t\tif (dshPurgeHung && !(dshPurgeTail && dshPurgeNorm.includes(dshPurgeTail)) && !(dshPurgeHead && dshPurgeNorm.includes(dshPurgeHead))) {\n" +
          "\t\t\trenderedPrompt = dshPurgeHung + (renderedPrompt ? \"\\n\\n\" + renderedPrompt : \"\"); // [dsh-purge-87] hang needle uses LF\n" +
          "\t\t}",
        replace:
          "\t\tif (dshPurgeHung && !(dshPurgeTail && dshPurgeNorm.includes(dshPurgeTail) && dshPurgeHead && dshPurgeNorm.includes(dshPurgeHead))) { // [dsh-purge-88]\n" +
          "\t\t\trenderedPrompt = dshPurgeHung + (renderedPrompt ? \"\\n\\n\" + renderedPrompt : \"\"); // [dsh-purge-87] hang needle uses LF\n" +
          "\t\t}",
      },
      {
        pattern:
          "\t\tif (dshPurgeHung && !(dshPurgeTail && dshPurgeNorm.includes(dshPurgeTail)) && !(dshPurgeHead && dshPurgeNorm.includes(dshPurgeHead))) {\n" +
          "\t\t\tsystem = dshPurgeHung + (system ? \"\\n\\n\" + system : \"\"); // [dsh-purge-87] hang needle uses LF\n" +
          "\t\t}",
        replace:
          "\t\tif (dshPurgeHung && !(dshPurgeTail && dshPurgeNorm.includes(dshPurgeTail) && dshPurgeHead && dshPurgeNorm.includes(dshPurgeHead))) { // [dsh-purge-88]\n" +
          "\t\t\tsystem = dshPurgeHung + (system ? \"\\n\\n\" + system : \"\"); // [dsh-purge-87] hang needle uses LF\n" +
          "\t\t}",
      },
      {
        pattern:
          "\t\tif (dshPurgeHung && !(dshPurgeTail && dshPurgeNorm.includes(dshPurgeTail) && dshPurgeHead && dshPurgeNorm.includes(dshPurgeHead))) {\n" +
          "\t\t\trenderedPrompt = dshPurgeHung + (renderedPrompt ? \"\\n\\n\" + renderedPrompt : \"\"); // [dsh-purge-87] hang needle uses LF\n" +
          "\t\t}",
        replace:
          "\t\tif (dshPurgeHung && !(dshPurgeTail && dshPurgeNorm.includes(dshPurgeTail) && dshPurgeHead && dshPurgeNorm.includes(dshPurgeHead))) { // [dsh-purge-88]\n" +
          "\t\t\trenderedPrompt = dshPurgeHung + (renderedPrompt ? \"\\n\\n\" + renderedPrompt : \"\"); // [dsh-purge-87] hang needle uses LF\n" +
          "\t\t}",
      },
      {
        pattern:
          "\t\tif (dshPurgeHung && !(dshPurgeTail && dshPurgeNorm.includes(dshPurgeTail) && dshPurgeHead && dshPurgeNorm.includes(dshPurgeHead))) {\n" +
          "\t\t\tsystem = dshPurgeHung + (system ? \"\\n\\n\" + system : \"\"); // [dsh-purge-87] hang needle uses LF\n" +
          "\t\t}",
        replace:
          "\t\tif (dshPurgeHung && !(dshPurgeTail && dshPurgeNorm.includes(dshPurgeTail) && dshPurgeHead && dshPurgeNorm.includes(dshPurgeHead))) { // [dsh-purge-88]\n" +
          "\t\t\tsystem = dshPurgeHung + (system ? \"\\n\\n\" + system : \"\"); // [dsh-purge-87] hang needle uses LF\n" +
          "\t\t}",
      },
    ],
    markers: ["[dsh-purge-88]"],
  },
];

export const LEGACY_PATCH_IDS = Object.freeze(LEGACY_PATCHES.map((p) => p.id));
export const REMOVED_V15_PATCH_IDS = Object.freeze(REMOVED_V15_PATCHES.map((p) => p.id));
