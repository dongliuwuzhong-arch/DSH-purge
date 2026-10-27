# 1.1.93-dsh

## 中文

- 版本 **1.1.93-dsh**，目标宿主 **0.2.1-rc.3**。补丁表仍是 **82 条**（一条没加没删）。
- **备份后缀收敛到一处**：`BAK_SUFFIX` 从 `lib/core.js` 导出，10 处运行时点统一；`lib/host-state.js` 改成参数注入（`{ suffix }`），不再自己定一份。补丁源码字符串里那处故意保留字面量。
- **SOUL-GUARD 变成真闸门**：`scripts/assert-soul-guard.mjs` + 基线 `soul-guard.lock`（注入正文 sha256 + 16 条灵魂补丁语义指纹），CI 新增 **Soul guard** 一步，改了灵魂就红。
- **卸载开始被测**：`uninstallPurge({ state, skipRuntime })` 可注入状态并跳过宿主运行时复原，`test/uninstall.test.mjs` 跑完整卸载链路。
- **文档修正**：`SOUL-GUARD.md` 原来指错的 `lib/prompt-inject.md` 改为 `lib/default-prompt-inject.md`，去掉 #88 残留。

## English

- Version **1.1.93-dsh**, target host **0.2.1-rc.3**. Patch table stays at **82** entries.
- **One source of truth for the backup suffix**: `BAK_SUFFIX` is exported from `lib/core.js`; `lib/host-state.js` now takes it as an option instead of hardcoding its own copy.
- **SOUL-GUARD is now enforced**: `scripts/assert-soul-guard.mjs` with a `soul-guard.lock` baseline (inject body sha256 + semantic fingerprints of 16 soul patches), wired into CI as a **Soul guard** step.
- **Uninstall is finally tested**: `uninstallPurge({ state, skipRuntime })` accepts an injected state and can skip host-runtime restoration; `test/uninstall.test.mjs` runs the whole flow.
