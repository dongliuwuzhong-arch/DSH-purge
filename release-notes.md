# 1.3.1

审计抓到的两处：一条假绿、一处漏网。补丁表 86 → 87 条。

## #73 假绿

`PRESET_BASH_MIRROR_LINE` 的 marker 写成了 #70 的那条，加上 `skipIfMarked`，
marker 一命中就判 applied —— 那句 "Network access depends on the task environment…" 其实一直在
`minimal.patch.yml:59`，删除从来没执行过。去掉 `skipIfMarked`。

## #104 新增：dsh-agent 的 pre-step 也有裸解引用

`dsh-agent/lib/index.js:235` 的 `decision.messages.length` 在 pre-step waterfall 里
比 #67 守的 agent-loop 更早执行，#67 兜不住。新增 #104 补上，`targetFiles()` 增加 `agent` 别名。

## 两笔记账（不改代码）

- #17 运行时空转：`dsh-base/cordis.patch.yml` 里 `fs-observation-policy` 是 `disabled: true`，
  插件不组装；`tools.edit` 免读可用是宿主自己的可选判断，不是这条补丁的功劳。
- #6 只对 macOS 的 seatbelt 生效，本机无效。
