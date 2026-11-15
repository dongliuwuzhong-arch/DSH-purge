# 1.3.5

人格基线不再每步重发。补丁表 87 → 88（新增 #105）。

## 实测

最近 30 场会话：minimal 18 场里 13 场重复，liangshen 12 场零重复。
最坏一场 2228 步注入 1150 份、重复 36.4 MB 字符；重复份字节完全相同。

## 根因

`compose()` 只在"本步 claimed 消息"里找基线，而注入是 splice 进出站列表的，
下一步 claimed 里没有 → 判无基线 → 再 push。宿主 `syncInbox` 有 surface 去重判据，splice 这条路没走。

## 修法

#105 在 pre-step 的 splice 前查 `agent.session.surface.nodes` 里有没有同 payload 的 user/message，
命中就跳过。压缩把旧条目摘掉后仍会重新注入，人格不丢。
