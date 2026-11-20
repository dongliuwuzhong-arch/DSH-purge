# 补丁表（87 条）

每条补丁都有 `id` / `name` / `desc` / `file`，然后二选一的改法：

- 现代写法：`replacements: [{ pattern, replace }]` + `markers`
- 早期写法：`patterns` / `replace` / `marker`（87 条里有 7 条还是这个形态：#5 #6 #7 #8 #10 #15 #16）

可选补丁带 `optional: true`——目标不存在时判 `na`，不算失败。

## 分层（实测分布，合计 88）

| layer | 条数 | 管什么 | 改坏了的后果 |
| --- | --- | --- | --- |
| 提示词 / Prompt | 25 | 人格、口径、身份句 | 上下文里换个人说话 |
| 代码 / Code | 51 | 宿主 JS 逻辑（沙箱、审批、prune、guard） | 功能异常，严重时起不来 |
| 工具 / Tools | 8 | 工具描述与 schema | 模型对工具的理解跑偏 |
| 0.1.5 兼容 | 1 | 老版本兜底 | 只影响老宿主 |
| 0.2.0 兼容 | 2 | 中间版本兜底 | 同上 |

## 状态是怎么判的

`patchFileOutcome()` 的实际顺序（`lib/core.js`）：

1. **先看 marker 结算**：补丁的 `markers` 命中当前文件 → 直接 `applied`
2. **再回头看原文**：`pattern` 还能命中、且这处替换"做了有用"（`staleActionableReplacement`）→ `pending`
3. 两样都不成立 → `skipped`（灰）
4. `skipIfMarked: true` 的补丁，marker 一命中就结算，不再看原文

### 两个真实盲区（不是猜测，是测出来的）

- **marker 命中即 applied，多目标补丁会因此假绿**。#70 挂在 `preset-minimal` 与 `preset-sdk-minimal`
  两个文件上，只要其中一个留着 marker，整条就报 applied，另一个漏了看不出来。
- **人工把文件改回原文，状态会退回 `pending`（不是 skipped）**，点一次「应用」还能打回来。
  `skipped` 只在 pattern 彻底消失（宿主改版）时出现——那时才真的打不回来。

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

**想要「温和档」不必改补丁代码**：把宿主 `lib/index.js` 还原成同目录的 `.dshpurge.bak`，
再把预设里 `tool-result-pruner` 的 `thresholdChars` 调到 32768（配置层，升级不冲突）。
注意破甲**没有**「排除单条补丁」的开关，下一次 `--apply` 会按 marker 把它写回来。


### 怎么"永久不贴"某条补丁

```json
// <DSH_HOME>/dsh-purge/exclude-patches.json
{ "excludePatches": [19] }
```

`applyPatchesAllHosts` / `patchStatus` 会跳过这些 id（既不贴，也不在面板上显示成待贴）。
1.3.8 起支持。典型用法就是 #19：想用温和剪枝就不能让 #19 把宿主的 `pruneContent()` 改回 `return null`。
