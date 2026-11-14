# 补丁表（87 条）

补丁按"层"分五类，每条都有 `id` / `name` / `desc` / `file` / `replacements` / `markers`。
可选补丁带 `optional: true`——目标不存在时判 `na`，不算失败。

## 分层的意义

| 层 | 管什么 | 改坏了的后果 |
| --- | --- | --- |
| 提示词 / Prompt | 人格、口径、身份句 | 上下文里换个人说话 |
| 代码 / Code | 宿主 JS 逻辑（沙箱、审批、prune） | 功能异常，可能起不来 |
| 工具 / Tools | 工具描述与 schema | 模型对工具的理解跑偏 |
| 0.1.5 兼容 | 老版本兜底 | 只影响老宿主 |
| 预设 / Preset | `presets/*.patch.yml` | 该预设装不起来 |

## 状态怎么判的

`patchFileOutcome()` 只看三件事：

1. **原文还在不在**（`pattern` 能命中）→ 在就是 `pending`（该打没打）
2. **marker 在不在**（`markers` 命中）→ 在就是 `applied`
3. `skipIfMarked: true` 时 marker 一命中直接算完成，不再看原文

⚠️ 这套判据有两个已知盲区，做判断时要记得：

- **打完之后原文就没了**，所以补丁一旦被打上又被人工改回去，状态会掉到 `skipped`（灰），
  而不是 `pending`，点「应用」也打不回来——因为 pattern 再也对不上。
- **多目标补丁（如 #70）只要有一个文件还留着 marker，整条就报 applied**，别的目标漏了看不出来。

## 几个值得单独记的条目

| 补丁 | 事 |
| --- | --- |
| #17 FS_OBSERVATION_INTENT_FREE | **运行时空转**：`dsh-base/cordis.patch.yml` 里 `fs-observation-policy` 是 `disabled: true`，插件根本不组装。`tools.edit` 不先读也能改，是宿主自己的可选判断，不是这条补丁的功劳。 |
| #43 WEB_PRESET_IDENTITY_STRIP | 1.3.3 前在 0.2.2-rc.2 上会把预设打成非法 YAML（身份句多一行没吃掉）。已修。 |
| #56 REWIND_HIDE_CUT_ONLY | rc.2/rc.3 的 `client.js` 被压成 27 行，四条 pattern 全含缩进，必然失配。宿主靠 `surfaceOp` 自己处理，这条留作记录。 |
| #67 / #104 | `decision.messages` 裸解引用有两处：`dsh-agent-loop` 和 `dsh-agent`。后者在 pre-step waterfall 里更早执行，#67 兜不住，1.3.1 加的 #104 才补上。 |
| #73 PRESET_BASH_MIRROR_LINE | 1.3.1 前是**假绿**：marker 抄了 #70 的，`skipIfMarked` 一命中就报 applied，删除从来没执行过。 |
| #103 WORKSPACE_INIT_ERROR_LOG | 插 import + try/catch，**不落 `dsh-purge` 字样**——这正是 1.3.3 那个"备份被覆写"P0 的触发点。 |
