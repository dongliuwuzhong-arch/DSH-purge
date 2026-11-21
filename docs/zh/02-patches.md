# 补丁表（88 条）

每条补丁都有 `id` / `name` / `desc` / `file`，然后二选一的改法：

- 现代写法：`replacements: [{ pattern, replace }]` + `markers`
- 早期写法：`patterns` / `replace` / `marker`（88 条里有 7 条还是这个形态：#5 #6 #7 #8 #10 #15 #16）

可选补丁带 `optional: true`——目标不存在时判 `na`，不算失败。

## 分层（实测分布，合计 88）

| layer | 条数 | 管什么 | 改坏了的后果 |
| --- | --- | --- | --- |
| 提示词 / Prompt | 25 | 人格、口径、身份句 | 上下文里换个人说话 |
| 代码 / Code | 52 | 宿主 JS 逻辑（沙箱、审批、prune、guard） | 功能异常，严重时起不来 |
| 工具 / Tools | 8 | 工具描述与 schema | 模型对工具的理解跑偏 |
| 0.1.5 兼容 | 1 | 老版本兜底 | 只影响老宿主 |
| 0.2.0 兼容 | 2 | 中间版本兜底 | 同上 |

## 状态是怎么判的

两级：`patchStatus()` 先按"宿主面"过滤，再逐文件问 `patchFileOutcome()`，最后收成一条补丁一个终态。

**单个文件**（明细口径 `patchFileOutcomeDetail()`，`lib/core.js:4097`；字符串口径 `patchFileOutcome()` 在 `:4126` 把 `satisfied` 折回 `applied`）：

0. 先看 `satisfiedBy`（`core.js:4079-4083`；只有显式声明了的补丁有，现网仅 #24）：声明的 needle 全在、**且已经没有任何非幂等 replacement 能改** → `patchApplied` 成立给 `applied`，否则给 **`satisfied`**；
   needle 全在但还有活 → `pending`（这就是**只降级不升级**，A10 §3.1 反例 A）。它判的是"这个文件本来就写着这条补丁要达成的那件事"，**不是"我们贴过"**——痕迹核对走 `markersWritten` / `landedMarkers`，见下。
1. 再判**结算**（`filePatchSettled()`，`core.js:4028`）：markers 命中、或者替换后的文本已经在。
2. **结算了不等于完事**：只要这条补丁没声明 `skipIfMarked`，而文件里还留着一处**非幂等**的
   replacement 能改（`staleActionableReplacement()`，`core.js:4040`）→ `pending`；否则 `applied`。
3. 没结算、但原文还改得动（`patchHasRemainingWork()`，`core.js:4002`）→ `pending`。
4. 都不成立 → `skipped`。

第 2 步是 1.1.98 那次「#26 假绿」修复的产物：markers 是"任一标记即通过"，只改了一半也会判完成，
所以结算之后还得回头看有没有留下的活（`core.js:4055-4065` 的注释）。声明了 `skipIfMarked` 的按设计不再重打，维持 `applied`。

**收成一条补丁的终态**（`core.js:4571-4584`，优先级从上到下）：

- 六桶字符串：`pending` → `applied` → `unmatched` → `skipped` → `na` / `missing_file`（6 种，`patchStatus()` 返回这个）
- 明细：`pending` → `applied` → **`satisfied`** → `unmatched` → `skipped` → `na` / `missing_file`（`patchStatusDetail()` 的 `details[id].state`）

字符串口径里的 `applied` **同时收着**明细的 `applied` 与 `satisfied`（`core.js:4576`、`:4589`）——所以"打上了"和"本来就没事可做"在六桶里看不出区别。

| 终态 | 怎么来的 | 面板含义 |
| --- | --- | --- |
| `na` | `patchAppliesHere()` 为假（`core.js:4477`，函数在 `:4232`） | 这条在这个宿主面上不跑（桌面 / Web 面差异，不只来自 `optional`） |
| `pending` | 上面第 2、3 步 | 点「应用」会变 |
| `applied` | 第 2 步（结算后无残留）、产物兜底，**以及明细口径折回的 `satisfied`** | **「这个文件上没活可干」**，不等于痕迹在场；`satisfied` 那一档要看 `patchStatusDetail()`，见 [00-运维手册](00-maintenance.md) 3.2.1 |
| `unmatched` | 补丁带 `strictFiles`、原文对不上（`core.js:4504`） | 声明"必须逐字匹配"的补丁失配 |
| `skipped` | 上面第 4 步 | 灰：再点也不会变 |
| `missing_file` | 非 `optional`、且一个目标都没解析到（`core.js:4512`） | 文件不在这棵树里 |

### `markers` 与 `markersWritten` 是两本账

- `markers` / `markersAny` 是**认得的全部证据**：里面混着旧编号别名（#100 的 `[dsh-purge-86]`）、2026-11-01 手打进宿主的手工标记、
  上游原句（#24 的 `fetch: true`）、只对旧宿主有效的分支文案（#62）。**拿它当"应该全部命中"的清单，那几条就永久报没落地。**
- `markersWritten` 是**本表真会写出的那几条**（现网 5 条补丁 / 6 个标记：#24 #62 #100 #101 #102）。
  `patchWrittenMarkers()`（`core.js:3159`）= `markersWritten ∩ markers`，**落地核对只认它**。
- `patchApplied` 仍然用 `markers`（`core.js:3950`）—— 认旧标记是为了不在旧块上再叠一层（#102 的 `skipIfMarked` 靠它），
  收紧等于把已贴好的宿主判成没贴。
- `assert-patches` 有一条自检：写进 `markersWritten` 的标记必须**逐字出现在自己这条补丁的 `replace` 里**，且是 `markers` 的子集。
- **落地率怎么读**：`patchStatusDetail()` 给 `details[id] = {state, landedMarkers, declaredMarkers}`，两个数由 `patchFileOutcomeDetail` 逐文件累加。
  [实测] 现网 #24 = `{state: applied, landedMarkers: 1, declaredMarkers: 4}`：liangshen 那份落了 1 条，三份出厂 preset 一条都没落。
  **补丁级看 1/4、文件级看 0/1（A10 的口径），两者不矛盾**——多目标补丁的落地率必须回到文件级才有意义。
- `replacement.once`：append 型替换的 pattern 打完仍在场，声明了 `once` 的（现网仅 #24 的第二条 replacement）标记已在场就不再贴第二遍。
- `applied` 还有第三条路：**产物兜底**（`core.js:3975-3976`）—— marker 与补丁体彻底脱钩时，用"替换产物在场 + 已经没有可打的 pattern"来认。
  它与 `markersWritten 0/1` 可以并列存在，所以"同一条补丁两个文件，一个 1/1 一个 0/1，面板都绿"不是声明错。

### 两个真实盲区（不是猜测，是测出来的）

- **多目标补丁的"部分完成"看不出来**。#70 挂在 `preset-minimal` 与 `preset-sdk-minimal` 两个文件上：
  一个目标 `applied`、另一个漏了，整条仍报 `applied`（另一个是 `pending` 时整条才降成 `pending`）。
  只有"另一个目标 `skipped`"那种才是假绿——面板不会告诉你哪个文件没打上。
- **人工把文件改回原文，状态会退回 `pending`（不是 skipped）**，点一次「应用」还能打回来。
  `skipped` 只在"没结算、而且原文也改不动"（宿主改版）时出现，那时才真的打不回来。

## 几个值得单独记的条目

| 补丁 | 事 |
| --- | --- |
| #17 FS_OBSERVATION_INTENT_FREE | **运行时空转**：`dsh-base/cordis.patch.yml` 里 `fs-observation-policy` 是 `disabled: true`，插件根本不组装。`tools.edit` 不先读也能改，是宿主 `editText(..., expected?.kind)` 自己的可选判断，不是这条补丁的功劳。 |
| #43 WEB_PRESET_IDENTITY_STRIP | 1.3.3 前在 0.2.2-rc.2 上会把预设打成非法 YAML（身份句多一行没吃掉）。已修。 |
| #56 REWIND_HIDE_CUT_ONLY | rc.2/rc.3 的 `client.js` 是 704,147 字节 / 27 行的压缩构建，四条 pattern 全含 `\n\t\t` 缩进，必然失配。宿主靠 `surfaceOp` 自己处理，这条留作记录。 |
| #67 / #104 | `decision.messages` 裸解引用有两处：`dsh-agent-loop` 和 `dsh-agent`。后者在 pre-step waterfall 里更早执行，#67 兜不住，1.3.1 加的 #104 才补上。 |
| #73 PRESET_BASH_MIRROR_LINE | 1.3.1 前是**假绿**：marker 抄了 #70 的，`skipIfMarked` 一命中就报 applied，删除从来没执行过。 |
| #103 WORKSPACE_INIT_ERROR_LOG | 插 import + try/catch，**不落 `dsh-purge` 字样**——这正是 1.3.3 那个"备份被覆写"P0 的触发点。 |


## 附：#19「工具结果剪枝禁用」为什么禁

这条不是后来加的，是 2026-10-18 首次导入补丁表时就带的（提交 `54b4f2a`），当时没留下理由。
2026-11-15 补记依据（代码 + 实测）：

1. 剪枝会**重写会话历史里的旧消息**（中间段换成 `[... tool result middle pruned ...]`）。前缀一变，
   这条消息之后的请求全部掉出 prefix cache，省下的字符未必抵得过缓存失效。
2. 被剪掉的内容模型拿不回来，需要时只能重新读文件 / 重跑命令，等于多花一轮。
3. 真正被剪的比例很低：宿主默认阈值 8,192 字符，而实测工具结果平均 1,218～2,234 字符/次。

**想要「温和档」：把 #19 排掉 + 调阈值，宿主文件一个字节都不用碰。**
1.3.8 起有排除开关（下一节）：`exclude-patches.json` 里排掉 `19`，再把预设里 `tool-result-pruner`
的 `thresholdChars` 调到 32768（配置层，升级不冲突）。不要走"从 `.dshpurge.bak` 还原 `lib/index.js`
+ 手改预设"那条老路：下一次 `--apply` 会把 #19 重新贴回去（apply 走的是 replacement，不读 marker 回填），
而还原错一个文件就丢掉别的补丁。


### 怎么"永久不贴"某条补丁

```json
// <DSH_HOME>/dsh-purge/exclude-patches.json
{ "excludePatches": [19] }
```

清单在 `lib/core.js:1918`（`readExcludePatches`）/ `:1941`（`withoutExcluded`）读，生效点两处：

- `applyPatchesAllHosts()`—— 七个应用入口全走它（`lib/index.js:1272 / 1345 / 1976 / 2339`、`lib/reapply.js:368`、`bin/dsh-purge.js:95`、`lib/core.js:2399` 的 `ensureHostClean`），所以"到处生效"；
- `patchStatus()`—— 被排掉的 id 不进状态表，面板既不贴也不显示成待贴。

⚠ 1.4.1 起 `applyPatchesAllHosts` **默认只打 `options.aiBase` 明确传进来的那一棵**，
全宿主扫描必须显式 `{ allHosts: true }`（沙箱/测试里以前调用一次就会把现网也写掉，影子 2026-11-16 实测 60 次越界写）。
上面七个调用点都显式开了它；返回值里 `hostPaths` / `skippedHosts` / `scope` 逐条给出打到哪儿，日志也逐条打印。
测试/沙箱还能用 `enumerateHosts`（替换枚举）和 `finishHost: false`（跳过宿主 bin 注入）。

清单写坏了（不是合法 JSON、或字段不是数组）按"没排除"处理。1.3.8 起支持。
典型用法就是 #19：想用温和剪枝，就不能让 #19 把宿主的 `pruneContent()` 改回 `return null`。
