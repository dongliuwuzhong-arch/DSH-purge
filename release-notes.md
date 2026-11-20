# 1.3.7

升级前预检 + 升级手册。

- 新增 `scripts/preflight-upgrade.mjs`：对着一棵候选宿主树只读地报告 applied/待贴/模式不匹配/na，
  支持 `--save-baseline` 存基线后看差分（只有"比基线多跳过的"才是新版本弄坏的）。
  桌面壳补丁单独核查，不再恒报 na。
- 新增 `docs/zh/07-upgrade-playbook.md`。
- 顺手发现并修好：本机 `dsh-compaction-tool-result-pruner` 的 #19 掉了（文件是原件）。

补丁表 88 条不变；测试 130 → 133。
