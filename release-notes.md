# 1.5.2

1.5.1 在 GitHub 的 Linux runner 上三条用例红（本地 Windows 全绿）——不是产品缺陷，是**测试自己带了平台假设**，本版修掉。补丁表仍 77 条；测试 340 例。

- `%SystemDrive%` 那条：Linux 上没有这个变量，靠宿主环境必然 reject → 测试显式传 `env: { SystemDrive: "C:" }`。
- `filterCandidatePaths` 那条：夹具用 `C:/a`，而 posix 上它不是绝对路径、被正当拒绝 → 夹具改用 `path.resolve(os.tmpdir(), …)`。
- `--status` 认锚点那条：夹具只造了 `resources/app/dsh`，`targetFiles()` 找不到 `@deepseek-ai` → 补一棵最小插件根。

补丁表 77 条；测试 340 例。
