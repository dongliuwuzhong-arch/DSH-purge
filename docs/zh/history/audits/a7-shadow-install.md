# 影子-A7 · 破甲真实安装验证（applyPatches 真跑一遍）

- 验证对象：`dsh-purge` 现网插件副本 `%USERPROFILE%\.dsh\profiles\desktop\node_modules\dsh-purge`（lib/core.js 196756 字节，mtime 11-14 02:21）
- 宿主版本镜像：`0.2.2-rc.3`（`%SHADOW%\mirror-0_2_2-rc_3`，62 个文件）
- 执行时间：2026-11-15 00:20~00:45
- 执行者：影子安装工程师（子代理 agent-7）

## 0. 结论速览

1. **真安装路径跑通了**：87 条补丁在干净 rc.3 副本上跑完，`applied 53 / already 4 / skipped 4 / missing_file 26`，`backupAll` 120 ms + `applyPatches` 195 ms，改 40 个目标文件、建 44 份备份，进程零异常、零 lastError。
2. **备份正确**：44/44 份 `.dshpurge.bak` 与"打之前的原件"sha256 全等（对照组 = mirror 原件）。
3. **目标文件幂等 ✓，备份幂等 ✗（P0）**：第二遍不改任何目标文件，但把 `dsh-workspace/lib/index.js.dshpurge.bak` 覆盖成了**打过补丁的版本**，原件当场丢失；此后 `revertAll` 把该文件归为 skipped（沉默），`backupGap` 也看不见它。真机现场与"只差跑第二遍"的状态字节完全一致。
4. **还原**：单次循环 62/62 文件字节级回到原件（diff 为空）；双跑循环 39/40 还原，卡住的正是上面那条。
5. **静默跳过**：26 条 `missing_file` 里 **19 条其实文件就在盘上**（13 条 key 解析不到、6 条被区域门挡掉），只有 7 条是本机真没有。状态名"文件缺失"把这批结构失配掩盖成了"这版没这文件"。

## 1. 环境与复现

跑批命令（三条环境变量缺一不可，DSH_HOME 决定"往哪个家里写"）：

    cd %WORKSPACE%
    set DSH_SURFACE=desktop
    set DSH_HOME=%SHADOW%\home-a7-rc3
    "%INSTALL_DIR%\resources\runtime\primary-runtime\dependencies\node\bin\node.exe" %SHADOW%\work-0_2_2-rc_3\_a7\run.mjs apply

脚本（这次现写的，全落在影子内）：

| 脚本 | 干什么 |
| --- | --- |
| `work-0_2_2-rc_3\_a7\probe.mjs` | 解析 findDshHome / 键表，验 46 个 key 全落在影子内 |
| `work-0_2_2-rc_3\_a7\run.mjs` | phase=apply / idem / bakeq / revert 四相跑批 |
| `work-0_2_2-rc_3\_a7\runB2.mjs` | 单循环对照（apply 一次 + 全量还原比对） |
| `work-0_2_2-rc_3\_a7\runC.mjs` | 双跑 + backupGap 检测能力验证 |
| `work-0_2_2-rc_3\_a7\shim.mjs` | shim 侧 patchShim / revertShim |

影子布局（全部在 `%SHADOW%\`，纯 ASCII）：

| 路径 | 内容 |
| --- | --- |
| `mirror-0_2_2-rc_3` | 只读基线（62 文件），当"原件"对照组 |
| `work-a7-rc3` | 主副本：apply → apply → revert（复现假备份） |
| `work-a7-rc3b` | 对照副本：apply 一次就 revert（验还原完整性） |
| `work-a7-rc3c` | 对照副本：apply 两遍 + backupGap（验检测能力） |
| `home-a7-rc3` | 影子 DSH_HOME：`profiles\desktop\node_modules\dsh-purge`（现网插件整份拷贝） |
| `work-shim-a7` | shim 试验目录（dsh / dsh.ps1 / dsh.cmd） |
| `_a7-marker` | 时间戳标记，用来证明真实树零改动 |

## 2. applyPatches 的真实入参与调用序（含行号）

`lib/core.js` 里的签名：

| 函数 | 位置 | 签名 / 要点 |
| --- | --- | --- |
| `applyPatches` | core.js:4038 | `applyPatches(aiBase, patches = ALL_PATCHES, options = {})` → report 数组。**它自己不建备份** |
| `backupAll` | core.js:2864 | `backupAll(aiBase)` → `{made, errors, skippedUser, dropped, refused}`；bak 名 = 文件名 + `BAK_SUFFIX` |
| `BAK_SUFFIX` | core.js:2702 | `".dshpurge.bak"` |
| `inspectStaleBaks` / `refreshStaleBaksForUpgrade` | core.js:2790 / 2860 | apply 开头就跑；判"老 bak 过期"就**把当前文件写进 bak** |
| `revertAll` | core.js:3081 | `revertAll(aiBase, options={})` → `{reverted, skipped, noBackup, unrevertable, noop, preservedUser, errors}`。**没有 revertPatches，还原入口就是它** |
| `revertAllHosts` | core.js:1954 | 上一层的多宿主版 |
| `shimBackupPath` | core.js:306 | `shimBackupPath(fp)`；密封 `runtime/cli/bin` 例外，bak 挪去 `$DSH_HOME/dsh-purge/shim-backups/<名>.<sha1前20>.bak` |
| `patchShim` / `revertShim` | core.js:4540 / 4632 | `patchShim(shimDir)` / `revertShim(shimDir, {scrubDesktop})`，文件集 `SHIM_NAMES = ["dsh.cmd","dsh.ps1","dsh"]`（core.js:44） |
| `patchAllShims` / `revertAllShims` | core.js:4600 / 4663 | 多目录版 |
| `shimIsPatched` / `shimFileStatus` | core.js:4395 / 4404 | 状态查询 |

真实"点应用"的执行序（`applyPatchesAllHosts`，core.js:1910-1952；我照抄这条，只把宿主枚举换成固定的影子 aiBase）：

    enumeratePatchAiBases()  →  resolveAiBaseForApply()
    → backupAll(aiBase)                        // core.js:1924，先备份
    → applyPatches(aiBase, selected, options)   // core.js:1930
        ├ restoreMissingOriginalsFromBak(aiBase)   // 4039
        ├ refreshStaleBaksForUpgrade(aiBase)       // 4040  ← 假备份出在这
        ├ targetFiles(aiBase)                      // 4041  ← 区域门过滤在这
        ├ repairPluginCordisYaml()                 // 4044  ← 写插件自己的 cordis.patch.yml
        └ 逐条 applyReplacementsToText → saveText（原子写）

`findDshHome()`（core.js:1626-1653）**优先吃 env.DSH_HOME**，影子 home 一设就生效；`targetFiles(aiBase, dshHome)` 里凡 dshHome 相关的键（预设、liangshen、profiles\web）都跟着落进影子。

## 3. 影子 DSH_HOME 要什么骨架

实测只需要一样：`profiles\desktop\node_modules\dsh-purge`（现网整份 2.3 MB / 86 文件）。

- 任务书里的"minimal 预设骨架"实际来自 **aiBase 镜像**：`dsh-web-app/presets/minimal.patch.yml` 镜像自带，补丁 26/70/73 都落在它上面（applied），80 判 skipped。
- 真机 `%USERPROFILE%\.dsh\.agent-presets` **根本不存在**（ls 报 No such file），所以 `preset-unrestricted` / `preset-liangshen` 这类键在真机与影子里同样解析不到，不用额外补。
- 唯一要注意：跑批必须 import **影子那份** core.js，不能 import 现网那份。`repairPluginCordisYaml()`（core.js:4030）会写"本模块旁边的 cordis.patch.yml"，用现网模块就等于往真机 home 落盘。实测影子这份没被改（第 9 节）。

## 4. 首跑结果（work-a7-rc3，干净镜像副本）

    phase: apply        msBackup: 120   msApply: 195
    bakMade: 44   bakErrors: 0   bakRefused: 3   bakSkippedUser: 0   bakDropped: 0
    patches: 87   statusCounts: { missing_file: 26, already: 4, applied: 53, skipped: 4 }
    changedFileCount: 84   newFiles: 44   goneFiles: 0   bakTotal: 44

（84 = 40 个目标文件被改 + 44 份 bak 新建；`patches:87` 与 ALL_PATCHES 总数一致，桌面面 87/87 全适用——层分布：提示词 25 / 代码 51 / 工具 8 / 0.1.5 兼容 1 / 0.2.0 兼容 2）

细节存档：`work-0_2_2-rc_3\_a7\report-apply.json`（87 行全量）、`backup.json`、`before.json`。

## 5. 三项核对

### (a) 备份是不是"打之前的原件" —— 是，44/44

以 `mirror-0_2_2-rc_3` 原件为对照组逐份 sha256 比对：

    { "pairs": 44, "bakEqOriginal": 44, "bakNeOriginal": [], "orphanBak": [] }

同一时刻 `originalsNotEqualToMirror` 列出 **40** 个文件已与原件不同（与 changedFileCount 的 40 一致，即确实被打过），说明这不是"两边都没动"的空相等。

**但 backupAll 有 3 条 refused（没建 bak）**，返回值直接点名：

    dsh-session-reference\lib\index.js
    dsh-session-reference\lib\types\index.js
    dsh-session-reference\lib\types\spill.js

原因：`targetLooksPatched()`（core.js:3009 起）在 rc.3 原生文本上判"已经打过补丁"，`backupAll` 于是拒建（core.js:2890-2893）。这三个文件本次**一个字节都没被改**（未进 changed 列表），所以无害；缺口是真的——哪天它们被改，就只剩 noBackup。真机上这三份有历史 bak（第 9 节采样），真机不算缺口。

### (b) 再跑一遍是否幂等 —— 文件字节幂等，备份不幂等

第二遍同样序（backupAll → applyPatches）：

    msBackup: 40   msApply: 92   bakMade: 0
    statusCounts: { missing_file: 26, already: 57, skipped: 4 }   applied: 0
    changedFileCount: 1

- 87 条里 53 条 applied → already，目标文件**零字节改动**（manifest 逐文件 sha256 比对）。
- 唯一被改的那 1 个不是目标文件，是备份：`dsh-workspace/lib/index.js.dshpurge.bak`。

### (b-1) P0：第二遍会把 dsh-workspace 的备份刷成假原件

第三份副本（work-a7-rc3c）的干净对照：

    pass1: bak sha = 8964c54f3c3f2fd79ed92e5fb1413d84ba80272c4eb984677aaf70bf4d687848  (39521 B = 原件)  → 与原件相同 true
    pass2: bak sha = 663806456a76159a4616dc7e9607d7e25f26cdef559236d78748b18905dfc85e  (40014 B = 打过补丁的文件)  → 与原件相同 false
    pass2: bak == 当前已打补丁文件 → true

路径根因（core.js）：

- 每次 `applyPatches` 开场先跑 `refreshStaleBaksForUpgrade(aiBase)`（core.js:4040）；
- 它走 `inspectStaleBaks`（core.js:2790-2858）：`current != bak` 且 `targetLooksPatched(current, keys) === false` 时，认为"这是官方新版、bak 过期了"，于是 `fs.writeFileSync(bak, current)`（core.js:2848-2850）**把打过补丁的当前文件写成新基线**；
- 补丁 #103（patches.js:3668-3697，`WORKSPACE_INIT_ERROR_LOG`，file: `workspace-lib`）是"在前面插两行 import"型，产物不带任何 dsh-purge 字样、也没有 markers，`targetLooksPatched` 于是判 false —— 判据对这类"不落标记"的补丁天然失效；
- bak 一旦变假原件，`revertAll` 走到 core.js:3116 `sameFileBytes(fp,bak)` 为真，再 `targetLooksPatched` 判 false，就归进 `skipped`（core.js:3125）——**看着像"文件没被动过"，实际永远回滚不掉**；
- `backupGap()`（core.js:3036）本是查"可疑备份"的现成工具，但它同样用 `looks && bak==current` 判 suspect（core.js:3064），`looks` 为 false 就一个列表都不进。实测 `backupGap_suspect: 0, missing: 3, noop: 0, patched: 0`，**workspace 一条都没被点名**。

**真机现场已踩在坑边**（只读采样，未改动任何东西）：

    %INSTALL_DIR%\resources\app\dsh\node_modules\@deepseek-ai\dsh-workspace\lib\index.js         40014 B  sha 663806456a76...
    %INSTALL_DIR%\resources\app\dsh\node_modules\@deepseek-ai\dsh-workspace\lib\index.js.dshpurge.bak  39521 B  sha 8964c54f3c3f...

真机当前文件 sha 与影子"打完第一遍"的 sha **完全相同**（663806456a76…），bak 与原件 sha 也完全相同（8964c54f3c3f…）。真机现在正是"跑第二遍之前"那个状态，判据输入字节一致 → 结果必然一致。

为什么真机现在还是干净的：启动自愈有闸 —— `state.patches_pending === 0` 时直接 `already_clean` 返回，根本不调 `applyPatchesAllHosts`（index.js:1258-1266）。所以触发条件是：

1. 用户点「应用」/ 走 `restartOfficialHost`（core.js:2282 那条）；
2. 出现任何 pending（官方升级换了文件、marker 缺失、client bundle 被判 pending）导致启动自愈真跑一遍；
3. `reapply.js:347` 的重放路径。

## 6. 还原验证

### 6.1 单次循环（work-a7-rc3b：apply 一次就 revert）—— 62/62 字节级还原

    revert: { reverted: 40, skipped: 4, noBackup: 3, unrevertable: 0, noop: 0, errors: 0 }
    diffAfterRevert: []                      ← 62 个原件里 0 个与镜像不同
    extraAfterRevert: 4 个 *.dshpurge.bak     ← 空操作文件的 bak 没被消耗（无害）
    fileCountAfter: 66   mirrorCount: 62

`skipped` 那 4 个（client-ui-deliverables/index.js、client-ui-conversation/client.js、dsh-tools/index.js、dsh-tools/lib/types/index.js）是"补丁对它们本来就是空操作"（`keyIsNoop`），bak 与现文件本来就相同，跳过是对的；真机上这 8 个同类文件（含 session-reference 三件、dsh-base/package.json）bak 也与现文件字节相同，行为一致。

### 6.2 双跑循环（work-a7-rc3：apply → apply → revert）—— 39/40，卡一条

    revert: { reverted: 39, skipped: 5, noBackup: 3, unrevertable: 0, noop: 0, errors: 0 }
    byteDiffVsMirror: ["dsh-workspace/lib/index.js"]
    bakLeftAfterRevert: 5

39 个正常还原（拷回 bak 后 unlink 备份），5 个 skipped（4 个空操作 + 1 个 `dsh-workspace/lib/index.js`——假备份那条）。**还原后残留的唯一字节差异就是它**，而且面板上它显示 "skipped" 而不是"回滚失败"。

### 6.3 shim 侧（work-shim-a7：假启动器目录）

    patchRes: { "dsh.cmd": "skipped_win_cmd", "dsh.ps1": "patched", "dsh": "patched" }
    bakPaths: dsh.dshpurge.bak / dsh.ps1.dshpurge.bak（就在旁边，非密封目录）
    bakEqualsOriginal: { dsh: true, dsh.ps1: true, dsh.cmd: "no-bak" }
    revRes: { "dsh.cmd": "no_backup", "dsh.ps1": "reverted", "dsh": "reverted" }
    revertByteIdentical: [dsh, dsh.ps1, dsh.cmd]   revertDiffers: []   bakLeftAfterRevert: []
    shimIsPatchedAfterRevert: 三个全 false

## 7. 失败 / 崩溃 / 静默跳过，逐条

**崩溃：0。** 三轮独立跑批（apply / idem / revert）、两份对照副本、shim 试验，无 exception、无 lastError、exit code 全 0。

**缺陷 1（P0）第二遍 apply 破坏备份** —— 见 5(b-1)。触发条件：同一 aiBase 上第二次进入 `applyPatches`，且"备份已存在 + 当前文件已打补丁 + 该补丁不落 dsh-purge 标记"三者同时成立。影响：该文件 bak 永久变假，`revertAll` 静默跳过，`backupGap` 不报。本机已知受害面：`dsh-workspace/lib/index.js`（补丁 #103）。

**缺陷 2（P1）26 条 missing_file 里 19 条"文件在盘上却没打到"** —— 都有记账，不算完全静默，但状态词是"文件缺失"，掩盖了结构失配：

| 类型 | 条数 | 补丁 id | 直接原因 |
| --- | --- | --- | --- |
| key 用裸 aiBase 路径，没走 nestedPkg | 13 | 1,2,3（agent-instructions）· 6,15（sandbox-local）· 7,8,21（base）· 16（fs-sandbox）· 17（fs-observation-policy）· 18（repeat-tool-reminder）· 19（compaction-tool-result-pruner）· 85（api-session-controller） | `targetFiles` 里这些键只写 `path.join(aiBase, "dsh-xxx", ...)`（core.js:3211-3214 / 3267-3270 / 3271-3274 / 3275-3278 / 3287-3290 / 3291-3294 / 3295-3298 / 3383-3386），而 rc.3 桌面布局把包放在 `aiBase/dsh/node_modules/@deepseek-ai/<pkg>`；已经写好、也已被别的键用上的 `nestedPkg()`（core.js:3147-3152）没被这几行采用 |
| 被区域门过滤 | 6 | 45,46,82,83,84,91（desktop-shell） | `officialShellMain()`（core.js:2607）定位到的是**真实安装树**的 main.js，影子 aiBase 不在 `isInsideDesktopInstall` 里，于是 `allowTargetPathForAiBase`（core.js:945-951）判 desktop-install 区不许写，`filterTargetFiles`（core.js:3164-3185）把该键整条丢掉 → 记成 missing_file |
| 本机确实没有 | 7 | 30,31,64,65（hooks-claude-code / hooks-codex）· 76（preset-unrestricted，真机无 .agent-presets）· 28（liangshen/tool-bootstrap.mjs，真机该目录只有 minimal-prompt.mjs 等） | 真机采样：`dsh-hooks-*` 两个包在 `%INSTALL_DIR%\resources\app\dsh\node_modules\@deepseek-ai\` 下不存在；`.agent-presets` 不存在 |

    （13 + 6 + 7 = 26 ✓）

**缺陷 3（P2）4 条在纯净镜像上直接判 already** —— id 4、24（standard.patch.yml）、50（session-reference）、101（agent-loop）。干净原件就满足 settled 判据；同文件的 88 判 skipped。是否属于"判据偏宽、本该打的没打"，本次未验行为影响，只记现象（report-apply.json 第 4/24/50/101 行）。

**缺陷 4（P2）3 条 refused 无备份** —— 见 5(a)。触发条件：干净文件被 `targetLooksPatched` 判成"已打补丁"（markers 命中原话型补丁）。本次三件未被改字节，未造成实际损失。

**缺陷 5（P3）空操作文件留 bak 残留** —— revert 后 4 份 bak 留在盘上（bak == 现文件），不影响还原结果，但 `fileCountAfter 66 vs 62`。

## 8. 未验证（明确标注）

1. **desktop-shell 那 6 条（45/46/82/83/84/91）在真机上能不能打** —— 影子里被区域门挡掉，没打。要验必须让 aiBase 落进桌面安装树内，那会碰真实安装，所以只读不写，未验证。
2. **真机 profile 区目标（`profiles\desktop` 下的 liangshen 等）** —— 影子 home 里没有 @linxin666，补丁 71 因此 missing；真机该文件存在（31750 B，bak 31716 B）。要验得把 liangshen 拷进影子 home，本次没做。
3. **密封 runtime 启动器（`resources/runtime/cli/bin`）的 patchShim 分支** —— `isDesktopCommandRuntimeDir` 只认真实桌面 runtime 路径，影子里没有，未验证；只用假目录验了非密封分支（6.3）。
4. **重启宿主 / 真实安装上跑 apply** —— 硬约束禁止，未做。所有真机结论都是只读采样（sha256 与 mtime）。
5. **0.2.1-rc.3 / 0.2.2-rc.1 / 0.2.2-rc.2 三棵镜像** —— 本次只跑 rc.3（任务要求），另外三版未跑真实安装路径。

## 9. 隔离证明（真实树零改动）

标记文件 `%SHADOW%\_a7-marker` 建于首跑之前，之后所有写操作都在它之后：

    find %INSTALL_DIR%\resources\app -newer _a7-marker -type f   → 0 个
    find %USERPROFILE%\.dsh            -newer _a7-marker -type f   → 9 个，全部是宿主自己的会话记账
      （sessions/*.zstd、storages/session_projcache/*.json、dsh-usage/*.json、dsh-purge/last-cwd.txt）
    真实树里"marker 之后新建的 *.dshpurge.bak"                        → 0 个

补充证据：

- `dsh-purge/last-cwd.txt` 的写入方是 `rules.js:46`（宿主每轮记 cwd），内容 `%WORKSPACE%\专项任务`，与本任务无关；影子 home 下**没有** `dsh-purge` 目录，证明跑批一次都没走那条路径。
- 现网插件本体 mtime 未变：`core.js` 11-14 02:21、`patches.js` 11-14 02:23、`cordis.patch.yml` 11-06 21:20。
- 真实安装树里 63 个既有 bak，marker 之后被触碰的 0 个；`dsh-tool-fs/lib/index.js` 仍 11-14 01:29、`dsh-workspace/lib/index.js` 仍 11-14 01:22。

## 10. 本次产出的中间件（都在影子内，可删）

| 路径 | 状态 |
| --- | --- |
| `%SHADOW%\work-a7-rc3\` | 主副本：apply×2 + revert 后的现场（假备份仍在） |
| `%SHADOW%\work-a7-rc3b\` | 对照副本：单循环，已还原干净 |
| `%SHADOW%\work-a7-rc3c\` | 对照副本：双跑未还原（假备份现场） |
| `%SHADOW%\home-a7-rc3\` | 影子 DSH_HOME |
| `%SHADOW%\work-shim-a7\` | shim 试验目录（已还原） |
| `%SHADOW%\work-0_2_2-rc_3\_a7\` | 脚本 + 报告 JSON（report-apply / report-idem / report-revert / before / backup） |

## 11. 建议的下一步（未执行，交回主控）

1. P0 那条：`inspectStaleBaks` 与 `backupAll` 用的是同一个 `targetLooksPatched`，但两个方向的误判刚好相反（一个用来"拒建备份"，一个用来"刷新备份"）。修之前**别在真机上连点两次应用**，也别在有 pending 时重启 —— 一跑就把 `dsh-workspace` 的 bak 变成假原件。
2. P1 那条：`targetFiles` 里 13 个裸 aiBase 键改成 `nestedPkg`，rc.3 桌面布局就能多打 13 条；改完这 13 条的行为要重跑本报告第 4~6 节。
3. 若继续：可把 liangshen / desktop-shell 两类缺口在影子里补设施再验一轮（往影子 home 拷 liangshen、伪造一个桌面安装根 + exe），风险仍锁在影子内。
