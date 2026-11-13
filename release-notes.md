# 1.2.9

补完 #17，修掉 #67 那条误报。补丁表仍是 86 条，未增删。

## #17 写放行了、改没放行

0.2.2-rc.1 把 `editIntent` 简化成 `return this.requirePresent(target, actor, "edit");`，
补丁的 pattern 还锚在 0.2.1 的旧结构上，再也命中不了；两条 marker 只要缺一条整条就判 skipped，
于是「半打」被藏了起来。实测：`tools.write` 不读可写，`tools.edit` 仍报
`file has not been read`。这次补上 0.2.2 形状的 pattern，老的那条保留。

## #67 面板误报

补丁自己产出的标记带 `0.2.2`，markers 里只有不带版本号的那条，于是打完仍显示 skipped。
改成 `markersAny: true`，两条都认。

## 测试

新增 `test/patch17.test.mjs`：三条用例，其中一条专门钉「只打一半不能报 applied」。
