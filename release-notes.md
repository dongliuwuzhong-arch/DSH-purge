# 1.1.94-dsh

## 中文

- 版本 **1.1.94-dsh**，目标宿主 **0.2.1-rc.3**。补丁表仍是 **82 条**（一条没加没删）。
- **修掉「文本启动器永远被判成 binary」**：`isTextShim()` 里的 `fs.readSync` 其实不存在（`fs` 是 hostFs 路由表，fd 类方法没法按路径路由），异常被 catch 吞掉 → 恒 false。后果是所有 .cmd/.ps1/sh 启动器被判 binary，注入剥离与密封 bin 清扫全是空操作。改走 `fsFor(fp)`。线上 `dsh.cmd` 本来就是纯文本、无注入，所以修完状态从 `binary` 变 `original`，宿主文件不动。
- **修掉「剥离注入剥不干净」**：`stripShimInject()` 闭合块时没删占位行，残留一句 `dsh-purge shim begin` 让 `shimIsPatched()` 永远为真 —— 剥完下一趟又判 patched，永远在剥。
- **bak 判据可预演**：新增 `inspectStaleBaks(aiBase, { dryRun })`，返回 `{ refreshed, unchanged, skippedPatched, skippedUser, errors }`；`refreshStaleBaksForUpgrade()` 变成它的薄封装（仍返回数组）。
- **真卸载那两段开始能测**：`revertAllShims({ dirs, scrub, scrubDirs })` 与 `sanitizeDesktopCommandRuntimes({ dirs })` 可注入目标目录，新增 `test/shim.test.mjs`（7 条）覆盖启动器还原/幂等/剥注入/bak 清扫/bin.js 隐藏控制台复原。
- **线上体检脚本**：`node scripts/check-bak-judge.mjs [aiBase]`，只读跑一遍 bak 判据。本机实测：会刷新 0 · 判为已打补丁 47 · 备份==现网 5 · 读失败 0（47+5=52 个目标键，判据没误伤）。

## English

- Version **1.1.94-dsh**, target host **0.2.1-rc.3**. Patch table stays at **82** entries.
- **Fixed: text launchers were always reported as `binary`.** `isTextShim()` called `fs.readSync`, which does not exist on the hostFs routing table (fd-based calls cannot be routed by path); the TypeError was swallowed by a `catch`, so it always returned false. Now routed through `fsFor(fp)`.
- **Fixed: injected shim blocks were never fully stripped.** `stripShimInject()` left the block's opening line in the output, so `shimIsPatched()` stayed true forever.
- **Bak verdicts are now previewable**: new `inspectStaleBaks(aiBase, { dryRun })`; `refreshStaleBaksForUpgrade()` is a thin wrapper over it.
- **The two host-touching uninstall steps are testable**: `revertAllShims({ dirs, scrub, scrubDirs })` and `sanitizeDesktopCommandRuntimes({ dirs })` accept injected directories; new `test/shim.test.mjs` (7 tests).
- **Live probe**: `node scripts/check-bak-judge.mjs [aiBase]` runs the bak verdict read-only. Measured here: 0 would-refresh, 47 already-patched, 5 bak==live, 0 errors.
