# 1.5.1

1.5.0 的两路收尾审计（文档 / GitHub 代码 / 人格仓）查出 11 个 S1 与 3 个中危，本版全修。补丁表仍 77 条；测试 306 → 340。

- **`--status` 在纯 node 下不能用了**：`detectSurface()` 判成 web 而 `findAiBaseWeb` 排除桌面安装路径 → 永远「插件根未找到」，提示的 `DSH_BASE` 也是死路。
  现在按 `--surface` > `DSH_SURFACE` > 安装锚点定档，裸跑即认桌面宿主。
- **%VAR% 未展开被当真路径**：某个已脱敏的 `%SystemDrive%` 段被当目录，往 cwd 写出 `%SystemDrive%/ProgramData/...`。新增 `lib/path-guard.js` 接入 13 处候选入口。
- **`install-offline --verify` 对实体副本必红**（要求 node_modules 链接）：改成链接/副本两套判据，本机 exit 1 → 0。
- 仓库卫生：`_tmp/` 不再入库也不再进包（.gitignore + export-ignore + zip 断言黑名单）。
- `patchShim` 返回值统一成 `no_backup:<msg>`。
- `assert-docs` 补第 7 类「命令冒烟」（真跑 --status / --check-deps / preflight --dry-run 并断言判据串），递归覆盖 handbook/deep-dive/history。
- 文档：`--status` 两分口径、`--verify` 判据、解包判据、`patched/suspect` 假判据串、cmd-in-bash 六处、02 现状快照、占位符定义表全部改齐；
  新增 `deep-dive/04-补丁清单.md`（77 条逐条）与 `deep-dive/05-web面.md`。

补丁表 77 条；测试 340 例。
