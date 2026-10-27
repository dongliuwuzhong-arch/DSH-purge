# 1.1.94-dsh

> 目标宿主 0.2.1-rc.3（桌面 desktop / Web web 两面具支持）· 补丁表 **82 条**（一条没加没删）

## 一句话

1.1.94 不新增功能。它修的是两个**从写下来那天起就一直是空操作、却因为异常被 `catch` 吞掉而看起来正常**的 bug —— 也就是说，之前那些版本的"已静默启动器 / 已剥离注入"只是面板上的一句话，实际一个字节都没动。

## 修了什么

### 1. 文本启动器永远被判成 `binary`（启动器维护整条链空转）

- **机制**：`isTextShim()` 用 `fs.openSync` / `fs.readSync` 读文件头。但这里的 `fs` 不是 `node:fs`，而是 `lib/extract-asar.js` 里那张**按路径路由**的表（真实磁盘 / asar 内部二选一），它只路由路径类方法；`readSync` 首参是 **fd**，拿不到路径就没法路由，所以名单里根本没有它。于是第一行就 `TypeError: fs.readSync is not a function`，被函数自己的 `catch` 吞掉，恒返回 `false`。
- **影响**：所有 `.cmd` / `.ps1` / `sh` 启动器都被当成二进制 → `stripCmdInjectSync`、注入剥离、密封 bin 清扫**全部变成空操作**。而状态面板那一行 `shim: dsh.cmd=binary` 看上去只是"这文件是二进制"，像条正常信息，所以从来没报过警。
- **改法**：改走 `fsFor(fp)`，open / read / close 全用同一份真实 fs。
- **升级后可见的变化**：`purge_status` 的 shim 行从 `dsh.cmd=binary` 变成 `dsh.cmd=original`。这不是"修了什么"，是"终于看对了" —— 宿主自带那个 `dsh.cmd` 本来就是 DOS batch 纯 ASCII、`dsh-purge shim` 命中 0 次，**宿主文件本身一个字节都没动**。

### 2. `stripShimInject()` 剥不干净（永远在剥、永远剥不完）

- **机制**：剥离注入块时，遇到闭合标记只把 `blockStart` 复位成 `-1`，**没把块起始那行占位符从输出里删掉**。于是文件里永久残留一句 `dsh-purge shim begin`，`shimIsPatched()` 永远为真 → 下一趟又当成"已注入"再剥一遍。
- **改法**：闭合时 `out.splice(blockStart, 1)`；遇到未闭合的残缺块，仍按原有规则整段还原。

## 顺带做的三件事

- **bak 判据可预演**：新增 `inspectStaleBaks(aiBase, { dryRun })`，返回 `{ dryRun, refreshed, unchanged, skippedPatched, skippedUser, errors }`；`refreshStaleBaksForUpgrade()` 变成它的薄封装（仍返回数组），所以 `applyPatches` 与 `lib/reapply.js` 的调用点一行没改。
- **卸载里那两段能测了**：`revertAllShims({ dirs, scrub, scrubDirs })`、`sanitizeDesktopCommandRuntimes({ dirs })` 目录可注入，默认行为不变；新增 `test/shim.test.mjs`（7 条）覆盖启动器还原 / 第二趟幂等 / 无 bak 时只剥注入 / `isTextShim` 认文本也认二进制 / sanitize 只动本插件产物 / 恢复 `bin.js` 隐藏控制台 / 预演不写盘。
- **线上体检脚本**：`node scripts/check-bak-judge.mjs [aiBase]`，只读跑一遍 bak 判据（不传参数就自己找宿主目录，也可用 `DSH_PURGE_AI_BASE`）。这是"升级前该看到的样子"的基准：本机 rc.3 实测 **会刷新 0 · 判为已打补丁 47 · 备份==现网 5 · 读失败 0**（47+5=52 个目标键，判据没误伤任何一份备份）。

## 怎么自查（三分钟，不改任何文件）

```sh
node scripts/assert-patches.mjs        # 期望 patches=82 unique_ids=ok changelog=82
node scripts/assert-soul-guard.mjs     # 期望 digest 6320043cad95
node --test "test/**/*.test.mjs"       # 期望 31 条全过
node scripts/check-bak-judge.mjs "<你的 aiBase>"   # 期望「会刷新 0」
```

装好并重启宿主之后，状态面板 / `/purge status` 里那行应当是 `shim: dsh.cmd=original`。若仍是 `binary`，说明跑的还是 1.1.93 或更早的运行副本（`scripts/sync-runtime.mjs --apply` 同步后再重启）。

## 验证记录（本机实测，非推测）

- 单元测试 `node --test "test/**/*.test.mjs"` = **31/31**（judge 6 + cycle 5 + write 5 + host 6 + uninstall 2 + shim 7）
- 补丁表 `patches=82 unique_ids=ok changelog=82`；灵魂闸门 `digest 6320043cad95`
- CI：Syntax-check / Unit tests / Soul guard / Publish GitHub Release 四步全绿
- 重启后实测：`shim: dsh.cmd=original`，66 条按面应用 61 条、pending 0，空操作备份仍是 3 个（session-reference 三个文件本来就是空操作）

## 还没验的两件事（照旧写在这儿，不粉饰）

1. **真宿主上没跑过整趟卸载。** `revertAllShims` / `revertCmdFlash` 现在有测试了，但那是注入临时目录、不碰宿主；真机那次卸载仍未发生。
2. **真宿主升级时 bak 刷新那一场仍未验。** 判据错一次就会把干净的备份一次性污染，不可逆。现在至少能先只读预演（`check-bak-judge.mjs`），等宿主 0.2.2 出来先跑预演，再决定放不放。

## 资产

| 项 | 值 |
| --- | --- |
| 包 | `dsh-purge-1.1.94-dsh.zip` |
| 大小 | 1362971 字节 |
| sha256 | `d786d9bd62866e2831b96d4114050d2ced2276e7af343739cc1cd51a4ceef3a7` |
| 目标宿主 | 0.2.1-rc.3（desktop / web） |
| 补丁表 | 82 条 |

---

## English

> Target host 0.2.1-rc.3 (desktop and web). Patch table stays at **82** entries.

**In one line.** 1.1.94 adds no features. It fixes two bugs that had been **silent no-ops since the day they were written**, because a `catch` swallowed the exception and the status line kept looking normal. In other words, "shim already silent" and "inject stripped" on earlier builds were just words in a panel; not a byte ever changed.

**1. Text launchers were always reported as `binary`** — the whole launcher maintenance path was a no-op. `isTextShim()` called `fs.readSync` on `fs`, which is not `node:fs` but the **path-routed** table in `lib/extract-asar.js` (real disk vs. asar). That table routes path-based calls only; `readSync` takes an **fd**, cannot be routed, and is not in the list — so the first line threw `TypeError: fs.readSync is not a function`, the function's own `catch` ate it, and it always returned `false`. Consequence: every `.cmd` / `.ps1` / `sh` launcher was treated as binary, so `stripCmdInjectSync`, inject stripping and sealed-bin cleanup never did anything. Fixed by going through `fsFor(fp)`.

**2. `stripShimInject()` never finished stripping** — closing a block only reset `blockStart`, leaving the block's opening line in the output, so a `dsh-purge shim begin` marker stayed in the file forever, `shimIsPatched()` stayed true, and every run stripped it again. Fixed with `out.splice(blockStart, 1)`; unterminated blocks are still restored whole.

**Also in this release**

- `inspectStaleBaks(aiBase, { dryRun })` → `{ dryRun, refreshed, unchanged, skippedPatched, skippedUser, errors }`; `refreshStaleBaksForUpgrade()` is now a thin wrapper (still returns an array), so no call site changed.
- `revertAllShims({ dirs, scrub, scrubDirs })` and `sanitizeDesktopCommandRuntimes({ dirs })` accept injected directories; new `test/shim.test.mjs` (7 tests).
- New read-only probe `node scripts/check-bak-judge.mjs [aiBase]` (or `DSH_PURGE_AI_BASE`). On this machine with rc.3: **0 would-refresh · 47 already patched · 5 bak==live · 0 errors** across 52 target keys.

**Verify yourself (read-only)**

```sh
node scripts/assert-patches.mjs        # patches=82 unique_ids=ok changelog=82
node scripts/assert-soul-guard.mjs     # digest 6320043cad95
node --test "test/**/*.test.mjs"       # 31 tests
node scripts/check-bak-judge.mjs "<your aiBase>"   # expects "0 would-refresh"
```

After installing and restarting the host, the status panel should read `shim: dsh.cmd=original`. If it still says `binary`, the running copy is 1.1.93 or older — run `scripts/sync-runtime.mjs --apply` and restart.

**Measured here:** 31/31 tests; `patches=82`; soul-guard digest `6320043cad95`; CI (syntax / unit tests / soul guard / publish) all green; after restart `shim: dsh.cmd=original`, 61/66 patches applied per surface, 0 pending, 3 no-op backups left as expected.

**Still not verified, stated plainly:** (1) a full uninstall on the real host — `revertAllShims` / `revertCmdFlash` now have tests, but against injected temp directories, not the host; (2) bak refresh during a real host upgrade — one wrong verdict pollutes every clean backup irreversibly, so the plan is to run the read-only probe first when host 0.2.2 lands.

**Asset:** `dsh-purge-1.1.94-dsh.zip`, 1362971 bytes, sha256 `d786d9bd62866e2831b96d4114050d2ced2276e7af343739cc1cd51a4ceef3a7`.
