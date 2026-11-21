# 审计 A4 · 破甲两份文档核对（0.2.2-rc.1 → rc.3 升级之后）

> 审计对象：`knowledge\ops\破甲现状-20261113.md`（22,988 字节 / 453 行）、
> `knowledge\ops\dsh-purge维护手册.md`（24,277 字节 / 508 行）
> 环境基准：宿主 DSH **0.2.2-rc.3**，跑解包目录 `%INSTALL_DIR%\resources\app`，
> `resources\app.asar` 已不存在，跑着的宿主进程 9 个、启动时间 **2026-11-14 01:44:59**。
> 审计人：agent-4（只读两份文档与宿主，未改任何被审计文件；本报告是唯一写入）。
> 结论先说：**有 8 条会直接把下一个会话带进错误的动作，必须先改；其余 12 条是数字/行号漂移。**
> 判定标准只有一条：这条内容如果被照着做，会不会动错文件、抠错版本、白查一趟。

## 复现证据（以下每条「实测」都出自这几条命令）

```bash
NODE="%INSTALL_DIR%\resources\runtime\primary-runtime\dependencies\node\bin\node.exe"
P="%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-purge"      # 插件宿主真加载的那份

# 版本 / 补丁表 / 面板口径（DSH_SURFACE=desktop）
cd "$P" && DSH_SURFACE=desktop "$NODE" --input-type=module -e "
import {ALL_PATCHES, patchStatus, groupPatchesForDisplay, tallyDisplayPatches} from './lib/core.js';
const st = await patchStatus('%INSTALL_DIR%/resources/app/dsh/node_modules/@deepseek-ai');
const rows = groupPatchesForDisplay(ALL_PATCHES, st);
console.log(ALL_PATCHES.length, JSON.stringify(tallyDisplayPatches(rows)));"

# 状态 / 备份缺口 / asar 密封 / shim（gatherState）
cd "$P" && DSH_SURFACE=desktop "$NODE" --input-type=module -e "
import {gatherState} from './lib/core.js';
const s = await gatherState({aiBase:'%INSTALL_DIR%/resources/app/dsh/node_modules/@deepseek-ai'});
console.log(JSON.stringify(s.backup_gap), s.asar_still_sealed, s.shim_cmd, s.shim_ps1, s.shim_bin);"

# 自检三件套
cd "$P" && "$NODE" scripts/assert-patches.mjs          # patches=86 unique_ids=ok changelog=86
cd "$P" && "$NODE" scripts/assert-soul-guard.mjs       # digest 7e5e018ffdf6
cd "$P" && "$NODE" --test test/*.test.mjs              # 113 pass / 0 fail

# 宿主到底读哪 / 三层版本
cd "%WORKSPACE%" && DSH_HOME="%USERPROFILE%\.dsh" "$NODE" tools/check-paths.mjs   # 退出码 0

# asar 里到底是什么版本（不依赖 @electron/asar）
"$NODE" "%WORKSPACE%\专项任务\破甲\bin\asar-extract.mjs" \
  "%INSTALL_DIR%\resources\app.asar.dshpurge-away" dsh/desktop-runtime.json --out tmp.json   # release.version = 0.2.2-rc.3
```

---

# 一、必须改（会误导动作）

## P0-1 · 维护手册「零之一、当前状态」整块三项全错

- **位置**：`dsh-purge维护手册.md` 行 27–35（原文自注「看别的之前先看这个」）
- **原文**：
  ```
  破甲        1.2.8           本地 = 仓库（11-13 22:41 对齐，release v1.2.8 已出）
  宿主三层    全部 0.2.2-rc.1    外壳 / 主程序 / 底座
  app.asar    已挪走 → resources\app.asar.dshpurge-away（213,202,918 字节，别删）
  ```
- **实测**：
  - 插件版本 `package.json` 两副本都是 **1.3.0**（`version` 与 `dsh.version` 都改了）；
    `release-notes.md` 第一行 `# 1.3.0`，`CHANGELOG.md` 顶条 `## 1.3.0 · 2026-11-14 · 适配 0.2.2-rc.3`。
  - 三层：`resources\app\package.json` = **0.2.2-rc.3**；`resources\runtime\primary-runtime\runtime.json` 的
    `desktopVersion` = **0.2.2-rc.3**；`~/.dsh\dsh-runtimes\dsh-primary-runtime\runtime.json` 仍是 **0.2.2-rc.1**。
    `check-paths.mjs` 原样打出：`[·] 本机有 2 份 runtime.json，采用 0.2.2-rc.3；另一份 0.2.2-rc.1 在
    %USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\runtime.json`，然后 `[✓] 三层版本一致：0.2.2-rc.3`。
  - `app.asar.dshpurge-away` = **209,021,953 字节**（不是 213,202,918）；里面的 `dsh/desktop-runtime.json`
    `release.version` = **0.2.2-rc.3**。
- **建议替换**（整块粘回手册行 27–35）：
  ````
  ## 零之一、当前状态（2026-11-14 02:00 实测，看别的之前先看这个）

  ```
  破甲        1.3.0            本地 = 仓库（1.3.0 已发，CHANGELOG 顶条 2026-11-14）
  补丁表      86 条             最大 id 103
  宿主三层    外壳 / 主程序 = 0.2.2-rc.3；底座 resources\runtime = 0.2.2-rc.3
              另有一份 rc.1 底座在 ~/.dsh\dsh-runtimes\dsh-primary-runtime（check-paths 会打一行 · 说明，不影响判定）
  宿主加载    resources\app（解包态）
  app.asar    已不存在；rc.3 的密封镜像挪在 resources\app.asar.dshpurge-away（209,021,953 字节，别删）
  ```
  ````

## P0-2 · 破甲现状文首「一句话现状」还停在 rc.1

- **位置**：`破甲现状-20261113.md` 行 8–10
- **原文**：
  ```
  宿主读解包目录，三层版本 0.2.2-rc.1 一致，补丁 **59/68 applied**，
  今晚新加的 **#103** 已经手工写进文件、验证通过、DSH 已重启加载。
  ```
- **实测**：三层 = rc.3；面板 = **60/69 applied，0 pending**（`tallyDisplayPatches`：total 69 / applied 60）；
  原始口径 = **applied 70 / skipped 10 / na 6 = 86**；`#103 WORKSPACE_INIT_ERROR_LOG` 状态 `applied`。
  宿主 9 个进程的启动时间是 2026-11-14 01:44:59 / 01:45:10 / 02:02:30 这一组，全部晚于 `lib/patches.js`（11-14 00:59:51）与 `lib/core.js`（11-13 22:34:47）。
- **建议替换**：
  ```
  宿主读解包目录，三层版本 0.2.2-rc.3 一致（底座以 resources\runtime 为准；~/.dsh 那份仍是 rc.1），
  补丁面板 **60/69 applied**、0 pending（原始口径 applied 70 / skipped 10 / na 6 = 86 条），DSH 11-14 01:44 重启后全活。
  ```
  （并把本节标题改成「一句话现状（11-14 02:00）」，与文末 02:0x 那节对齐——现在两节互相矛盾。）

## P0-3 · 「app.asar.dshpurge-away 是 0.2.2-rc.1 的原始镜像」已经作废

- **位置**：`破甲现状` 行 166–167；`维护手册` 行 490–492（第十三节整节的前提）
- **原文**：
  ```
  **`app.asar.dshpurge-away` 是当前 0.2.2-rc.1 的原始镜像（22102 个文件），任何"原件找不回来"都可以从它里面抠。**
  这个 asar 是 **0.2.2-rc.1 的原始镜像（22102 个文件）**，已验：里面的
  `dsh-workspace/lib/index.js` 与 `…bak\purge-bak-20261113\workspace-index.ORIGINAL.js` 逐字节一致（39257 字节）。
  ```
- **实测**（这是本次最危险的一条）：
  - 该文件现在是 **rc.3** 的镜像：内部 `dsh/desktop-runtime.json` 的 `release.version` = `0.2.2-rc.3`。
  - 条目数 **21717**（`asar-extract.mjs --list ""` 输出行数），不是 22102。
  - 内部 `dsh/node_modules/@deepseek-ai/dsh-workspace/lib/index.js` = **39,521 字节**，`dsh-purge` 痕迹 0 处、`__wsErrLog` 0 处（干净的 rc.3 原件）；
    而 `bak\purge-bak-20261113\workspace-index.ORIGINAL.js` = **39,257 字节**（rc.1 原件）。
    → **两者不再逐字节一致**，"已验逐字节一致"这句话现在会让人拿错版本去比对或覆盖。
  - 现场文件：`resources\app\…\dsh-workspace\lib\index.js` = **40,014 字节**（rc.3 + #103）。
- **建议替换**：
  ```
  **这具 asar 现在是 0.2.2-rc.3 的原始镜像（21717 个条目，209,021,953 字节）**，任何"rc.3 原件找不回来"都可以从它里面抠；
  抠出来的 `dsh-workspace/lib/index.js` 是 39,521 字节的干净原件。
  rc.1 时代的原件只剩 `bak\purge-bak-20261113\workspace-index.ORIGINAL.js`（39,257 字节），**别再拿它代表 asar 里的内容**。
  ```

## P0-4 · 手册「本地比仓库多一条，没发版」整块已失效

- **位置**：`维护手册` 行 37–52
- **原文**：
  ```
  | version | 1.2.7 | 1.2.7 |
  | 补丁表 | **86 条** | **85 条** |
  ⚠️ **版本号没跟着动**，所以「1.2.7」在本地和仓库指的不是同一份东西。下次发版先把 `package.json` 提到 1.2.8，别直接 push。
  ```
- **实测**：本地 = **1.3.0 / 86 条**；`assert-patches` 通过（`patches=86 unique_ids=ok changelog=86`）；
  `release-notes.md` = `# 1.3.0`；`CHANGELOG.md` 顶条 1.3.0。1.2.8、1.2.9 都已发过（破甲现状 22:41 / 23:5x 两节自述），
  「本地比仓库多一条」这个状态在 1.2.8 发版时就结束了。
  （GitHub 资产 v1.2.8 / v1.2.9 / v1.3.0 与 commit `201df2d` / `6b93b31` / `53cfa3c`：**未验证**，本机禁网。）
- **建议替换**：整节删掉，改一行（手册行 37–52 全替换）：
  > 本地与仓库自 1.2.8 起不再分叉；当前 **1.3.0 / 86 条 / 最大 id 103**。发版前只需升 package.json 的 version 与 dsh.version。

## P0-5 · app.asar 体积写错，而且它现在根本不存在

- **位置**：`破甲现状` 行 103、行 221；`维护手册` 行 34、行 267
- **原文**：
  ```
  - `resources\app.asar.dshpurge-away`（213MB）和 `runtime.old-0.2.1`（6151 文件）**别当垃圾清掉**,
  `app.asar.dshpurge-away`（213 MB，官更脚本要看它）、`_diag\restart-dsh.bat`（跨插件通用）。
  ```
- **实测**：`fs.statSync` = **209,021,953 字节**（= 209.0 MB / 199.3 MiB）；
  `resources\app.asar` **不存在**（`MISSING`），`resources\app.asar.bak`、`app.asar.original` 也都不存在；
  `resources\` 下只剩 `app\`、`app.asar.dshpurge-away`、`app.asar.unpacked`、`runtime\` 等。
  （文末 02:0x 那节写的「209 MB 文件」是对的，行 103 / 221 的 213MB 才是旧值——同一份文档里自己打架。）
- **建议替换**：把 213MB/213,202,918 统一成 `209,021,953 字节（rc.3 的密封镜像）`，
  并在「宿主读哪」那张表里补一句 `resources\app.asar 当前不存在（不是文件、也不是目录）`。

## P0-6 · `runtime.old-0.2.1`（6151 文件）已经不在机器上

- **位置**：`破甲现状` 行 103；`维护手册` 行 267–268
- **原文**：
  ```
  可用的底换成：`resources\app.asar.dshpurge-away`（213MB，11-06 换包时挪走的）和
  `resources\runtime.old-0.2.1`（6151 文件，旧底座）。
  ```
- **实测**：`resources\runtime.old-0.2.1` 不存在；在 `%INSTALL_DIR%` 与 `%USERPROFILE%\.dsh` 下
  `Get-ChildItem -Filter 'runtime.old*' -Recurse -Depth 2` 返回空。
- **建议替换**：
  ```
  可用的底只剩两份：`resources\app.asar.dshpurge-away`（209,021,953 字节 / rc.3 原始镜像）和
  `backup\plugins-20261030\`（插件侧快照：`local-plugins-rebuild-20261102.7z`、`dsh-purge-1.2.2-before-1.2.3`、`dsh-purge-1.2.4-actual-snapshot`）。
  ⚠️ `resources\runtime.old-0.2.1` 在 rc.3 这次升级后已不存在（2026-11-14 01:55 搜过），文档里再提到它就是死路径。
  ```

## P0-7 · `index.js.dshpurge.bak` 现在是「补丁后」的副本，回滚不出原件

- **位置**：`破甲现状` 行 46–48
- **原文**：
  ```
  - [x] **没有 `.dshpurge.bak`** → 已补。原件取自 `app.asar.dshpurge-away`，
  与手写目标文件之外的 `…workspace-index.ORIGINAL.js` **逐字节一致**（39257 字节）。现在 `purge_status` 报 `✓ 备份: 有`。
  ```
- **实测**：
  `resources\app\dsh\node_modules\@deepseek-ai\dsh-workspace\lib\index.js` = 40,014 字节；
  `index.js.dshpurge.bak` = **40,014 字节，sha256 `663806456a76159a4616…` 与现文件完全相同**（`Buffer.equals` = true）。
  即 rc.3 解包重打时这份 bak 是"打完之后的拷贝"，**拿它回滚等于没回滚**。
  另外 `gatherState().backup_gap` = `{missing:0, suspect:0, noop:3}`——面板**不报**这一处，只在 `noop` 里列了
  `dsh-session-reference` 那三个文件。（面板为什么漏判 dsh-workspace 这一处：**未查清**，不猜。）
- **建议替换**：
  ```
  - [x] 备份存在，但 rc.3 重打后 `index.js.dshpurge.bak` 与现文件逐字节相同（40,014 字节，sha256 6638064…），
        **这份 bak 回滚不出原件**。rc.3 的干净原件要从 `app.asar.dshpurge-away` 抠（39,521 字节）；
        rc.1 的原件仍在 `bak\purge-bak-20261113\workspace-index.ORIGINAL.js`（39,257 字节）。
        下次重打前先把 bak 换成 asar 里的干净原件。
  ```

## P0-8 · 补丁 skipped 名单换届了（数字巧合，成员变了）

- **位置**：`维护手册` 行 56–70（尤其 58、60、65）
- **原文**：
  ```
  skipped: 17 32 40 53 54 60 67 77 80 88
  - **#83 missing_file** —— `desktop-shell` 在宿主进程外解析不到（见第十一节）。面板里点一次「应用」才真打上。
  ```
- **实测**（`patchStatus` 逐条算）：`applied 70 / skipped 10 / na 6`
  - skipped = **32 40 53 54 56 60 62 77 80 88**
  - na = 28 30 31 64 65 76
  - **#17、#67 已经 applied**（1.2.9 修的就是这两条）；**#83、#91 也是 applied**（外部 node + `DSH_SURFACE=desktop` 就能解析到 `%INSTALL_DIR%\resources\app\lib\main.js`）；
  - 新增失配两条：**#56 `REWIND_HIDE_CUT_ONLY`、#62 `OFFICIAL_TOOL_ASK_FAILOPEN`**（都是 `optional:true`，属 rc.3 改版后 pattern 失配，
    与 `CHANGELOG.md` 1.3.0 里「rc.3 新增失配 9 条，其中 3 条非可选」一致）。
- **建议替换**：
  ```
  applied 70 / skipped 10 / na 6 / missing_file 0 / pending 0        （2026-11-14 02:00，rc.3）
  skipped: 32 40 53 54 56 60 62 77 80 88
  # 17 67 已由 1.2.9 修好；#83 / #91 在 DSH_SURFACE=desktop 下已 applied
  # 新失配：#56 REWIND_HIDE_CUT_ONLY、#62 OFFICIAL_TOOL_ASK_FAILOPEN（optional，rc.3 改版后 pattern 对不上）
  ```
  并把行 60、65 两条 `#83 missing_file` 说明删掉（现象已不存在）。

---

# 二、数字与行号漂移（不改不会动错文件，但会白查一趟）

## P1-9 · 单元测试数（手册三处）

- **位置**：`维护手册` 行 84（`# 104 pass / 0 fail`）、行 165（`期望 97 pass / 0 fail（1.2.2 起）`）、
  行 236（`1.2.3 起仍是 97 个`）、行 379（`期望 97 pass / 0 fail`）
- **原文**：`node --test test/*.test.mjs        # 104 pass / 0 fail`
- **实测**：`node --test test/*.test.mjs` → `ℹ tests 113 / pass 113 / fail 0`（exit 0）。
  破甲现状行 413 写的「113 pass」是对的。
- **建议替换**：四处统一成 `期望 113 pass / 0 fail（1.3.0 起；1.2.2–1.2.9 期间是 97→104→109）`。

## P1-10 · check-paths 现在是 9 条判据，不是 6 条

- **位置**：`维护手册` 行 76–77；`破甲现状` 行 114（`六条判据`）、行 436（`十项全绿`）
- **原文**：`# 现在验 6 项，第 6 项是「三层版本一致」，2026-11-06 才加的`
- **实测**：实跑输出 = **9 条 ✓**（宿主读解包 / purge 源副本一致 / soul / frame / tool-gate / 三处落点 / profile 覆盖层 / 人格探针 / 三层版本）
  ＋ **2 条 `·` 提示**（`selectedDefault = minimal`、`2 份 runtime.json`），退出码 0。
  「三层版本一致」是**第 9 条**，不是第 6 条。
- **建议替换**：`# 现在验 9 项，第 9 项是「三层版本一致」（11-06 加）；另有 2 行 · 提示，不计入判据`；
  破甲现状两处改成 `九条判据，出口码 0 才对` / `退出码 0，9 项全绿 + 2 条提示`。

## P1-11 · 手册第十一节「desktop-shell 在外部 node 恒为空」不再成立

- **位置**：`维护手册` 行 434–450
- **原文**：
  ```
  desktop-shell = undefined    # 在外部 node 进程里恒如此
  #83 DESKTOP_HOST_CLOSE_NO_FATAL  -> missing_file
  ```
- **实测**：外部 node 进程里 `targetFiles(...)` 的 `desktop-shell` 取值取决于 `DSH_SURFACE`：
  `DSH_SURFACE=desktop` → `"C:\\Software\\DSH\\resources\\app\\lib\\main.js"`（57 个 key）；
  不设 `DSH_SURFACE` → `undefined`（53 个 key）。对应 #83、#91 在 desktop 面都是 `applied`。
  所以陷阱的正解是「**不设 DSH_SURFACE 时**解析为空」，不是「外部 node 恒空」。
- **建议替换**：
  ```
  `DSH_SURFACE=desktop` 下 `desktop-shell` 在外部 node 进程里也能解析到 `resources\app\lib\main.js`；
  **不设 `DSH_SURFACE`（默认按 web 面）时才恒为 undefined**，#83 会显示 missing_file、#91 显示 na。
  → 量 desktop-shell 相关补丁，一律带 `DSH_SURFACE=desktop`；不带就别说补丁坏了。
  ```

## P1-12 · 「当前数字快照（2026-11-13 22:05）」那张表已过期

- **位置**：`破甲现状` 行 72–79
- **原文**：`| 外壳 / 主程序 / 底座 | 0.2.2-rc.1 / 0.2.2-rc.1 / 0.2.2-rc.1 |`
- **实测**：三行都是 rc.3（细节见 P0-1）。表里另两项仍成立：`补丁` 行（面板 60/69、tally 70/10/6）、
  `shim` 行（`dsh.cmd=original`，`dsh.ps1`/`dsh` missing——`runtime\cli\bin` 下只有 `dsh.cmd` 一个文件）。
- **建议替换**：整表就地补一列「现在（11-14 02:00）」，或把标题改成「历史快照 · rc.1 时代（已被 02:0x 那节取代）」并只保留它作为时间线记录。

## P1-13 · #103 的行号与所在数组都写错了

- **位置**：`破甲现状` 行 16
- **原文**（行 16）：
  ```
  - 加在 `~/.dsh/plugins/dsh-purge/lib/patches.js` 第 3550 行，`NEW_TOOL_PATCHES` 之前。
  ```
- **实测**：`id: 103, name: "WORKSPACE_INIT_ERROR_LOG"` 在 `lib/patches.js` **3578–3584 行**；
  `NEW_TOOL_PATCHES` 数组从 **717 行**开始、到 3618 行结束，**#103 是它的最后一个元素**（`ALL_PATCHES` 末尾也是 103）。
  所以「在 NEW_TOOL_PATCHES 之前」是反的。
- **建议替换**（行 16 整行换）：
  ```
  - 加在 `~/.dsh/plugins/dsh-purge/lib/patches.js` 第 3578–3584 行，`NEW_TOOL_PATCHES` 数组末尾（ALL_PATCHES 最后一条）。
  ```

## P1-14 · 验证段里的文件字节数老了（39750 → 40014）

- **位置**：`破甲现状` 行 52–57（`stat -c '%s %y' "$W"   # 39750 字节`）、行 137（`39732 字符`）
- **原文**：`stat -c '%s %y' "$W"             # 39750 字节`
- **实测**：现文件 **40,014 字节**，`__wsErrLog` 命中 **2** 次（这一条判据仍成立）。
  39750 是 rc.1 时代的补丁版（`bak\purge-bak-20261113\workspace-index.patched.js` 仍是 39,750 字节）。
- **建议替换**：`stat -c '%s %y' "$W"             # rc.3 上是 40014 字节（rc.1 时代是 39750）`。

## P1-15 · 三处交叉引用行号指到了别的内容

- **位置**：`破甲现状` 行 26（`手册 516 行那条老坑`）、行 94（`手册 466 那节`）、行 101（`见 516 行`）、行 111（`411-535 行`）；
  `维护手册` 行 476（`见手册 466 行`）
- **原文**：`否则 taskkill 会连脚本自己的父进程一起杀——**手册 466 那节记过两次**。`
- **实测**（`DSH运维手册.md` 共 638 行）：
  - 「破甲 / 宿主 / asar」节 = **411–544 行**（545 行起是「嗓子回来了」），不是 411–535；
  - 「破甲的副本关系（两份副本不生效）」= **525 行**，不是 516；516 行是 `atomicCopyFile` 假备份那段代码块结尾；
  - 「先脱离自己的进程树」= **490 行**，不是 466；466 行讲的是「旧 runtime 改名留底」。
- **建议替换**：`手册 516 行` → `DSH运维手册 §「破甲的副本关系」（525 行）`；`手册 466` → `490 行`；`411-535` → `411–544`。

## P1-16 · 底座「两份 runtime.json」的不对称没写进现状

- **位置**：`破甲现状` 行 443–446（只写了「装完 resources\runtime 是空的…用 7-Zip 解出来放回去即可对齐」，没写对齐之后的余留）
- **原文**（行 443）：
  ```
  2. **装完 `resources\runtime` 是空的**，底座实际还停在 rc.1（`~/.dsh/dsh-runtimes/dsh-primary-runtime`）。
  ```
- **实测**：现在 `resources\runtime\primary-runtime\runtime.json` = rc.3，`resources\runtime\versions.json` = node 24.21.0 / pnpm 11.28.5；
  `~/.dsh\dsh-runtimes\dsh-primary-runtime\runtime.json` **仍是 rc.1**（`~/.dsh\dsh-runtimes` 下只有这一个目录）。
  `check-paths` 按「与主程序版本一致的那份算数」取 rc.3，另打一行 `·` 说明那份 rc.1。**这是正常状态，不是残留待修。**
- **建议替换**：补一段
  ```
  对齐之后的常态：`resources\runtime` = rc.3（真在用），`~/.dsh\dsh-runtimes\dsh-primary-runtime` 仍是 rc.1（不用管，
  check-paths 会打一行 · 显式说明；只要主程序是 rc.3，L3 就取 resources 那份）。
  ```

---

# 三、措辞级（顺手改，不改也不出事）

## P2-17 · main.js 的破甲痕迹 9 处 → 11 处

- **位置**：`维护手册` 行 110（`本机实测 9`）、行 448（`里有 9 处 dsh-purge 痕迹`）
- **实测**：`resources\app\lib\main.js`（832,233 字符）里 `dsh-purge` 出现 **11 次**。
- **建议替换**：两处改 `11`，并注明「这个数会随补丁表变，只当 >0 的定性判据用」。

## P2-18 · 手册 §七 里的「rc.5」

- **位置**：`维护手册` 行 285
- **原文**（行 285）：
  ```
  **已知未修**：patch `#40` 在 rc.5 上的六条 pattern 全部失配，状态 `skipped`。
  ```
- **实测**：本机宿主是 0.2.2-rc.3，「rc.5」在这套版本号里不存在对应物；#40 现在是 `skipped`（`optional:true`，
  只有 `complete:true` 的预设受影响，本机 minimal 无害——这条结论仍成立）。
- **建议替换**：`#40 在 0.2.2-rc.3 上 pattern 全失配（原是从上游抄来的「rc.5」说法，本机应写 rc.3）`。

## P2-19 · 「还欠着的」里的 core.js 那笔已经结账

- **位置**：`破甲现状` 行 190、行 361、行 396
- **原文**（行 190）：
  ```
  - [ ] 宿主进程里仍是旧的 `lib/core.js`（22:04 启动的那份）。`backupGap` 的修正要**下次重启**才生效。
  ```
- **实测**：宿主 9 个进程的启动时间只有 **2026-11-14 01:44:59 / 01:45:10 / 02:02:30** 三个值（没有 rc.1 时代的残留），全部晚于 `lib/core.js`（11-13 22:34:47）、
  `lib/patches.js`（11-14 00:59:51）、`index.js`（11-14 01:22:37）。→ 进程里跑的就是现在盘上这三份。
- **建议替换**：`- [x] core.js 的 backupGap 修正已随 11-14 01:44 的重启生效（进程启动时间晚于文件 mtime）。`
  另一笔（`restart-dsh.bat` 拉不起宿主）**仍然未结**，见 P2-20。

## P2-20 · restart-dsh.bat 与「必须脱离进程树」这条要求自相矛盾（可能就是未查那笔账的原因，属推测）

- **位置**：`破甲现状` 行 83–99（脚本全文 86–91、要求 93–94）；`维护手册` 行 476
- **原文**（行 93–94）：
  ```
  必须**脱离自己的进程树**拉起（`Start-Process cmd.exe -ArgumentList '/c',...`），否则 taskkill 会连脚本自己的父进程一起杀
  ```
- **实测**：`_diag\restart-dsh.bat`（157 字节，纯 ASCII）全文就是：
  `ping -n 3 → taskkill /f /im "DeepSeek Harness.exe" → ping -n 4 → start "" "%INSTALL_DIR%\DeepSeek Harness.exe"`，
  **没有任何脱离进程树的包装**。文档要求的那种拉法没落进脚本里。
- **建议替换**：`⚠️ 现脚本（157 字节）没有 Start-Process 脱离层，与「必须脱离进程树」这条要求不符；
  用它之前先自己套一层，或先核 11-13 那晚失败是不是这个原因（未验证）。`

---

# 四、核对过、**仍然成立**的（下一个会话可以直接信）

| 项 | 文档说法 | 实测 |
| --- | --- | --- |
| 补丁表 | 86 条，最大 id 103 | `ALL_PATCHES.length=86`，ids 最大 103，末尾是 #103 ✅ |
| 面板口径 | 60/69 applied，0 pending（69 是显示分组数） | `tallyDisplayPatches` = `{applied:60,total:69,pending:0}`，display rows 69 ✅ |
| 原始口径 | applied 70 / skipped 10 / na 6 | 完全一致（成员见 P0-8）✅ |
| 宿主读哪 | `resources\app` 解包目录 | renderer 命令行 `--app-path="%INSTALL_DIR%\resources\app"`；`asar_still_sealed=false` ✅ |
| 补丁真在进程里 | 判据 2 > 0 | `main.js` 里 `dsh-purge` 11 处（数量变了，定性成立）✅ |
| 备份缺口 | 0 个；空操作备份 3 个（session-reference） | `backup_gap={missing:[],suspect:[],noop:[3 个 session-reference 文件]}` ✅ |
| shim | `dsh.cmd=original`，`dsh.ps1`/`dsh` missing | `runtime\cli\bin` 只有 `dsh.cmd`（243 字节）；gatherState 同 ✅ |
| 进程数 | 9 个 `DeepSeek Harness` | 实测 9 ✅ |
| 灵魂层指纹 | digest `7e5e018ffdf6` | `assert-soul-guard` → `digest 7e5e018ffdf6` ✅ |
| 两份副本的 inode 关系 | package.json / lib/index.js / lib/core.js / client.js / cordis.patch.yml / scripts/assert-patches.mjs 同 inode；lib/patches.js 等独立 | 逐个 stat：前六个 nlink=2 且 ino 相同；`lib/patches.js`/`CHANGELOG.md`/`release-notes.md`/`soul-guard.lock` ino 各异 ✅ |
| patches.js 当前是否同步 | 必须两边手改 | 两份 sha256 相同（`eb9a9954be46b871…`，190,069 字节）✅ |
| #103 日志落点 | `~/.dsh/logs/` | 补丁文本 `__wsHome() + "/.dsh/logs"` → `workspace-init-error.log` ✅（目录当前不存在 = 从没失败过，不代表没生效） |
| 回滚脚本方向 | 用 `move` 把 `.dshpurge-away` 改回 `app.asar` | 机制仍有效（`app.asar` 现在缺席，改回去就是重新密封）✅ |
| 1.2.0 回滚包 | 已不存在 | `backup\plugins-20261030` 下只有 1.2.2-before-1.2.3 / 1.2.4-actual-snapshot / local-plugins-rebuild-20261102.7z ✅ |
| `app.asar.original` | 早已删除 | 三个候选路径全部 MISSING ✅ |

# 五、未验证（本机禁网/无凭据，别当结论用）

- GitHub Releases `v1.2.8` / `v1.2.9` / `v1.3.0` 及资产 `.zip`、commit `201df2d` / `6b93b31` / `53cfa3c`；
  本地能证的只有 `package.json=1.3.0`、`release-notes.md` 首行 `# 1.3.0`、`CHANGELOG` 顶条 1.3.0。
- 面板漏判 `dsh-workspace` 那份「bak == 现文件」的**原因**（P0-7）：只验到现象与 `backup_gap` 的结果，没有读 `suspect` 的判据代码。
- `_diag\restart-dsh.bat` 那晚失败的真实原因（P2-20 只是指出脚本与要求不符，因果未验）。

---

# 总判断

**不能直接交给下一个会话用。** 骨架（作业目录规矩、两份副本/inode 铁律、加补丁五步、判据套路）都还站得住，
但文首的「当前状态」和「asar 是 rc.1 镜像」这两处会让人拿 rc.1 的尺寸去核 rc.3 的文件、甚至拿错版本的原件覆盖宿主；
再加上 `runtime.old-0.2.1` 这条已死的退路和一份回滚不出原件的 bak，照着做会实实在在踩坑。
按上面 8 条 P0（约 40 分钟）改完、并把 12 条 P1/P2 数字顺手对齐，就可以直接交接。
