# 1.1.97-dsh

> 目标宿主 0.2.1-rc.3（桌面 desktop / Web web 两面具支持）· 补丁表 **82 条**（一条没加没删）

## 一句话

真宿主上把**整趟卸载**跑了一遍（以前只在注入式测试里覆盖），当场揪出两个只在真机上才现形的 bug：**同一文件挂两个 key 会让回滚报一个假的「没有备份」**，以及**`dsh.cmd.dsh-purge.bak` 这份孤儿备份永远清不掉**。两个都修了，各配一条回归测试。

## BUG-A：一个文件、两个 key、一句假警报

`dsh-web-app/presets/standard.patch.yml` 同时挂在两个 file key 下：

| key | 用它的补丁 |
| --- | --- |
| `agent-preset` | #4 SYSTEM_PROMPT_PERSONA |
| `preset-standard` | #24 PRESET_FETCH_ENABLED / #43 WEB_PRESET_IDENTITY_STRIP / #63 OFFICIAL_PLAN_MODE_NEUTRAL |

`targetFilePairs()` 以前只按 `Object.entries` 纯展开、**不按路径去重**，同一条路径产出两条记录。
`revertAll()` 处理第一条时 `copyFile(bak, fp)` + `unlink(bak)` 把 bak 消耗掉，第二条再来就 bak 不存在
→ 落进 `noBackup`。报告上写着「1 个目标没有备份」，**其实备份一直在、也已经用掉了**。

真宿主卸载时它报的就是 `noBackup: 1`，而且报的正是这个文件。这一条如果没人当场跑，会一直挂在状态面板上
当成「备份缺口」，下一版再去「补备份」就是白忙。

### 改法

- `targetFilePairs()` 按 `path.resolve(fp).toLowerCase()` 归并，产出 `{ key, keys, path }` —— 命中几个 key 就带几个。导出它，好让测试钉住。
- 新增内部 `patchesForKeys(key)`：key 收字符串或数组，跨全部 key 汇总补丁并去重。
- `targetLooksPatched(text, key)` / `keyIsNoop(text, key, fp)` 改走它，**判据本身不变**：
  任一 `originalStillThere` → 没打过；任一 marker / replacement → 有痕迹；`keyIsNoop` 要求全部 unchanged。
- 四个调用点（`inspectStaleBaks` 的 keyByPath、`backupAll`、`backupGap`、`revertAll`）改传 `keys`。

## BUG-B：孤儿 bak，只删不还原

`lib/desktop.js` 的 `repairOfficialCliAfterUnpack()` 在改写官方 CLI 前存一份 `dsh.cmd.dsh-purge.bak`
（**连字符**），而清理侧只认 `BAK_SUFFIX = ".dshpurge.bak"`（无连字符）：

| 检查点 | 认的后缀 | 能匹配到吗 |
| --- | --- | --- |
| `revertShim()` | `.dshpurge.bak` | 否 |
| `sanitizeDesktopCommandRuntimes()` | `/\.dshpurge\.bak$/i` 与 `/\.dshpurge\./i` | 否 |

第二重成因：它所在的 `resources/runtime/cli/bin` 既不以 `/bin` + `host-commands|runtime-commands|dsh desktop`
命中 `isSealedRuntimeDir()`，也不是 `listDesktopCommandRuntimeDirs()` 的成员 —— sanitize 的默认遍历范围**压根走不到那个目录**。
所以整趟卸载跑完，它还在原地。

### 改法

- `sanitizeDesktopCommandRuntimes()` 默认目录改成 `[...listDesktopCommandRuntimeDirs(), findDesktopShimDir()]`，按规范化路径去重；
  新增 `/\.dsh-purge\.bak$/i` 分支，记 `deleted_orphan_bak:<name>`。
- **只删、绝不还原。** 那份 bak 记的是「CLI 指向 `app.asar`」的修复前版本，而解包后 `app.asar` 可能已经不存在
  （本机就只有解包的 `app/`），照它还原会把 CLI 指进空处。所以 `desktop.js` 那边**保持连字符不动**，
  只补了注释说明这是故意的。

## 验证记录（本机实测，非推测）

- 全量测试 **41 / 41 pass**（1.1.96 是 39，本轮 +2）
- 真宿主只读预演：`targetFilePairs(targetFiles(aiBase))` 从 **61 条降到 60 条**，唯一的多 key 项就是那个 preset 文件
- 把 `resources/runtime/cli/bin` 拷到临时目录跑 `sanitizeDesktopCommandRuntimes({dirs:[tmp]})`
  → `deleted_orphan_bak:dsh.cmd.dsh-purge.bak`，目录里只剩 `dsh.cmd`，且 **`dsh.cmd` 一个字节没变**
- `patches=82 unique_ids=ok changelog=82`；灵魂闸门 `digest 6320043cad95`（与 1.1.95 / 1.1.96 一致）
- 卸载实测本体（1.1.96 那趟）：`revertAll` 还原 55 / skipped 3 / noBackup 1 / noop 3 / errors 0；
  `revertHideConsoleFromBin` 真的剥掉了 `dsh/lib/bin.js` 的 import 行；override 删除、rules 删除、
  profile 依赖摘除、redteam 预设迁移、bak manifest 写出、cleanup 队列生成 —— 全部按预期。
  卸载前后用字节级快照（61 live + 61 bak + 8 extras）全量回滚，`shaMismatch/bakMismatch/extraMismatch` 全空。

## 怎么自查（两分钟，不改任何文件）

```sh
node scripts/assert-patches.mjs        # 期望 patches=82 unique_ids=ok changelog=82
node scripts/assert-soul-guard.mjs     # 期望 digest 6320043cad95
node --test test/*.test.mjs            # 期望 41 条全过
```

想确认孤儿 bak 真的会被清掉，看这个目录：

```sh
ls "C:\Software\DSH\resources\runtime\cli\bin"
```

正常应该只剩 `dsh.cmd`。如果还有 `dsh.cmd.dsh-purge.bak`，那是**旧版留下的**，升级到 1.1.97 后跑一次卸载/清洗就会删掉
（只删，不会拿它还原）。

## 还没验的（照旧写在这儿，不粉饰）

1. **`revertAllShims()` 的 dir 循环**在桌面面上结构性无事可做 —— `listShimDirsForPatch()` 对 desktop 返回 `[]`，
   这一半只能靠注入式测试兜着。
2. **flash 五族里的 liangshen / doctor / dshmarket 四族**本机没装，卸载时只会返回 absent/missing，等于没验。
3. **`scheduleCleanupRestart` 重启后真正删插件树**那一场没跑（卸载测试只到「进 cleanup 队列」）。
4. **宿主升级时 bak 刷新那一场仍未验。** 判据错一次就会把干净的备份一次性污染，不可逆。
   先跑 `node scripts/check-bak-judge.mjs` 预演，等宿主 0.2.2 出来再说。

## 资产

| 项 | 值 |
| --- | --- |
| 包 | `dsh-purge-1.1.97-dsh.zip` |
| 目标宿主 | 0.2.1-rc.3（desktop / web） |
| 补丁表 | 82 条 |
| 大小 / sha256 | 见 Release 与 GitHub digest（`git archive` 打包，每次构建可能不同） |
