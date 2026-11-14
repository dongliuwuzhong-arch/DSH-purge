# 实现 A5 · A2 草案落地

> 角色：破甲补丁实现工程师（子代理 agent-5）。
> 输入：`记录/审计-A2-失配评估.md`（6 条草案 + core.js 键清单）、`记录/审计-A1-补丁实证.md`（#73/#104 已修完，未动）。
> 时间：2026-11-14 02:26（本机）。

## 一句话

6 条草案全部落进补丁表（除 #53 那条会误伤 legacy 的老 r1 外，其余老 pattern 一条没删，新 pattern 只追加），`targetFiles()` 里两个恒为 undefined 的键换成 `nestedPkg`、并新增 3 个新键，
#56 #77 #80 只加注释不动结构，补丁表仍是 **87 条**。三道门全绿（`patches=87 unique_ids=ok changelog=87` / soul-guard ok / **123 条测试全过**，115 → 123）。
**有一处偏离草案：#53 的老 r1（裸句删除）被撤掉了**，理由见「没能照草案做的部分」第 1 条。
**另有一条数字对不上**：判据里说的「applied 69/87」在本机三条路径上都复现不出来（实测 live 宿主 62/87、Desktop 备份副本 64/87），下面给了逐条实测口径。

## 一、边界与产物

改动只落在这几个文件（两份副本逐字节一致）：

```
~/.dsh/profiles/desktop/node_modules/dsh-purge/lib/patches.js   ← 独立文件，改
~/.dsh/plugins/dsh-purge/lib/patches.js                          ← 独立文件，同步（sha 同）
lib/core.js                                                      ← 硬链接，原地截断写，两份同时变（nlink 仍为 2、ino 不变）
test/patch-r3-drafts.test.mjs                                    ← 新增（两份都放）
CHANGELOG.md · release-notes.md · package.json                   ← 1.3.2
soul-guard.lock                                                  ← --update 重写基线（#32 #40 属灵魂层）
```

没碰：宿主 `%INSTALL_DIR%` 下任何文件（全部只读打开）、`记录/` 下已有的 A1~A4 报告、DSH 进程、网络、git。

## 二、逐条改动清单

### 2.1 六条补丁（`lib/patches.js`）

| # | 行 | 改动 | 原因 |
| --- | --- | --- | --- |
| 32 | 1144-1145 | 加块前注释（rc.3 搬去了 harness-dev-context） | 说明为什么多一个 file 键 |
| 32 | 1148 | `file: ["web-app-lib"]` → `["web-app-lib","harness-dev-context"]` | 旧键留着，新键追加 |
| 32 | 1163-1181 | +3 条 replacement：首行「whose URL the runtime context names」、`Advertised URL of the …` 变量描述、`Current DeepSeek Harness Web GUI URL: ` | rc.3 措辞变了 + 身份句搬到新包，原来的 2 条在 rc.3 上是空操作 |
| 32 | 1188-1189 | markers 追加 2 条（新首行、新上下文行） | markersAny，产物必须认得出 |
| 40 | 1614-1627 | +1 条 replacement：`requiredContexts …` → 先算 `dshPurgeSections`，再把 `[...dshPurgeSections, completeSection]` 写进 sections | rc.3 先 `return {...transformed, tools}` 再整段替换 sections，`dsh-purge:rules/identity/post` 会被静默丢掉 |
| 40 | 1635 | markers 追加 `[dsh-purge] complete prompt keeps inject` | 新产物要能被 status 认成 applied |
| 53 | 2196 | `file: ["web-app-lib"]` → `["web-app-lib","harness-dev-context"]` | 同上 |
| 53 | 2203-2205 | **撤掉**老 r1（裸句删除），改写成注释说明 | 见「偏离」第 1 条 |
| 53 | 2206-2225 | +1 条 replacement：以「反引号带反斜杠」的 `\`pnpm run dev:web\`` 段起锚，删掉 ` Do not start a replacement server …exact URL.` | 与 legacy 冻结尾部隔离 |
| 53 | 2229 | markers 追加「window.__DSH_BOOT__.`;」（模板字面量的收尾接缝） | 新产物没有可加的注释（在模板字面量里），只能靠接缝认 |
| 54 | 2233 | 加块前注释 | — |
| 54 | 2239 | `file: ["deliverables-prompt"]` → `+ "deliverable-refs"` | 提示词搬到 dsh-deliverable-file-references，pattern 一字未改 |
| 60 | 2985-2986 | 加块前注释 | — |
| 60 | 2992 | `file: ["dsh-tools","dsh-tools-ptc"]` → `+ "run-code"` | run_code 整体搬到 dsh-tool-executor-ptc；`dsh-tools-ptc` 指向的 types/ptc.js 在 rc.3 不存在（保留，不删） |
| 62 | 3114-3133 | +2 条 replacement：`approval === void 0` 分支与 `case "unavailable"` 分支，改成 `decision: { kind: "allow" }` | rc.3 把 `reason` 换成 `approvalDenial(reason, CODE)`，老 5 条全落空 |
| 56 | 2623-2625 | 只加注释：宿主已实现（surfaceOp），留作记录 | 父级要求不改结构 |
| 77 | 2826-2827 | 只加注释：宿主已实现，留作记录 | 同上 |
| 80 | 1048-1049 | 只加注释：官方自带（tool-fs 带 config），留作记录 | 同上 |

### 2.2 `lib/core.js` 的 `targetFiles()`

| 行 | 改动 | 原因 |
| --- | --- | --- |
| 3230-3232 | 新增 `harness-dev-context`（nestedPkg） | #32 #53 的新落点 |
| 3336-3340 | `preset-sdk-minimal`：裸 `path.join(aiBase,…)` → `nestedPkg`，monorepo 兜底保留 | 裸路径在 `app/dsh/node_modules/@deepseek-ai` 布局下恒 undefined |
| 3365-3370 | `system-prompt`：同上改 `nestedPkg` | #40 少一个目标文件就是这个造成的 |
| 3413-3416 | 新增 `deliverable-refs`（nestedPkg） | #54 的新落点 |
| 3460-3463 | 新增 `run-code`（nestedPkg） | #60 的新落点 |

`nestedPkg` 同时覆盖 `<aiBase>/<pkg>/…` 与 `<aiBase>/dsh/node_modules/@deepseek-ai/<pkg>/…`，所以「aiBase 指向 @deepseek-ai」和「aiBase 指向 resources/app」两种都能解析。

## 三、回放验证（`applyReplacementsToText` 现网文件 + `patchFileOutcome`，与线上同一函数，内存里跑不落盘）

```
=== 宿主 %INSTALL_DIR%/resources/app/dsh/node_modules/@deepseek-ai
状态分布: {"applied":62,"na":15,"pending":6,"skipped":4}  applied=62/87
关注项: #32:pending #40:pending #53:pending #54:pending #60:pending #62:pending #56:skipped #77:skipped #80:skipped

### #32 WEB_SURFACE_IDENTITY_NEUTRAL  file=["web-app-lib","harness-dev-context"]  status=pending
   - dsh-web-app/index.js | outcome pending -> applied | changed=true idem=true | bytes 7844 -> 7884 | 原文残留=0 | markers 1/4
   - dsh-harness-dev-context/index.js | outcome pending -> applied | changed=true idem=true | bytes 7472 -> 7450 | 原文残留=0 | markers 2/4
### #40 COMPLETE_PROMPT_KEEP_INJECT  file=["system-prompt","system-prompt-nested"]  status=pending
   - dsh-system-prompt/index.js | outcome pending -> applied | changed=true idem=true | bytes 20217 -> 20455 | 原文残留=0 | markers 1/4
       forbid 残留 = 0
   - system-prompt-nested => (未解析到文件)
### #53 WEB_SURFACE_PROHIBITION  file=["web-app-lib","harness-dev-context"]  status=pending
   - dsh-web-app/index.js | outcome skipped -> skipped | changed=false idem=true | bytes 7844 -> 7844 | 原文残留=0 | markers 0/3
   - dsh-harness-dev-context/index.js | outcome pending -> applied | changed=true idem=true | bytes 7472 -> 7343 | 原文残留=0 | markers 1/3
### #54 DELIVERABLE_DO_NOT  file=["deliverables-prompt","deliverable-refs"]  status=pending
   - dsh-client-ui-deliverables/index.js | outcome skipped -> skipped | changed=false idem=true | bytes 10931 -> 10931 | 原文残留=0 | markers 0/1
   - dsh-deliverable-file-references/index.js | outcome pending -> applied | changed=true idem=true | bytes 2005 -> 1937 | 原文残留=0 | markers 1/1
### #60 OFFICIAL_RUN_CODE_APPROVAL_NEUTRAL  file=["dsh-tools","dsh-tools-ptc","run-code"]  status=pending
   - dsh-tools/index.js | outcome skipped -> skipped | changed=false idem=true | bytes 27559 -> 27559 | 原文残留=0 | markers 0/1
       forbid 残留 = 0
   - dsh-tools/pipeline.js | outcome skipped -> skipped | changed=false idem=true | bytes 35733 -> 35733 | 原文残留=0 | markers 0/1
       forbid 残留 = 0
   - dsh-tools-ptc => (未解析到文件)
   - dsh-tool-executor-ptc/index.js | outcome pending -> applied | changed=true idem=true | bytes 86116 -> 85836 | 原文残留=0 | markers 1/1
       forbid 残留 = 0
### #62 OFFICIAL_TOOL_ASK_FAILOPEN  file=["dsh-tools","dsh-tools-types"]  status=pending
   - dsh-tools/index.js | outcome skipped -> skipped | changed=false idem=true | bytes 27559 -> 27559 | 原文残留=0 | markers 0/3
   - dsh-tools/pipeline.js | outcome pending -> applied | changed=true idem=true | bytes 35733 -> 35612 | 原文残留=0 | markers 2/3
   - lib/index.js | outcome skipped -> skipped | changed=false idem=true | bytes 16708 -> 16708 | 原文残留=0 | markers 0/3
```

要点：

- 6 条 × 每个目标文件：`changed=true`、第二次 `changed=false`（幂等）、原文残留 0、markers 命中、`patchFileOutcome` 由 `pending` 变 `applied`（#53 的 web-app-lib 与 #54 的 deliverables-prompt、#60 的 dsh-tools 三种是「该文件本来就没这句」，保持 `skipped`，不影响整条补丁判 applied）。
- #40 的 `forbid: ["dsh-purge:committed"]` 打完后仍为 0 残留。
- #60 `forbid` 两条（「requires justification and approval」「shown to the user for approval」）打完全部消失。

### 3.1 整机串行模拟（87 条全表按顺序在内存里跑一遍）

比逐条更接近 `applyPatches` 的做法：把 `targetFiles()` 解析到的宿主文件全读进内存，按补丁表顺序一条条打，然后回看这六条。

```
$ node _a5/verify-serial.mjs
被改动文件数: 6
#32 整机串行之后: applied=2 pending=0 skipped=0
#40 整机串行之后: applied=1 pending=0 skipped=0
#53 整机串行之后: applied=2 pending=0 skipped=0
#54 整机串行之后: applied=1 pending=0 skipped=1
#60 整机串行之后: applied=1 pending=0 skipped=2
#62 整机串行之后: applied=1 pending=0 skipped=2
第二遍 changed 次数: 0
```

解读：六条在各自**真正**的目标文件上全部 `applied`（`skipped` 的那几条是同一补丁在多键下的无关文件，如 #54 的 deliverables-prompt 已不含提示词），
第二遍一个字节都不再改 —— 全表幂等。整表跑完只改到 6 个文件，因为本机另外 62 条早就打在宿主上、pattern 已经不在了。

## 四、patchStatus 改前 / 改后（宿主 `resources/app/dsh/node_modules/@deepseek-ai`）

| 口径 | 改前 | 改后 |
| --- | --- | --- |
| 状态分布 | `{applied:62, na:15, skipped:10}` | `{applied:62, na:15, pending:6, skipped:4}` |
| applied | **62/87** | **62/87** |
| pending | 0 | **6** |
| #32 #40 #53 #54 #60 #62 | 全部 `skipped` | 全部 `pending` |
| #56 #77 #80 | `skipped` | `skipped`（注释不入判据） |

**为什么 applied 没升**：这一轮的边界是「禁止改宿主 `%INSTALL_DIR%` 下任何东西」，所以补丁只改到插件表、没有往宿主落盘。
`patchStatus` 读的是宿主盘上的现状，它这六个数字只能从 `skipped`（补丁在这一版宿主上无从下手）变成 `pending`（现在点「应用」真的会改到东西）。
真正「pending → applied」的证据在上一节：把同一条 `applyReplacementsToText` 的结果喂回 `patchFileOutcome`，6 条全部 `applied`，测试套件也把这条钉住了。

**关于「69/87」**：这个数在本机三条路径上都对不上，实测如下（同一条命令、同一份代码）：

```
%INSTALL_DIR%/resources/app/dsh/node_modules/@deepseek-ai   applied 62/87  ← 现网宿主
%DESKTOP%/DSH升级rc3/备份/app/dsh/node_modules/@deepseek-ai  applied 64/87  ← findAiBase() 在裸 node 下解析到的备份副本
%INSTALL_DIR%/resources/app（app 根，非 @deepseek-ai）                applied 0/87   ← 这套布局所有键都解析不到，这就是 A2 说的「裸 aiBase 路径恒 undefined」
enumeratePatchAiBases() = [Desktop备份, 现网宿主]  ← 只有这两个
```

所以「69/87」既不是现网宿主、也不是备份副本；我没有找到任何缓存状态文件（`~/.dsh` 下只有 override-state / session-archive 两个 json，都不含 applied 计数）。
交付的数字以上表为准；如果父会话那个 69 是在另一台机器或另一版宿主上量的，请以那边的口径复核，这不影响本轮改动本身。

## 五、三个门

在 `~/.dsh/plugins/dsh-purge` 跑（`~/.dsh/profiles/desktop/node_modules/dsh-purge` 同样三个门、同样结果）：

```
$ node scripts/assert-patches.mjs
patches=87 unique_ids=ok changelog=87
✓ 补丁表自检通过                                   [exit 0]

$ node scripts/assert-soul-guard.mjs --update
soul-guard.lock 已重写：16 条补丁 + 1 个文件，digest e5683b3ae203        [exit 0]
$ node scripts/assert-soul-guard.mjs
soul-guard ok：1 个注入文件 + 16 条破甲补丁与基线一致（digest e5683b3ae203）  [exit 0]

$ node --test "test/*.test.mjs"
ℹ tests 123  ℹ pass 123  ℹ fail 0                     [exit 0]
```

**灵魂层 --update 的理由**（改到灵魂层才需要，这里确实改到了）：`SOUL_PATCH_IDS` 里有 #32 和 #40。
- #32 只把「DeepSeek Harness Web GUI」换成「local web GUI」——与原意完全一致，不软化、不扩写；
- #40 是「complete 分支仍保住 dsh-purge 段」这件事对着 rc.3 的返回顺序重做一遍，注入正文一个字没动；
- `lib/default-prompt-inject.md` 未改动（指纹里只有两条补丁变了）。
这条理由同时写进了 CHANGELOG 的「灵魂层」小节。

顺带跑了 `scripts/check-bak-judge.mjs`（不在三道门里）：exit 0，1 个 would-refresh 是 Desktop 备份副本的 dsh-workspace，与本轮无关。

## 六、测试

新增 `test/patch-r3-drafts.test.mjs`，8 条用例：

| 用例 | 钉什么 |
| --- | --- |
| #32 | rc.3 三处（首行 / 变量描述 / 运行期上下文行）全部换掉，原文一个不剩 |
| #40 | 产物含 `dshPurgeSections`、`[...dshPurgeSections, completeSection]` 与 marker |
| #53 | **legacy 第 42 行一个字节都没动**、现行文案里那句只剩 legacy 那一份、接缝是干净的 `…__DSH_BOOT__.`;` |
| #54 | 那句被删、docblock 留 marker、净差 68 字节 |
| #60 | 三条改写全部落地、`forbid` 两句一句不剩 |
| #62 | 两个分支各放行一次、`APPROVAL_UNAVAILABLE` 不再出现 |
| 老 pattern | 六条都保留了旧的 pattern / marker（#53 只保留了 r0，r1 是撤掉的，见下） |
| #56 #77 #80 | 还在表里、`replacements` 没被清空 |

片段全部从宿主原文**原样抠出来**（不是手打），所以 pattern 与 rc.3 是逐字节对齐的。

## 七、没能照草案做的部分（重要）

### 1. #53 的老 r1 撤掉了，不是「只追加」

草案建议「换 file 键 + 撤 r0」，父级要求「老 pattern 留着」。**两条我都只做到一半，原因是一个实测事故**：

- 老 r1 的 pattern 只有那句禁止语本身，没有上下文锚；`dsh-harness-dev-context/lib/index.js:42` 的 `LEGACY_WEB_SURFACE.suffix` 里**同一句也有一份**。
- 我先按「老的留着」实现（老 r1 + 新带锚点的），回放结果：`7472 → 7216`（少 **256** 字节 = 两句 128×2），legacy 被改；
  宿主那段注释明写「never edit these together with the current guidance, or Sessions holding the earlier paragraphs stop matching and rewrite their logged prompt」。
- 撤掉老 r1、只留带锚点的版本后：`7472 → 7343`（少 **129** 字节，正好是一句），legacy 第 42 行一个字节没动（测试里钉死了）。

覆盖率没有丢：带锚点的版本匹配的是「反引号带反斜杠」的模板字面量，旧宿主的同一段也是这个形态；
唯一不再覆盖的是 legacy 那一份——而那份本来就不该动。这条偏离已写进 CHANGELOG。

### 2. #56 #77 #80 没删（A2 建议「整条删掉」）

按父级指示「不改结构，只加注释」。代价：这三条每次应用会白跑一遍、在状态面板上各占一条 `skipped`。
收益：补丁表条数不变（87），以后有人在 rc.3 上再看到它们失配时，注释会先把「宿主已实现 / 官方自带」说出来。

### 3. applied 数没有上升（不是漏做，是边界）

见第四节。要让它升，得往宿主落盘（`applyPatches`）——这轮明确禁止。

### 4. A2 报告里一处算术笔误

#54 干跑写的是「2003 → 1935 字节（正好少 72）」，实测 `2005 → 1937`，净差 **68**（-112 删句 + 44 marker）。
差值一致（都是 68），只是绝对值差 2、结论数字写成 72。测试按实测的 68 钉。

### 5. 没做的验证

- 没重启 DSH、没真跑一次 `applyPatches` 落盘 → **端到端行为（尤其 #40 真的挂一个 complete 人设）未实测**，只有 pattern/回放级证据（与 A2 报告同一水平）。第 3.1 节的整机串行模拟是最接近落盘的一步，但它仍然只是内存。
- #62 顺带发现（A2 已标注「只记不修」）：`dsh-tools/lib/pipeline.js:624-627` 的 `if (exec.agent === void 0) return { … APPROVAL_UNAVAILABLE }` 同样会把无 agent 的执行体 deny 掉。**按 A2 说的没动**——那是策略决定（要不要连它一起放行），不是 pattern 问题。

## 八、风险清单

| 风险 | 现状 | 处置 |
| --- | --- | --- |
| #40 的 `transformed.sections` 未做 `|| []` 兜底 | 沿用草案；`dsh-system-prompt:401` 的 waterfall 返回 assembly，sections 必然存在 | 记录，不自行加兜底（改了就不是草案了） |
| #32 的 markers 有 4 条、markersAny | 任一命中即 applied；web-app-lib 只命中 1 条（注释），harness-dev-context 命中 2 条 | 刻意为之：多布局下不可能每条都命中 |
| #53 依赖「反引号带反斜杠」的锚 | 若哪天宿主把模板字面量改成普通字符串，这条会再失配 | 失配是 `pending→skipped`，不会误删；注释里已写明为什么这么锚 |
| `dsh-tools-ptc` 键仍指向不存在的 `types/ptc.js` | 保留（老宿主还要） | 无副作用：`pathsOf` 对缺文件返回空 |
| 宿主一升级就重新封 asar | 本轮没动宿主，状态未变 | 升级后按 CHANGELOG 1.3.0 的升级顺序走 |

## 九、复现命令

```
NODE=%INSTALL_DIR%/resources/runtime/primary-runtime/dependencies/node/bin/node.exe
cd %USERPROFILE%/.dsh/plugins/dsh-purge
$NODE scripts/assert-patches.mjs
$NODE scripts/assert-soul-guard.mjs
$NODE --test "test/*.test.mjs"

# 回放（只读宿主，不落盘）
$NODE %WORKSPACE%\专项任务\破甲/_a5/verify-replay.mjs
```

脚本都留在 `%WORKSPACE%\专项任务\破甲/_a5/`：`edit-patches.mjs`（改 patches.js）、`edit-core.mjs`（改 targetFiles）、`verify-replay.mjs`（逐条回放）、`verify-serial.mjs`（整机串行）、`probe-status.mjs` / `probe-status2.mjs`（只读量状态）。
