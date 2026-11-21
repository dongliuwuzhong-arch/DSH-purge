# 1.4.3

CI 在 Linux 上的第一处真红：liveDesktopDirs 用 path.delimiter 切 DSH_DESKTOP_INSTALL，Linux 的 delimiter 是 ":"，C:/Other/DSH 被切成两个假目录。新增 splitDirList()（Windows 形态用 ";" 切，其余用平台 delimiter）+ 跨平台用例。测试 226 → 227。
