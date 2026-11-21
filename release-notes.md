# 1.5.3

终审 A（文字）/ 终审 B（GitHub 代码）都过；文字侧 5 个 A 级全修，并补上 assert-docs 的三个盲区。补丁表 77 条；测试 356 例。

- `install-offline --verify` 文档回改成真实行为：链接 / 实体副本都认，副本打印 `实体副本 / copy` 并 exit 0。
- 版本残留 14 处 1.5.0 → 统一到 1.5.3（两份 README、handbook 01/02/99）。
- 安装章第一条命令的 `%USERPROFILE%` 换成 PowerShell 写法（照抄不再崩）。
- `--dry-run` 判据由"五行"改为实测 6 行（含 `would update package.json`）。
- 02 现状快照按 1.5.2 实测重写（应用戳、副本版本、唯一红项）。
- assert-docs：版本锚扩到四处、补丁/用例数认中英文句式；history 两处本机路径脱敏。

补丁表 77 条；测试 356 例。
