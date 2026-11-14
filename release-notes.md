# 1.3.3

影子安装：四个纯净版本（0.2.1-rc.3 / 0.2.2-rc.1 / rc.2 / rc.3）各跑一遍真安装路径，抓出两个 P0。

## P0-1 备份会被覆盖成"打完补丁的版本"

`inspectStaleBaks` 原来无条件 `writeFileSync(bak, current)`。判据误判时（#103 插 import 不落标记、
旧键裸路径拿到空 keys），唯一的原件被改成打过补丁的内容，之后 `revertAll` 判定"文件没被动过"直接跳过——
回滚归零而面板仍显示备份齐全。现改为默认只报告，刷新要显式 `{ apply: true }`；无 keys 时退回全表 marker 扫描。

## P0-2 #43 把 rc.2 的 cordis 预设打成非法 YAML

rc.2/rc.3 的身份句后面多一行，原 pattern 只吃两行，留悬挂标量 → `All mapping items must start at the same column`。
新增三行形态 pattern。

## 影子验证

四版 bak 打前打后一致、revert 逐字节回原件、preset 无悬挂行。补丁表仍 87 条。
