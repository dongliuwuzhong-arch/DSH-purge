# 1.4.0

六路审计后的修复 + 宿主 0.2.2-rc.5 适配 + 升级护栏。补丁表仍 88 条，测试 136 → 194。

**严重（换包会毁宿主）**：`revertAll` 会拿 0 字节/截断的备份覆盖宿主文件 → 新桶 `emptyBak`/`staleBak` 一律不覆盖；
"先刷新过期 bak 再 revert"是死代码 → 改成把路径集 skip 掉并如实打日志；`install-offline` 不给 `--desktop-install`
时会往**现网**装 → 加护栏，探测到现网即拒绝。

**判定正确性**：`targetLooksPatched` 统一 legacy + 自包含替换；marker 宽松匹配 + 产物在场兜底（#36/#100 转 applied）；
反向假绿加 `markerLooksUpstream`；`exclude` 收口到 `effectivePatchIds()`，面板不再有幽灵行。

**rc.5 适配**：#80 整块重写（旧锚点指向从未存在的中间态）；#88 optional；#46/#56/#77 注明适用范围；#62 补风险说明
（该文件 rc.3 与 rc.5 逐字节相同，fail-open 是既有行为）。

**预检/文档**：预检五桶对账 + 退出码契约统一 + excluded 不算 missing；文档 87→88 / 126→136 / 版本号 / 判定顺序 /
backupGap 四类 / revert 八桶全量校正；`files` 补 `soul-guard.lock`；删陈旧 `test/test/`；notice jpg 不随包发；新增 `docs/zh/00-maintenance.md`。
