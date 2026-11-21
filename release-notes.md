# 1.5.0

破甲自 dsh-purge 1.1.71 分出后独立维护：宿主定版在 0.2.2-rc.5，补丁表、判据与文档只服务这一棵树，不再跟随任何外部发行节奏（出处：YuJunZhiXue/dsh-purge 1.1.71，MIT）。

- **补丁表 88 → 77**：删 7 条死补丁、冷存 4 条进 `lib/patches-legacy.js`、把审计误判的 3 条搬回；修 #101 标签、#62 死标记、#24 判据、#105 非数组兜底。
- **换包不再无限杀进程**：持久台账 + 3 次阈值 → `NEEDS_MANUAL_APPLY`；失败也把 DSH 拉起来；改名失败原因落盘。
- **真缺陷**：`install-offline` 的探测起点掺了 `process.cwd()`，会把"任意含同名 exe 的目录"当现网安装写进 `desktop-install.txt`。
- **soul-guard 校验真正注入的字节**（此前校验的是 md，运行时用的是 asset-table 槽，差 100 个 `\r` 却一直绿）。
- 新增 `assert-versions`、`assert-docs` 两道门；`dshTarget` 改 rc.5；包里不再带 `docs/notice` 截图与本机预检基线。
- 文档整体重写为三册：handbook（运维手册）/ deep-dive（原理）/ history（存档）。

补丁表 77 条；测试 233 → 306。
