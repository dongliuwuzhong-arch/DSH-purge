# 00 · 运维手册

> 读者：三个月后的自己，或者接手的人。判据是**只读这一篇**就能做完日常维护与一次宿主升级。
>
> 路径一律写占位符，本机的真实绝对路径在知识库那份的「本机专属」一节：
>
> - `<插件根>` = 破甲源码目录（`package.json` 所在，通常 `$DSH_HOME/plugins/dsh-purge`）
> - `<DSH_HOME>` = 宿主数据根（默认 `~/.dsh`）
> - `<安装目录>` = DSH 安装目录，`<安装目录>\resources\app` 是解包出来的 app 树
> - `<宿主插件根>` = `<安装目录>\resources\app\dsh\node_modules\@deepseek-ai`
>
> 文中标 **[实测]** 的是本文写作时跑出来的真实输出；标 **[判断]** 的是从代码推的结论，可能错。
> 代码位置写成 `lib/core.js:数字`，行号会随改动漂移——**按函数名找，别信行号**。

---

## 0. 六十秒版

| 我要… | 跑这个 | 通过长什么样 |
| --- | --- | --- |
| 确认宿主读的是哪棵树 | `node tools/check-paths.mjs` | 9 条 `[✓]`，末行「全部验过，都对得上」 |
| 看 88 条补丁现在什么状态 | 面板，或 `node bin/dsh-purge.js --status` | `applied 75 / pending 0 / skipped 3 / na 9 / excluded 1` |
| 看剪枝到底走哪条轨 | `node tools/check-pruner.mjs` | 「剪枝可用，4 处预设已接上」 |
| 确认补丁表没被改坏 | `node scripts/assert-patches.mjs` | `✓ 补丁表自检通过` |
| 确认注入正文和关键补丁没被顺手改 | `node scripts/assert-soul-guard.mjs` | `soul-guard ok …（digest …）` |
| 确认代码没退化 | `node --test "test/*.test.mjs"` | `tests 194 / pass 194 / fail 0` |
| 决定要不要换包 | `node scripts/preflight-upgrade.mjs --host "<候选树>"` | 退出码 0 + 「相对基线无漂移」 |

五条铁律，用来解释后面所有内容：

1. **先问"宿主读的是哪棵树"，再问"补丁贴没贴上"。** 树错了，后面全是空转，面板还会显示绿色。
2. **原件只有一个来源：`.dshpurge.bak`。** 它一旦可疑，"能回滚"就是假的——这比"没备份"更危险，因为它不报警。
3. **`skipped` 不等于没问题。** 它同时表示"上游自己做了""我们贴过但标记漂了""这条已经废了"三种完全不同的生命周期。
4. **换包前先预检，别自己写换包脚本。** 破甲自己有换包逻辑，两套抢活是 2026-11-16 那场事故的成因。
5. **改完源码要同步运行副本。** 宿主跑的是 `<DSH_HOME>/profiles/<profile>/node_modules/dsh-purge`，不是你在改的那份。

---

## 一、破甲是什么

### 1.1 它做四件事

| 干的事 | 落在哪 | 代码 | 一句话判据 |
| --- | --- | --- | --- |
| **补宿主代码**：88 条补丁改 `@deepseek-ai` 下的 JS / YAML | `<宿主插件根>`（和它的 `dsh\node_modules` 镜像） | `lib/patches.js`（表）+ `lib/core.js`（引擎） | `grep -c "dsh-purge" <某目标文件>` 非 0 |
| **洗提示词**：把默认注入正文换成自己的，再挂进系统提示 | `<DSH_HOME>/prompt-inject.md` + 宿主 `dsh-agent-instructions` | `lib/default-prompt-inject.md`（构建期嵌进 `lib/core.js`）+ 补丁 #1/#2/#3/#40/#101 | 新会话里人格只出现 **1 份** |
| **桌面壳 / 换包**：把 `app.asar` 挪开让宿主回落解包目录、抑制退出弹窗、接官方更新握手 | `<安装目录>\resources\app.asar` → `.bak` | `lib/desktop.js`（`ASAR_SWAP_PS1`）+ 补丁 #45/#46/#82/#83/#84/#91 | `check-paths` 第一条说"读的是解包目录" |
| **shim**：PATH 上放 `dsh.cmd` / `dsh.ps1` / `dsh`，注入运行时环境、隐藏 cmd 闪窗 | `<shim 目录>` | `lib/core.js`（`findShimDir` / `silenceCmdFlash`）+ `lib/hide-console.js` + `lib/child-process-hide.mjs` | `node bin/dsh-purge.js --status` 末尾三行 shim 都不是 `missing` |

为什么必须解包：宿主默认从 `resources\app.asar` 读代码，那是只读档案，改不动。破甲把 asar 改名成 `app.asar.bak`（脚本里写死这个名字），宿主回落到 `resources\app` 目录，补丁才有落点。

**怎么做（一次完整 apply 会发生什么，按代码顺序）**

```
for 每个宿主 aiBase（enumeratePatchAiBases，通常 1~2 个）：
  1. backupAll(aiBase)                建 .dshpurge.bak（见第四节，含"拒建"）
  2. restoreHookDenyForBases          仅当 settings.hooksDenyBypass === false
  3. applyPatches(aiBase, selected)   按 ALL_PATCHES 顺序逐条替换（不排序 → 天然幂等）
  4. silenceCmdFlash(aiBase)          shim 那一层
  5. hostCleanMarkersPresent          记录"宿主里到底有没有破甲痕迹"
再在插件层：写 override（prompt-inject.md）、写 client bundle、装 shim 三件套
```

顺序有两个后果，记住：**备份永远在补丁之前**（所以 bak 是原件）；**补丁按表顺序贴**（所以二段补丁能成立，见 6.3）。

### 1.2 三个数据面：谁管谁

这是全篇最重要的一张表。**三份东西各自独立，改动一份不会同步到另一份。**

| 数据面 | 文件 | 谁写 | 宿主升级会怎样 | 判据 |
| --- | --- | --- | --- | --- |
| **① 补丁表** | `lib/patches.js`（88 条）+ 运行副本里的同一份 | 人（改仓库） | 不变，但**锚点会被新版宿主打穿**（补丁静默落空） | `assert-patches` / 预检 / `patchStatus` |
| **② profile 配置** | `<DSH_HOME>/profiles/<profile>/cordis.patch.yml` | 人（手改 YAML） | 不被覆盖，但**官方新增的插件行不会自动进来**（覆盖块整体替换 config，见 5.1） | 面板 / `tool_gate({action:"status"})` / `count-injections` |
| **③ 宿主机文件树** | `<安装目录>\resources\app\dsh\node_modules\@deepseek-ai` | 破甲（apply） | **整个换掉**，所有补丁回到出厂态 | `check-paths` / `patchStatus` / `grep "dsh-purge"` |

三者打架时的读取顺序：

1. **宿主树是唯一事实**。补丁表说"应该改成什么"，profile 说"运行时装配什么"，只有宿主文件里的 `[dsh-purge]` 痕迹证明"确实改了"。
2. **profile 配置能一票否决补丁表**。`preset-*` 覆盖块里的 `config` 是整体替换，补丁改过的出厂 `presets/*.patch.yml` 在运行时可能根本不参与（#26 / #43 对 minimal / ptc / standard 三档就是死代码，见 5.1）。
3. **补丁表只在自己的判据里有效**。`patchStatus` 读的是宿主文件的文本，不是内存里的表。

**怎么做**：任何"补丁没生效"的怀疑，按 ③→②→① 顺序查，别从改表开始。

```bash
# ③ 宿主树：文件里到底有没有痕迹
grep -c "dsh-purge" "<安装目录>/resources/app/dsh/node_modules/@deepseek-ai/dsh-agent-loop/lib/index.js"
# ② profile：运行时装配的是什么（看覆盖块里的 id 有没有少）
grep -n "tool-executor-ptc\|tool-office" "<DSH_HOME>/profiles/desktop/cordis.patch.yml"
# ① 表：这条补丁的锚点今天还对不对得上
node scripts/preflight-upgrade.mjs --host "<安装目录>/resources/app"
```

### 1.3 文件地图（改之前先认清哪个是"真源"）

| 东西 | 位置 | 性质 |
| --- | --- | --- |
| 补丁表 | `lib/patches.js` | **真源**。`ALL_PATCHES.length === 88`，最大 id 105 |
| 引擎 | `lib/core.js` | 真源。`assert-patches` / 预检 / 面板都 import 它 |
| 换包逻辑 | `lib/desktop.js` | 真源。`ASAR_SWAP_PS1` 是那段 PowerShell 的正本 |
| 重打入口 | `lib/reapply.js` | 真源。`reapplyInstalled` 先 `revertAll` 再 `applyPatchesAllHosts` |
| 默认注入正文 | `lib/default-prompt-inject.md` | 真源，但**构建期被嵌进 `lib/core.js`**：改文件不重跑 `scripts/embed-default-prompt.mjs` 等于没改 |
| 用户副本 | `<DSH_HOME>/prompt-inject.md` | 运行时注入读它；**插件不覆盖手改过的副本** |
| 提示词闸门基线 | `soul-guard.lock` | 1 个注入文件 sha256 + 16 条关键补丁语义指纹 + 总 digest |
| 预检基线 | `scripts/preflight-baseline.json` | "已知良好树"的 applied / skipped 名单，换包时唯一能区分"本来就这样"和"新版弄坏了"的东西 |
| 排除清单 | `<DSH_HOME>/dsh-purge/exclude-patches.json` | 用户级；`{"excludePatches":[19]}` |
| 运行副本 | `<DSH_HOME>/profiles/<profile>/node_modules/dsh-purge` | Junction 或实体副本；宿主实际加载这份 |
| 原件 | `<目标文件>.dshpurge.bak` | 同目录；回滚唯一来源 |
| 禁用态副本 | `<pruner>/lib/index.js.purge19-disabled.bak` | #19 打过之后的形态，留给人手切换 |

---

## 二、日常判据（七条命令，各自回答一个问题）

### 2.0 对照表

| 命令 | 回答的问题 | 退出码 | 耗时 |
| --- | --- | --- | --- |
| `node tools/check-paths.mjs` | 宿主读的是哪棵树？插件源和副本一致吗？三处落点有痕迹吗？人格注入份数对吗？ | 0 = 全过 | <2s |
| `node bin/dsh-purge.js --status`（面板同源） | 88 条逐条什么终态？备份缺口几类？shim 在不在？ | 0 | 1~3s |
| `node tools/check-pruner.mjs` | 剪枝走的是原始实现还是 #19 禁用态？四处预设阈值是多少？ | 0 = 可用 | <2s |
| `node scripts/assert-patches.mjs` | 补丁表自身还自洽吗（条数 / id 唯一 / 与 CHANGELOG 声明一致）？ | 0 / 1 | <1s |
| `node scripts/assert-soul-guard.mjs` | 注入正文和 16 条关键补丁有没有被人"顺手改"？ | 0 / 1 | <1s |
| `node --test "test/*.test.mjs"` | 代码有没有退化？ | 0 / 1 | ~3s（194 例） |
| `node scripts/preflight-upgrade.mjs --host <树>` | 候选宿主树上哪些补丁贴得上、哪些锚点失效？ | 0 / 2 / 1 | 5~20s |

`tools/check-paths.mjs` 和 `tools/check-pruner.mjs` **不在本仓库**，是本机运维脚本（随工作区走）；其余四条都在 `scripts/` 下。

命令里一律写 `node bin/dsh-purge.js …`：`dsh-purge` 这个短名只有在跑过全局安装 / `npm link` 的机器上才有（本机没跑，直接敲会 `command not found`）。

### 2.1 `check-paths.mjs` — 先问树，再问别的

它一次回答四件事，任何一件不对都可能让后面所有判断失去意义。

**[实测] 通过时**：

```
[✓] 宿主读的是解包目录：<安装目录>\resources\app（文件补丁能生效，依据：进程命令行 --app-path）
[✓] dsh-purge 源与副本一致（123353 字节，入口 lib\index.js）
[✓] dsh-soul 源与副本一致（53830 字节，入口 index.js）
[✓] dsh-frame 源与副本一致（11078 字节，入口 lib\index.js）
[✓] dsh-tool-gate 源与副本一致（10177 字节，入口 lib\index.js）
[✓] 宿主读解包目录，三处落点都有破甲痕迹（预设 / persona / main.js）
[✓] profile 覆盖层：minimal 已带 agent-instructions
[·] selectedDefault = minimal
[✓] 人格探针：1/1 个会话人格在上下文里，全部正常
[·] 本机有 2 份 runtime.json，采用 0.2.2-rc.3；另一份 0.2.2-rc.1 在 …
[✓] 三层版本一致：0.2.2-rc.3（外壳 / 主程序 / 底座）

全部验过，都对得上。
```

`[·]` 是信息行不是失败（`selectedDefault`、多份 `runtime.json` 各一条）。判红只看 `[✗]` 和末行。

**红了的典型与处置**

| 现象 | 判据 | 处置 |
| --- | --- | --- |
| 第一条显示读 `app.asar` | 树站错了 | 等宿主正常退出，把 `app.asar` 改名 `app.asar.bak`，重启（见 6.5） |
| 「源与副本一致」红 | 改了源码没同步 | `node scripts/sync-runtime.mjs --apply`（见 8.3） |
| 「三处落点」红 | 补丁没贴 / 照旧贴在了另一棵树 | 先 `node bin/dsh-purge.js --status` 看终态，再 apply |
| 「人格探针」红 | 上下文里人格 0 份或 >1 份 | 0 份：查 `<DSH_HOME>/prompt-inject.md` 在不在；>1 份：见 5.2 双实例 |
| 「三层版本一致」红 | 外壳 / 主程序 / 底座不同版 | 换包没换全，按 6.7 回滚资产恢复 |

### 2.2 `patchStatus` — 88 条逐条终态

面板和 `node bin/dsh-purge.js --status` 走同一个函数 `patchStatus(aiBase, patches, options)`。它做三件事：按宿主面过滤（`patchAppliesHere`）→ 逐文件问 `patchFileOutcome` → 收成一条补丁一个终态（优先级 `pending > applied > unmatched > skipped > na/missing_file`）。

**[实测] 通过时（与面板同源）**：

```
补丁 88 条：applied 75 / pending 0 / skipped 3（可选 3、要重锚 0） / na 9 / missing 0 / excluded 1
合计 87 + 排除 1 = 88 ✓
```

怎么读：

- **`pending > 0` 且刚换过包**：正常（还没贴）。点应用即可。
- **`pending > 0` 但没换过包**：有人把文件改回原文了，或 apply 中途失败。
- **`skipped` 里带「要重锚」的**：那是非 optional 的失配 → 补丁静默落空，见 3.6 红线一。
- **`missing_file` 非 0 而文件明明在**：分区守卫把键丢了，见 6.4。

```bash
# 面板之外看逐条（含 ! 标记的非 optional skipped）
node bin/dsh-purge.js --status | sed -n '/补丁 /,$p'
```

### 2.3 `check-pruner.mjs` — 剪枝到底走哪条轨

破甲和剪枝是**互斥**关系：#19 把 `pruneContent()` 改成 `return null`，而"温和剪枝"要求宿主保持原始实现。这条命令把三条事实一起打出来。

**[实测] 通过时**：

```
[✓] 宿主包: <app>\node_modules\@deepseek-ai\dsh-compaction-tool-result-pruner
[✓] 代码层: 原始实现在线（7.4 KB）
[✓] preset-minimal: 接上了，阈值 32768
[✓] preset-ptc: 接上了，阈值 32768
[✓] preset-standard: 接上了，阈值 32768
[✓] 梁神: 接上了，阈值 32768
[✓] 还原备份 .dshpurge.bak 在
[✓] 补丁版副本 .purge19-disabled.bak 在（想退回禁用态可用）

[✓] 剪枝可用，4 处预设已接上
```

**红了的典型**：「代码层: 禁用态(#19)」+ 阈值显示死配置 → 有人 apply 了 #19。处置：`<DSH_HOME>/dsh-purge/exclude-patches.json` 写 `{"excludePatches":[19]}`，再从 `.dshpurge.bak` 还原 `lib/index.js`，重启宿主（细节见 5.3）。

### 2.4 `assert-patches.mjs` — 补丁表自检

查四件事：条数、id 唯一、每条都有 `name` / `file`、**与 CHANGELOG 里那句「补丁表 N 条」对得上**。

**[实测]**：

```
patches=88 unique_ids=ok changelog=88
✓ 补丁表自检通过
```

退出码 1 的三种原因，处置都在字面上：id 重复 → 表里加了重复条目；`changelog=N` 对不上 → 改表忘改文档（或反过来）；「CHANGELOG 里找不到「补丁表 N 条」」→ 有人把那句声明删了，**补上那句话**，别改断言。

### 2.5 `assert-soul-guard.mjs` — 提示词层有没有被顺手改

基线是 `soul-guard.lock`：`lib/default-prompt-inject.md` 的 sha256 + 16 条关键补丁（#1 #2 #3 #4 #25 #26 #32 #40 #43 #55 #66 #71 #73 #76 #87 #101）的语义指纹。

**[实测]**：

```
soul-guard ok：1 个注入文件 + 16 条破甲补丁与基线一致（digest 411f5449d8fc）
```

`desc` / `layer` 这类纯文案不在指纹里，可以随便改措辞；`id / name / file / rel / markers / replacements` 和注入正文不能顺手改。确实要改：

```bash
node scripts/assert-soul-guard.mjs --update    # 会改 soul-guard.lock
```

基线必须和改动一起提交，并且**在 CHANGELOG 里写明理由**——没有理由的基线更新等于绕过闸门。

### 2.6 全量测试

```bash
node --test "test/*.test.mjs"    # 必须带 glob
```

**[实测]**：`tests 194 / pass 194 / fail 0`。

三个必须知道的点：

1. **一定要带 glob。** 裸跑 `node --test` 会让 Node 递归扫目录；这版 Node 某些情况下还直接报 `Cannot find module ...\test`。
2. **别在 `test/` 下面留副本。** 1.4.0 删掉了 11-06 的陈旧副本 `test/test/`——它让裸跑变成 156 例、11 红，而 CI 是绿的（那个目录从没进版本库）。谁按直觉敲 `node --test`，谁就去追 11 个不存在的失败。
3. **绿了不等于真机上贴得上。** 有 7 个补丁用例把宿主源码抄进了测试，另有一条测的是手抄的复刻实现（`clean-gate.test.mjs`）。要验"真贴得上"，只有预检 + 链式干跑（6.3）。

### 2.7 预检 `preflight-upgrade.mjs` — 换包前的唯一判据

只读，不写任何文件（`--save-baseline` 除外）。

```bash
node scripts/preflight-upgrade.mjs --host "<候选树>/resources/app"
```

**[实测] 在已贴满的树上**：

```
预检目标: <安装目录>\resources\app\dsh\node_modules\@deepseek-ai
宿主版本: @deepseek-ai/dsh-desktop@0.2.2-rc.3  /  @deepseek-ai/dsh-desktop-runtime@0.2.2-rc.3
破甲基准: 0.2.2-rc.3  ✓ 一致

补丁 88 条：applied 75 / pending 0 / skipped 3（可选 3、要重锚 0） / na 9 / missing 0 / excluded 1  ——  合计 87 + 排除 1 = 88 ✓

桌面壳（独立核查 <安装目录>\resources\app\lib\main.js）：applied 6 / 待贴 0 / 模式不匹配 0

这棵树里不适用（文件不存在）：#76 #28 #30 #31 #47 #49 #57 #64 #65

已排除（exclude-patches.json，不计入任何判定）: #19

基线: @deepseek-ai/dsh-desktop-runtime@0.2.2-rc.3（applied 75 / skipped 4）
相对基线无漂移。

结论：模式全对得上，可以换包。
```

退出码契约（三处统一过，别再凭印象）：

| 码 | 什么时候 | 你要做什么 |
| --- | --- | --- |
| `0` | 没有"非可选失配"，也没有相对基线的漂移 | 可以换包 |
| `2` | 无基线：有非 optional 的 skipped（含桌面壳）；有基线：有漂移；`--strict-missing` 时 missing 也算 | **先修锚点，别换包** |
| `1` | 用法 / 环境错（`--host` 指不到 `@deepseek-ai`） | 指到 `...\resources\app`；树还在 asar 里就先解包 |

**`--host` 指错两次就会退 1**：`--host` 要 `resources\app`（不是 `resources`），`--ai` 要 `...\node_modules\@deepseek-ai`。

### 2.8 一把全跑（照这个顺序，别乱）

```bash
cd "<插件根>"
node scripts/sync-runtime.mjs                    # 0. 源/副本一致？
node scripts/assert-patches.mjs                  # 1. 表自洽？
node scripts/assert-soul-guard.mjs               # 2. 提示词层没被动？
node --test "test/*.test.mjs"                     # 3. 代码没退化？
node scripts/check-bak-judge.mjs "<宿主插件根>"    # 4. 备份判据正常？
cd "<工作区>" && node tools/check-paths.mjs        # 5. 树对不对？
node tools/check-pruner.mjs                       # 6. 剪枝哪条轨？
cd "<插件根>" && node bin/dsh-purge.js --status | head -20     # 7. 88 条什么状态？
node scripts/preflight-upgrade.mjs --host "<安装目录>/resources/app"   # 8. 相对基线有没有漂移？
```

### 2.9 什么时候不必全跑

- 只改了文档 → 只跑 `assert-patches`（它核 CHANGELOG 的条数声明）。
- 只动了 config YAML → `check-paths` + `count-injections`（人格份数）+ `tool_gate` 状态。
- 换包之后 → 全套（2.8 的 5~8 步必须有输出才能说"验过了"）。

---

## 三、状态语义：applied / pending / skipped / na / missing / excluded 是怎么判出来的

### 3.1 两级判定：先单文件，再收成一条补丁

```
patchStatus(aiBase, patches, options)               lib/core.js（导出）
├─ withoutExcluded(patches, dshHome)               被排除的 id 直接不进表（effectivePatchIds）
├─ patchAppliesHere(p, surface)                    宿主面不匹配 → "na"
└─ for 每个目标文件:
     patchFileOutcome(text, p, fp)
     ├─ filePatchSettled(text, p, fp)
     │   ├─ patchApplied(text, p)                  markers / markersAny / marker / replace 首行 60 字
     │   │   └─ markerLooksUpstream(marker, p)      带 dsh-purge 字样的 marker 才计票（1.4.0）
     │   └─ isLayoutSoftPatch(p) → !patchHasRemainingWork(...)
     ├─ 结算了 → staleActionableReplacement(...) ? "pending" : "applied"
     └─ 没结算 → patchHasRemainingWork(...) ? "pending" : "skipped"
   收成一条：pending > applied > unmatched > skipped > (na | missing_file)
```

四个判据函数的差别，一句话记住：

| 函数 | 判什么 | 谁在用 |
| --- | --- | --- |
| `patchHasRemainingWork` | "还有 pattern 能匹配"（严格：幂等残留也算） | 收终态 |
| `staleActionableReplacement` | "还有 pattern 能匹配，**且 replace 里不含这个 pattern**"（真会改内容） | 结算后回头查残留（1.1.98 修 #26 假绿的地方） |
| `filePatchSettled` | "已结算" = marker 命中，或（软补丁 且 没活可干） | 第一道门 |
| `targetLooksPatched` | "这个文件看起来被打过"（含 legacy 形态归一 + 自包含替换排除） | **备份判据、缺口判据**，不是终态 |

### 3.2 六种终态

| 终态 | 怎么判出来的 | 该紧张吗 |
| --- | --- | --- |
| `applied` | 结算了，且没有非幂等的活剩下 | 不紧张。但要抽查 `grep -c "dsh-purge" <文件>` 非 0——也有"假绿"（3.6 红线二） |
| `pending` | 没结算但原文还改得动；**或**结算了但还有残留 | 换包后正常；没换包就是异常（见 3.3） |
| `skipped` | 没结算、而且原文也改不动 | **分五种，见 3.4**。非 optional 的 skipped 是红线 |
| `unmatched` | 补丁带 `strictFiles`，原文逐字对不上 | 紧张：这条是"必须逐字匹配"的，失配意味着宿主改了这段 |
| `na` | `patchAppliesHere()` 为假（宿主面不同），或 `optional` 且一个目标都没解析到 | 不紧张，但 **na 的数量会随宿主版本变**，别把它当常量 |
| `missing_file` | 非 `optional`，且一个目标都没解析到 | 看情况：真缺文件（第三方包没装）正常；文件在却报 missing → 6.4 假漂移 |
| （`excluded`） | 不在表里——被 `exclude-patches.json` 排掉 | 不紧张，前提是四入口都遵守（1.4.0 起才真的都遵守） |

### 3.3 `pending` 是二义的

代码里两个分支都返回 `pending`，字符串一样：

- **含义一（待贴）**：`!settled` 且 `patchHasRemainingWork` → 还没打过。
- **含义二（贴过有残留）**：`settled` 且未声明 `skipIfMarked` 且 `staleActionableReplacement` → 打过了但还剩一处非幂等替换能改。

怎么区分：`grep -c "dsh-purge" <目标文件>`。0 → 含义一；非 0 → 含义二。含义二通常是补丁体自带两段重复文本，点一次应用就干净了。

**[实测]** 本机 88 条里只出现过含义一（唯一那条是 #19，被排除后连 pending 都不显示）。

### 3.4 `skipped` 的五个来源——这是最容易被误读的终态

| 来源 | 特征 | 处置 |
| --- | --- | --- |
| ① 上游自己实现了 | 原文里已经是目标形态，`applyReplacementsToText().changed === false` | 正常，别动 |
| ② optional 且目标包没装 | 配合 `na` 看 | 正常 |
| ③ **pattern 漂移、补丁彻底失效** | 非 optional，且原文里 pattern 一处都没有 | **重锚**（改 `lib/patches.js`），别换包 |
| ④ **marker 与补丁体字面不一致**（贴上了但报 skipped） | `grep` 有 `dsh-purge`，终态却 skipped | 1.4.0 用大小写宽松 + 产物在场兜底修了 4 组（#36 / #73×2 / #100）；**再出现就是新的 marker 漂移**，改 marker |
| ⑤ 二段补丁（锚点由别的补丁插入） | pristine 树上必 skipped，链上能贴 | 见 6.3，不算故障 |

判据命令（对某一条补丁）：

```bash
node -e 'import("./lib/core.js").then(c=>{
  const p=c.ALL_PATCHES.find(x=>x.id===73);
  console.log(p.name, p.file, p.marker||p.markers);
})'
```

### 3.5 `na` / `missing_file` / `unmatched` / `excluded` 的边界

- **`na` 不只是 optional**。宿主面不同也会 `na`：`patchAppliesHere` 按 `surfaces` + `detectSurface()` 判，web 面会少 5 条 desktop-only 补丁（#45 #46 #82 #83 #84）。
- **`missing_file` 的数量取决于树怎么拼**，不要当常量抄。`targetFiles(aiBase)` 在现网 rc.3 树上解析出 **57 键 / 60 路径**（**[实测]**，其中 1 个指向 `<DSH_HOME>` 里的预设）。影子镜像上曾出现 2 条、按另一种口径又记成 7 条——"`missing_file` 恒为 2 条"是错的口径。
- **`unmatched` 只对 `strictFiles` 补丁出现**（#43 这类"逐字必须匹配"的）。
- **`excluded` 不参与任何判定**，但它有副作用：备份、判定、统计都不再算它（1.4.0 前只挡了两个入口，见 4.4）。

### 3.6 三条红线（这三件事发生了才该紧张）

**红线一：非 optional 补丁报 `skipped`，而它昨天还是 `applied`。**

```bash
node scripts/preflight-upgrade.mjs --host "<安装目录>/resources/app"   # 有基线时看"漂移"那行
```

漂移非空 → 宿主改了你依赖的文本。处置：改 `lib/patches.js` 的 pattern / marker，不要换包、不要 revert。

**红线二：`applied` 但文件里找不到破甲痕迹（假绿）。**

```bash
f="<宿主插件根>/dsh-agent-instructions/lib/index.js"; grep -c "dsh-purge" "$f"
```

0 → 这条是"marker 取自上游原句"造成的假绿。1.4.0 加了 `markerLooksUpstream`（只有带 `dsh-purge` 字样的 marker 才计票）修了 #2 #3 #24 #50 那批，新出现同类就补 marker。

**红线三：`backupGap` 里 `patched` 或 `suspect` 非空。**

```bash
node scripts/check-bak-judge.mjs "<宿主插件根>"
```

`patched` = 没备份而文件已带补丁痕迹 → 原件已经找不回来了；`suspect` = bak 与现文件相同却带着痕迹 → 这份备份是假的。处置见 4.6。

---

## 四、备份与回滚

### 4.1 `.dshpurge.bak` 的建与拒建

`backupAll(aiBase)` 的顺序（每一步都有理由）：

1. 目标是用户 patch 层（`profiles/*/cordis.patch.yml`）→ **永不建 bak**（#43）。
2. bak 存在但 **0 字节** → 删掉，走重建（1.4.0 新增；0 字节是"占位建好、内容没拷完"的残骸，通常是换包 PowerShell 强杀留下的）。
3. bak 已存在（非 0 字节）→ `EEXIST` 直接跳过，**永不覆盖**。
4. bak 不存在 → 先问 `targetLooksPatched(文件内容, key)`：
   - 为真 → **拒建**，路径进 `refused`；
   - 为假 → `openSync(bak,"wx")` 独占占位，再 `atomicCopyFile` 写内容。

**为什么拒建**：如果目标已经带着补丁痕迹，拷出来的"备份"其实是打完补丁的版本。`revertAll` 会用 `sameFileBytes` 认定"文件没被动过"直接跳过 → 看着有备份，其实退不回来。宁可留一个明面上的缺口（`refused` 可以查），也不要一份假原件。

**怎么做（查这台机器建了什么、拒了什么）**：

```bash
node -e 'import("./lib/core.js").then(async c=>{
  const r=await c.backupAll("<宿主插件根>");
  console.log({made:r.made.length, refused:r.refused.length, skippedUser:r.skippedUser.length, errors:r.errors.length});
  console.log(r.refused.slice(0,5));
})'
```

### 4.2 `backupGap` 四类

`backupGap(aiBase)` 只回答"备份账目对不对"，分四类：

| 类 | 怎么判 | 含义 | 处置 |
| --- | --- | --- | --- |
| `missing` | 没有 bak | 没备份 | 看有没有 `patched` 后缀 |
| `patched` | 没有 bak，且文件有痕迹、且这条补丁对它**不是空操作**（`keyIsNoop` 为假） | **原件已经没了**，得另外找 | 从 `app.asar.bak` / 上一版安装目录 / 重解包取 |
| `suspect` | bak 在、字节与现文件相同、文件有痕迹、非空操作 | 这份"备份"是假的，回滚对它不生效 | 同上；别重复 revert |
| `noop` | bak 在、与现文件相同，但补丁对该文件本来就是空操作 | **正常**，回滚没有意义 | 不用管 |

**[实测]** 本机：`missing 0 / patched 0 / suspect 0 / noop 3`（三个 `dsh-session-reference` 文件）。

面板上对应三行（`node bin/dsh-purge.js --status` 也会打）：`备份缺口`（missing，带"（已带补丁痕迹：原件要另外找回）"后缀的是 patched）、`可疑备份`（suspect）、`空操作备份`（noop）。

**怎么做**：

```bash
node scripts/check-bak-judge.mjs "<宿主插件根>"    # 只报告，不写盘
node bin/dsh-purge.js --status | grep -A6 "备份"               # 面板同源
```

### 4.3 `revertAll` 的十个桶

`revertAll(aiBase, options)` 返回 **10 个桶**。桶名就是判据，别把相似的混着读：

| 桶 | 什么时候进这个桶 | 怎么读 |
| --- | --- | --- |
| `reverted` | bak 盖回去了 | 正常回滚 |
| `skipped` | bak == 现文件且文件无痕迹；或 `preserveClientBundles` 时被保留的前端 `client.js` | 本来就不该动 |
| `noop` | bak == 现文件、有痕迹，但补丁对该文件是空操作 | **正常**，不是故障 |
| `unrevertable` | bak == 现文件、有痕迹、补丁确实改过它 | **故障**：这份备份是假的，回滚不掉 |
| `noBackup` | 没有 bak，文件还在（且带着补丁） | 有补丁没原件；`revertAll` 不删文件（代码注释里的 #41 那条规矩） |
| `preservedUser` | 用户 patch 层：只丢 bak，绝不覆盖回去（#43） | 正常 |
| `staleBak` | 调用方点名跳过的 bak（`options.skipPaths`），值来自 `refreshStaleBaksForUpgrade` | **1.4.0 新增**。这些 bak 是旧版宿主的内容，盖回去等于降级 |
| `emptyBak` | bak 在但 `size <= 0` 或 `bakLooksTruncated` | **1.4.0 新增**。全表唯一"拿坏数据盖宿主文件"的地方，现在一律跳过 |
| `dropped` | 清掉的过期用户层 bak | 正常 |
| `errors` | 拷贝 / 删除抛错 | 逐条看，通常是文件被占用 |

**怎么做（回滚一次并读桶）**：

```bash
node -e 'import("./lib/core.js").then(async c=>{
  const r=await c.revertAll("<宿主插件根>", {preserveClientBundles:true});
  for (const k of ["reverted","skipped","noop","unrevertable","noBackup","preservedUser","staleBak","emptyBak","dropped","errors"])
    console.log(k.padEnd(14), (r[k]||[]).length);
})'
```

读法：`unrevertable > 0` 停止操作（先找回原件）；`emptyBak > 0` 说明有过一次强杀，先重跑 `backupAll` 再谈回滚；`errors > 0` 先确认宿主进程退干净。

### 4.4 "排除了还在"这条链是怎么形成的

四步，每一步单独看都合理，连起来是"宿主里留着一条补丁，而所有界面都说没事"：

1. 某条补丁**先被打上**（比如 #19，或换包后自愈重打）。
2. 之后写进 `<DSH_HOME>/dsh-purge/exclude-patches.json`。
3. apply 侧不再重打（`withoutExcluded` 过滤），状态侧**把它整条从 `patch_status` 里删掉** → 面板不显示 pending，`ensureHostClean` 的 pending 闸也不挡它的路。
4. 如果那条补丁当初是备份**拒建**过的（`refused`），它既没有 bak、`backupAll` 也不会重建 → `revertAll` 只能进 `noBackup` → "有补丁、没备份、退不掉"。

第 3 步在 1.4.0 之前的真实后果：`gatherState` 遍历全表但 `patch_status[19] === undefined` → 总数 88、`ready+applied+pending` 只有 87 → **面板自己跟自己差 1**（幽灵行），而 `display_patches` 又把 #19 丢掉 → 同一页两个数字互相矛盾。

**1.4.0 修了什么**：

| 缺口 | 修法 | 判据 |
| --- | --- | --- |
| exclude 只挡 2 个入口 | `effectivePatchIds()` 收口：`applyPatchesAllHosts` / `patchStatus` / `patchWatchedClientBundlesSync` / `hookDenyPaths` + `annotateHookDenyStatus` + `gatherState` 分母 | 预检打 `合计 87 + 排除 1 = 88 ✓`；面板不再有幽灵行 |
| 0 字节 bak 会盖宿主 | `revertAll` 新增 `emptyBak` / `bakLooksTruncated`；`backupAll` 把 0 字节当不存在并重建 | 回滚输出里 `emptyBak 0` |
| "刷 bak 再 revert"是死代码 | `refreshStaleBaksForUpgrade` 只识别不写盘，改为把路径集传给 `revertAll({skipPaths})`，落进 `staleBak` | 回滚输出里 `staleBak` 有值 = 防线生效了 |
| 假绿 marker | `markerLooksUpstream`：带 `dsh-purge` 字样的 marker 才计票 | #2 #3 #24 #50 不再"原件判 applied" |

### 4.5 备份已经坏了怎么救

按代价从小到大：

1. **同目录下的 `<文件>.dshpurge.bak` 还能用** → 直接 `revertAll`。
2. **整棵树的原件** → `<安装目录>\resources\app.asar.bak`（破甲改名时留的），改名回 `app.asar` 即整树复原。
3. **解封时挪走的那份** → `app.asar.dshpurge-away`（更早的手工命名，破甲不认这个名字，但对人有用）。
4. **上一版安装目录** → 官方 feed 只留最新版，旧版下不回来，所以**换包前必须留一份整目录**。
5. **重解包 asar** → `node bin/asar-unpack.mjs <asar 文件> <输出目录>`；7-Zip 的 asar codec 也能解成目录。

`unrevertable` 与 `patched` 都要走 2~5，**不要重复 revert**：第二次只会把假原件再盖一遍。

---

## 五、配置层：profile 的坑

配置面在 `<DSH_HOME>/profiles/<profile>/cordis.patch.yml`。它不受宿主升级覆盖，但**它自己会骗人**：覆盖块的语义是整体替换。

### 5.1 覆盖块是"整体替换 config"（会丢插件）

官方原文（`@deepseek-ai/dsh-agent-preset` 的 `dsh-doc/references/compositions.md`）：

> Override the declaration by its Loader row id instead of inserting. The override replaces the complete `config`, so restate `id`, `plugins` and every other field the shipped file carries.

也就是说：profile 里写一个 `- id: preset-ptc`，它不是"改一行"，是"整个 preset 换成我这份"。

**已经咬过一次**：`preset-ptc` 那一档的覆盖块里**没有** `tool-executor-ptc`（只在 `preset-minimal` 段有），`preset-standard` 也没有——但出厂 `ptc.patch.yml` 有。后果：

- **ptc 档没有 `run_code`**：整张工具表回到每轮数万字符的固定开销（"有压力的走 ptc"这一档实际失去收口架构）。
- ptc / standard 两档都少了 `tool-office`。

**怎么做（一分钟核完）**：

```bash
# 出厂有、profile 覆盖后没有 → 这就是丢的插件
grep -n -A200 "id: preset-ptc" "<DSH_HOME>/profiles/desktop/cordis.patch.yml" | grep -c "tool-executor-ptc"
grep -n "tool-executor-ptc\|tool-office" "<DSH_HOME>/profiles/desktop/cordis.patch.yml"
```

修法：在 ptc 段的 `tool-web` 之后补 `- id: tool-executor-ptc` / `name: '@deepseek-ai/dsh-tool-executor-ptc'`，ptc 与 standard 两段补 `tool-office`。改完重启宿主，再用 `tool_gate({action:"status"})` 与"ptc 档能不能跑 run_code"两条验证。

顺带一句：**#26 / #43 对 minimal / ptc / standard 三档在运行时是死代码**——它们改的是出厂 `presets/*.patch.yml`，而运行时读的是 profile 覆盖块。只有 `preset-cordis` 和 `preset-sdk-minimal` 真正吃这两条。所以"改补丁表让这三档变样"是不成立的，得改配置。

### 5.2 `agent-instructions` 双实例与 `maxBytes`

现状（四个位置，只有一个生效）：

| 位置 | 值 | 状态 |
| --- | --- | --- |
| `preset-minimal` / `preset-ptc` / `preset-standard` 各一行 | `maxBytes: 65536` | 生效（每会话一个实例） |
| 顶层全局行 | `disabled: true`，`maxBytes: 98304` | 关闭，但注释还在教人"补齐同一个 maxBytes" |

两个坑：

1. **注释在骗人**：它要求"三处预设行和全局行写同一个 maxBytes，去重判据才认得对方"，而两边从来没一致过（65536 vs 98304）。照注释把全局行 `disabled` 翻成 `false`，立刻复活双实例。
2. **#105 的去重按内容相等**（`sameContextPayload`），不认"同一个插件、不同 maxBytes"。人格总量到 65536 附近时，两个实例产出的 payload 不同 → 去重全程失效 → 上下文里两份人格。

**[实测]** 人格体积：`<DSH_HOME>/AGENTS.md` 54,622 B + 工作区 `AGENTS.md` 4,046 B = **58,668 B**，距 65,536 只剩约 6.8 KB。到线就是上面第 2 条。

**怎么做**：

```bash
# 1) 份数判据（必须 = 1）
node "<工作区>/专项任务/破甲/bin/count-injections.mjs" 5

# 2) 体积余量
wc -c "<DSH_HOME>/AGENTS.md" "<工作区>/AGENTS.md"

# 3) 确认全局行还是 disabled: true
grep -n -B2 -A12 "id: agent-instructions" "<DSH_HOME>/profiles/desktop/cordis.patch.yml" | tail -30
```

处置二选一（别两个都做）：**删掉全局行那段注释并保留"已禁用"的结论**，或**把三处预设行统一成同一个值并改注释为"四处必须同值"**。当前选择是前者。

### 5.3 pruner 双轨与 `exclude-patches.json`

- 三处预设各有一份 `tool-result-pruner`，`thresholdChars: 32768`（温和档）。
- 顶层全局行也开着（`disabled: false`）但**不写 config** → 继承 `dsh-base` 的 `8192`。
- 只要 #19 被 apply，`pruneContent()` 变成 `return null` → **所有阈值（含 32768）一起变死配置**。

所以这两件事必须同时成立才叫"温和剪枝"：

```json
// <DSH_HOME>/dsh-purge/exclude-patches.json
{ "excludePatches": [19] }
```

+ 四处阈值 32768。

清单写坏（不是合法 JSON、字段不是数组）按"没排除"处理——宁可多贴，不因为一个坏文件少贴别的补丁。

**怎么做（换回温和档的完整四步）**：

```bash
# 1) 排掉 #19
printf '{"excludePatches":[19]}' > "<DSH_HOME>/dsh-purge/exclude-patches.json"

# 2) 从原件还原被禁用的实现
cp "<宿主插件根>/dsh-compaction-tool-result-pruner/lib/index.js.dshpurge.bak" \
   "<宿主插件根>/dsh-compaction-tool-result-pruner/lib/index.js"

# 3) 重启宿主（实现是运行期加载的）

# 4) 验
node tools/check-pruner.mjs      # 期望：代码层"原始实现在线" + 4 处 32768
```

### 5.4 `tool_gate` 的 `parked` 组

`dsh-tool-gate` 的 `parked` 决定"哪些整包工具从工具表里摘掉"，是每轮固定开销的开关。

- 插件自带默认 `parked: [browser, wincu, ig5]`。
- profile 顶层有一行 `- id: plugin-tool-gate`，把 `parked` 换成 `[taskboard, draw, rare, delegation]` → **覆盖生效，没有第二个实例**。
- 匹配规则：`name` 以 `*` 结尾走前缀匹配，否则**精确相等**。
- 已知错配：profile 里 `browser: ['browser_*']` 覆盖掉默认的 `'dsh_browser_*'`。现在 `parked` 不含 browser 所以没现症，将来 `park browser` 会静默空转。

**怎么做**：

```bash
# 看当前到底摘了哪几组（在宿主会话里调工具，不是在 shell 里）
#   tool_gate({ action: "status" })   → 期望：收起中：taskboard, draw, rare, delegation

# 静态核对配置
grep -n -A18 "id: plugin-tool-gate" "<DSH_HOME>/profiles/desktop/cordis.patch.yml" | grep -A8 "parked"
```

修法：把 `browser: ['browser_*']` 改成 `'dsh_browser_*'`，或删掉那行让默认值生效。

### 5.5 改配置的固定动作

1. **先备份**：`cp cordis.patch.yml cordis.patch.yml.<日期>.bak`。
2. **只改一处**，改完立刻跑 `check-paths`（它会查 profile 覆盖层）。
3. **重启宿主**才生效（配置在装配期读）。
4. **验三条**：人格份数 1、`tool_gate` 组对、目标档位的关键工具在。
5. YAML 缩进错会让宿主**起不来或整档失效**（#43 那类历史坑就是把它打成非法 YAML）。改完先用解析器过一遍：


```bash
python -c "import sys,yaml; yaml.compose(open(sys.argv[1],encoding='utf-8')); print('ok', sys.argv[1])" \
  "<DSH_HOME>/profiles/desktop/cordis.patch.yml"
```

> 为什么用 `yaml.compose` 而不是 `yaml.safe_load`：预设文件里有 `!!js` 标签（JS 函数值），PyYAML 造不出来会直接 ConstructorError；`compose` 只解析结构、不构造对象，缩进错才红。

---

## 六、宿主升级（最重要的一节）

> 判据：这一节读完，能独立完成一次 rc.N → rc.N+1 的升级，并且知道什么时候该停。

### 6.0 八步总顺序

```
1. 留回滚资产      （6.7：app.asar.bak / 上一版整目录 / ~/.dsh 冷备）
2. 插件先升到最新   （旧插件不认识新宿主代码；先升插件再升宿主）
3. 解包候选树       （别动正在跑的安装）
4. 预检候选树       （6.1，退出码 0 才继续；候选树上"必然 pending/skipped"的别当故障）
5. 停宿主，换包     （6.5，走破甲自己的换包逻辑；别自己写脚本）
6. 重打补丁         （面板"应用"或 applyPatchesAllHosts）
7. 跑判据           （2.8 的 5~8 步）
8. 验收 30 分钟     （6.8）
```

**第 2 步为什么在前面**：破甲是"改宿主文件"的插件，它对新宿主的认识在锚点里。旧插件的锚点在新宿主上打不中 → 你以为升级成功了，实际一条没贴上。

### 6.1 预检输出怎么读

六个桶（`bucketPatches`）：`applied / pending / skipped / na / missing / excluded`。**摘要行会当场对账**：五桶之和 + excluded 必须等于 88，不等就是分桶算错了，按 bug 处理。

| 桶 | 含义 | 要不要管 |
| --- | --- | --- |
| `applied` | 已贴上，或上游自带目标形态 | — |
| `pending` | 模式对得上，装的时候会打上 | **新解包树必然一堆，这是正常的** |
| `skipped · optional` | 可选补丁，这棵树没装对应包 | 不用管 |
| `skipped · 非 optional` | 锚点失效 | **要重锚**（或确认是二段补丁，6.3） |
| `na` | 宿主面 / 文件不存在 | 不用管 |
| `missing` | 目标文件不在树里（第三方预设缺席等） | 默认只提示；`--strict-missing` 才进退出码 |
| `excluded` | 被 `exclude-patches.json` 排掉 | 正常，别再去找"缺的文件" |

**退出码只有三种，别自己发明**：0 可以换包；2 先修锚点；1 用法错。

**[实测] 健康树上退 0 的样子**（`skipped 3` 全是 optional：#56 #77 #88 这类）：

```
补丁 88 条：applied 75 / pending 0 / skipped 3（可选 3、要重锚 0） / na 9 / missing 0 / excluded 1  ——  合计 87 + 排除 1 = 88 ✓
```

**换包前最后一次预检必须在"当前安装树"上跑**，因为只有它有基线对照（6.2）。候选树上跑的那次只是提前看锚点。

### 6.2 基线：唯一能区分"本来就这样"和"新版弄坏了"的东西

一台装好的机器上**本来就有几条 skipped**（本机常态 3~4 条）。所以"预检有 skipped"根本不是信号，**差分才是**。

```bash
# 第一次（在已知良好树上，通常就是当前安装树）：只写文件，别指望它打印计数
node scripts/preflight-upgrade.mjs --host "<安装目录>/resources/app" --save-baseline
# → 写入 scripts/preflight-baseline.json，然后直接退 0

# 之后每次：对候选树跑，这时才看得见差分
node scripts/preflight-upgrade.mjs --host "<候选树>/resources/app"
```

有基线时报告多两行：

```
基线: @deepseek-ai/dsh-desktop-runtime@0.2.2-rc.3（applied 75 / skipped 4）
相对基线无漂移。
```

漂移了就是：

```
⚠ 相对基线漂移（基线里贴得上、这棵树贴不上）: #70 #91
```

规矩：

- **换包前重新存一次基线**（用旧宿主、补丁全贴满的树），否则基线永远是上一版。
- 基线文件进版本库（`scripts/preflight-baseline.json`），它是"这台机器曾经健康"的唯一记录。
- `--save-baseline` 那一趟**只写文件**，不打印计数也不打印差分——别把它当验证跑。

### 6.3 二段补丁：预检已经替你判了

有些补丁的锚点**是别的补丁插进去的**，新解包树上孤立地看必然贴不上，装的时候按顺序贴就能上。1.4.0 的预检内置了这件事（`chainDryRun` + `applyChainStatus`）：先在内存里按 `ALL_PATCHES` 顺序贴一遍，再把"孤立判定贴不上、链上能贴"的改判成 `pending`，并单列一段：

```
链上可贴（锚点由前序补丁插入，孤立判定必然贴不上；装的时候会按顺序打上）:
  #46 ← #45  OFFICIAL_DESKTOP_UPDATE_HANDOFF
  #84 ← #83  DESKTOP_CHILD_CLOSE_SIGNAL
  #91 ← #83  …
  #101 ← #87 HUNG_PROMPT_AFTER_PERSONA
```

已知的四条：**#46 ← #45、#84/#91 ← #83、#101 ← #87**。

**判据**：出现在这段里的 id **不进"要重锚"，也不进退出码**——1.4.0 之前它们会混进"⚠模式对不上"，rc.5 那次 13 条假清单里有 4 条就是这么来的。反过来说：如果你确信某条是二段（比如 #84），它却出现在"⚠ 模式对不上、要重锚"里，那不是它的问题，是**它的前置补丁这次也没贴上**——去查前置那条。

`--json` 里有机器可读的对应字段：`chain`（逐条的 `applied/chained/deps/verdict`）与 `chainRescued`。

**手工复核**（预检用不上时，比如只有两棵树想自己比一遍）：在内存里按顺序贴，不落盘。

```bash
cd "<插件根>"
node --input-type=module -e '
const c = await import("./lib/core.js");
const fsp = await import("node:fs/promises");
const ai = "<候选树>/dsh/node_modules/@deepseek-ai";
const files = c.targetFiles(ai);
const mem = new Map();
const read = async (f) => { if (!mem.has(f)) mem.set(f, await fsp.readFile(f, "utf8")); return mem.get(f); };
const applied = [], stuck = [];
for (const p of c.withoutExcluded(c.ALL_PATCHES)) {
  let changed = false;
  for (const { path: f } of c.targetFilePairs(files)) {
    let t; try { t = await read(f); } catch { continue; }
    const r = c.applyReplacementsToText(t, p, f);
    if (r.changed) { mem.set(f, r.text); changed = true; }
  }
  (changed ? applied : stuck).push(p.id);
}
console.log("链上能贴:", applied.length, "链上仍贴不上:", stuck);
'
```

这条路和装的时候同序（`applyPatches` 就是 `for (const p of patches)` 顺序遍历，不排序），所以结论可信；`reapply.js` 走按文件分组的 `patchesByFileKey()`，同文件内的链更紧，不会更松。

**[实测]** 在**已贴满的现网树**上跑，会得到「链上能贴 3 / 链上仍贴不上 85」——那不是失配，是幂等（贴过了，再贴不改内容）。所以这条只在**候选（未贴）树**上有意义；在现网树上跑完发现"全都贴不上"属于预期，别据此去改补丁表。

### 6.4 假漂移：profile 专属目标与"异树"

两个方向都会骗你，1.4.0 对第一个已经做了处理。

**方向一：目标文件在 profile 里，候选树里没有它。**

`#71`（liangshen 预设）、`#4` 的 rep0（agent-preset）、`#76`（preset-unrestricted）这三个的贴点在 `<DSH_HOME>/profiles/...` 或 `.agent-presets/` 里，**换包根本不动它们**。预检把它们记 `missing` 并单列：

```
目标文件不在这棵树里（通常是 profile 插件，换包后由 profile 提供）: …
profile 提供（贴点在 profile 里、候选树里没有这些文件，换包不动它，不算坏）:
```

这一段里的 id **不计漂移、不进退出码**（`applyChainStatus` 把它们塞进 `profileProvided`，`computeDrift` 与 `exitVerdict` 都扣掉）。

底层机制（知道它能省一次误判）：`allowTargetPathForAiBase(fp, aiBase)` 在"aiBase 不在桌面安装内"时，把 `zone === "desktop-profile"` 的文件整体剔除，键压根不登记 → 报 `missing_file`。真机上 aiBase 在安装内，不会发生；只有预检这种"异树"视角才会看到。

**怎么做**：先看有没有"profile 提供"那段；有 → 这几条不用管。仍想人肉确认：

```bash
# 文件真的在 profile 里？
ls "<DSH_HOME>/profiles/desktop/node_modules/@linxin666/dsh-liangshen/presets/liangshen/agent.cordis.yml"
# 它在候选树里有没有同名副本（没有就属于 profile 提供）
node -e 'import("./lib/core.js").then(c=>console.log(c.targetFiles("<候选树>/dsh/node_modules/@deepseek-ai")["preset-liangshen-pkg"]))'
```

**方向二：`desktop-shell` 在纯 node 里恒 `na`。**

`officialShellMain()` 要求 `detectSurface()==="desktop"`，子进程里不成立。预检为此单独读候选树的 `lib\main.js` 自己判，输出里单开一段：

```
桌面壳（独立核查 <安装目录>\resources\app\lib\main.js）：applied 6 / 待贴 0 / 模式不匹配 0
```

**这一段非空才有壳层结论**；只读摘要里那 9 条 `na` 会以为壳补丁全废了。

### 6.5 换包顺序（以及那段 PowerShell 到底干什么）

**别自己写换包脚本。** 破甲自己有，`ASAR_SWAP_PS1` 就是它。两套抢活就是 2026-11-16 那场事故。

脚本干的事，按顺序：

1. `Stop-HarnessInstall`：只按**本次安装根路径**枚举 `Win32_Process` 杀进程（不用 `/IM` 全名杀，避免误伤同名第三方）。
2. 再等 500ms、再杀一次、再等 300ms（Electron main 与 host 一起杀，让 UI 来不及画"host stopped"对话框）。
3. 10 秒兜底循环：`WaitPid` 和同安装根的进程都不在了才往下走。
4. 若 `app.asar.unpacked` 在而关键 `.node` 不在 → `robocopy` 补回 `app` 目录。
5. `Move-Item app.asar → app.asar.bak`，失败重试 80 次（每 400ms；第 20/50 次时再杀一轮）。**写 `.rename-pending` 锁标记**，中途断了下次能认出来。
6. 重启宿主。

所以人工的"换包顺序"只有三句话：

```bash
# 1) 宿主必须"正常退出"（不是硬杀）——运行时改名必然 EBUSY，硬杀也不行
# 2) 让破甲的换包逻辑动手：面板里的"解封 / 换包"，或等它自愈
# 3) 换完第一件事不是看功能，是看树
node tools/check-paths.mjs        # 第一行必须说"宿主读的是解包目录"
```

手工兜底（自动化失败时）：

```bash
tasklist | grep -i "DeepSeek"      # 必须为空
mv "<安装目录>/resources/app.asar" "<安装目录>/resources/app.asar.bak"
# 重启宿主 → 它回落到 resources\app
```

### 6.6 窗口期弹窗为什么根除不了

现象：升级完第一次退出宿主，弹一次 `… quit unexpectedly`。

原因（代码事实）：抑制这个对话框的是 #83 / #84，它们把补丁写进**解包后的 `lib/main.js`**。而换包那一刻 Electron 读的还是**官方 `app.asar`**——补丁根本没在这次启动里生效。

能做的只有"少弹一次"：`gracefulExit` 的超时从 1500ms 放宽到 5000ms（冷启动常超 1.5 秒，host 先退会让 main.js 的 ChildProcess listener 先触发）。

根除要改换包流程本身（先解包打补丁再启动，或者换成一个自己控制启动的壳），风险和收益不成比例，**明确不做**。所以：

- 升级窗口期弹一次 = **已知，不算回归**。
- 非升级时刻也弹 = 真回归，去查 #83/#84 的终态和 `lib/main.js` 里的 `dsh-purge` 痕迹。

### 6.7 回滚资产清单（换包前必须留）

| 资产 | 位置 / 名字 | 谁认它 |
| --- | --- | --- |
| asar 原件 | `<安装目录>\resources\app.asar.bak` | **破甲认这个名字**；`.manual-swap-*` 之类它看不见 |
| 解封挪走的那份 | `app.asar.dshpurge-away` | 只有人认，救急用 |
| 上一版整个安装目录 | 自己拷一份 | 官方 feed 只留最新版，旧版下不回来 |
| `~/.dsh` 冷备 | 整个目录 | 人格、配置、会话、凭据全在里面 |
| 预检基线 | `scripts/preflight-baseline.json` | 换包后判断"漂移"的唯一依据 |
| 提示词基线 | `soul-guard.lock` | 判断注入层有没有被换包顺手改掉 |
| 解包态整棵树 | `<安装目录>\resources\app` | 单文件坏了不用回滚整树 |

### 6.8 升级后 30 分钟验收清单

```bash
# 1) 树对不对
node tools/check-paths.mjs                       # 9 ✓，末行"全部验过"
# 2) 逐条状态
node bin/dsh-purge.js --status | sed -n '/补丁 /,$p'         # pending 应为 0；非 optional skipped 见 3.6 红线一
# 3) 备份账目
node scripts/check-bak-judge.mjs "<宿主插件根>"   # patched/suspect 应为 0
# 4) 破甲自己写的两个宿主侧文件在不在（rc.5 树里没有，必须回写）
ls "<安装目录>/resources/app/dsh/lib/dsh-purge-child-process-hide.mjs" \
   "<安装目录>/resources/app/dsh/lib/dsh-purge-hide-console.js"
# 5) 人格份数
node "<工作区>/专项任务/破甲/bin/count-injections.mjs" 5    # 必须 = 1
# 6) 剪枝
node tools/check-pruner.mjs
# 7) 预设仍是合法 YAML（四个都过一遍）
python -c "import sys,yaml; yaml.compose(open(sys.argv[1],encoding='utf-8')); print('ok', sys.argv[1])" \
  "<安装目录>/resources/app/dsh/node_modules/@deepseek-ai/dsh-web-app/presets/minimal.patch.yml"
# 8) 相对基线无漂移
node scripts/preflight-upgrade.mjs --host "<安装目录>/resources/app"
```

功能面只验四个，别铺开：**ptc 档能跑 `run_code`**（5.1）、**新会话说一句话人格 1 份**（5.2）、**设置页能开**（client bundle 补丁）、**退出不弹窗**（6.6 的例外）。

### 6.9 rc.5 特有的四个坑（下次升级照单核对）

1. **#62 审批 fail-open 失去落点**：rc.5 把"没有审批服务"的默认行为从 allow 改成 fail-closed。破甲的 failopen 在两处都贴不上 → 装上去可能"工具直接被拒"。这是唯一会**静默改变权限行为**的一条，必须实测"工具被放行 / 被拒"两条路。另注：该目标文件在 rc.3 与 rc.5 **逐字节相同**，所以这条 fail-open 是既有行为，不是 rc.5 引入的。
2. **#80 minimal 预设**：旧锚点指向破甲自己写过的中间态（从未存在），1.4.0 已整块重写为锚官方 `minimal.patch.yml` 的 tool-fs 块 + `dsh-sdk-minimal` 对应块。"minimal 该不该有 fs/web 权限"是产品决定，不是适配决定。
3. **#56 / #77 rewind 前端**：两版 `client.js` 字节完全相同（压缩构建），四个锚点全不存在 → 这套 UI 改动**从未在现网生效**。#56 是重锚还是作废，先确认 rc.5 是否还有"前端过滤 rewind"这套机制。
4. **死条清理**：#88 已标 `optional`、#46 只保留 rep0 的有效说明。留着死条，预检永远吐假 skipped，以后每次升级都要重判一遍。

---

## 七、排障手册（10 条）

### 7.1 速查表

| # | 现象 | 一句话判据 | 处置 |
| --- | --- | --- | --- |
| 1 | 补丁全落空，面板却绿 | `check-paths` 第一行说读 `app.asar` | 解封，见 6.5 |
| 2 | 备份 0 字节 | `emptyBak` 有值 / `wc -c` 为 0 | 删 bak 重跑 `backupAll`，见 4.1 |
| 3 | 面板幽灵行（总数 88、明细 87） | `patch_status[id] === undefined` | 1.4.0 已修；旧副本升级，见 4.4 |
| 4 | 人格注入 2 份 | `count-injections` 返回 2 | 关掉全局 `agent-instructions` 行，见 5.2 |
| 5 | pruner 自检红 | `check-pruner` 说"禁用态" | exclude #19 + 还原实现，见 5.3 |
| 6 | 升级后弹一次窗 | 只在那一次换包后出现 | 已知，见 6.6；非换包时弹才算回归 |
| 7 | EXE 被拒 / `EBUSY` / `EPERM` | `tasklist` 里还有宿主 | 等正常退出再动，见 7.2 |
| 8 | `install-offline` 被护栏拦住 | 提示"探测到现网安装" | 加 `--desktop-install` 或 `--allow-live`，见 7.2 |
| 9 | 测试裸跑 156 例、11 红 | 红全在 `test/test/` 下 | 带 glob；那份副本已删，见 2.6 |
| 10 | 预检退 2 | 看"要重锚"计数与漂移行 | 修锚点，不换包，见 6.1 |

### 7.2 逐条：现象 / 判据 / 处置

**①　补丁全落空，面板还显示已打**

- 判据：`node tools/check-paths.mjs` 第一行；或看进程命令行有没有 `--app-path=...\app.asar`。
- 病因：宿主从 `app.asar`（只读档案）读代码，`resources\app` 里的改动没人用。
- 处置：正常退出宿主 → `app.asar` 改名 `app.asar.bak` → 重启 → 重跑 `check-paths` 第一条变绿 → 重打补丁。
- 变体：`app.asar` 在 rc.3 安装包里**可能是目录**，命令行带 `--app-path`，于是 `existsSync` 全是 false。这条也是"影子树不能叫 `*.asar`"的原因。

**②　备份 0 字节**

- 判据：`wc -c <目标>.dshpurge.bak` 为 0（或回滚输出里 `emptyBak` 非空）。
- 病因：`openSync(bak,"wx")` 占位后进程被 `TerminateProcess` 打死（换包 PowerShell 的常态），`atomicCopyFile` 的清理逻辑不会执行。
- 处置：删掉 0 字节 bak，重跑 `backupAll`（1.4.0 起它会自己当它不存在并重建）；**别直接 revert**（会拿 0 字节盖宿主）。

**③　面板幽灵行：总数 88、明细 87**

- 判据：面板出现一条状态为空的行，或 `patches_total` 与 `ready+applied+pending` 差 1。
- 病因：`exclude-patches.json` 排掉了某条（本机 #19），但 `patchStatus` 不给它状态、`gatherState` 仍按全表算分母。
- 处置：1.4.0 起四个入口统一走 `effectivePatchIds()`。运行副本还是旧的就同步：`node scripts/sync-runtime.mjs --apply`，重启；预期预检出现 `合计 87 + 排除 1 = 88 ✓`。

**④　人格注入 2 份**

- 判据：`count-injections.mjs 5` 里某个 turn 有 2 份**内容不同**的 agent-instructions。
- 病因：`agent-instructions` 出现双实例（顶层全局行被打开），或两个实例 `maxBytes` 不同导致内容不同，#105 的 `sameContextPayload` 认不出是同一份。
- 处置：确认全局行 `disabled: true`；三处预设行保留 65536；人格总量离 65536 只剩 6.8 KB，先看是不是该瘦身。

**⑤　pruner 自检红**

- 判据：`node tools/check-pruner.mjs` 说"代码层: 禁用态"或阈值显示"死配置"。
- 病因：#19 被 apply 过（`pruneContent()` 直接 `return null`）。
- 处置：写 `exclude-patches.json` 排 19 → 从 `.dshpurge.bak` 还原 `lib/index.js` → 重启 → 重跑 check-pruner。**别**走"从 bak 还原 + 手改预设"那条老路：下次 apply 会把 #19 贴回去。

**⑥　升级后弹一次崩溃窗**

- 判据：只在那一次换包后第一次退出时出现，之后不再。
- 病因：换包那刻 Electron 读官方 `app.asar`，#83/#84 没生效。
- 处置：不用处置。要是非换包时刻也弹 → 查 `lib/main.js` 里 `dsh-purge` 痕迹和 #83/#84 终态。

**⑦　EXE 被拒 / `EPERM` / `EBUSY`**

- 判据：`tasklist | grep -i "DeepSeek"` 还有进程；或报错里带 `rename ... .tmp`。
- 病因：宿主握着文件句柄。写盘层对占用做退避重试（`renameSyncWithRetry`，20/60/150ms），仍失败就抛"宿主进程可能正占用该文件，退出 DeepSeek Harness 后重试"——**看到这句话就是没退干净**，不是补丁坏了。
- 处置：正常退出宿主（不是硬杀），确认 `tasklist` 空，重跑。杀软锁文件同理，必要时加排除目录。

**⑧　`install-offline` 被护栏拦住**

- 判据：输出里有"探测到现网安装 / 拒绝"，或 `desktopInstallGuard` 的 reason 不是 `allow-live` / `live-home`。
- 病因：1.4.0 加的护栏——不带 `--desktop-install` 时它会探测到**现网安装目录**并准备往那里装。
- 处置：装在别处加 `--desktop-install <沙箱安装目录>`；确实要认领现网才加 `--allow-live`。**装在沙箱里必须连 `DSH_HOME` 一起隔离**，否则影子会写现网数据。

**⑨　测试裸跑 156 例、11 红**

- 判据：红全部落在 `test/test/` 下；`node --test "test/*.test.mjs"` 却全绿。
- 病因：那里曾有一份 11-06 的旧断言副本（不在版本库里，所以 CI 绿、本机红）。1.4.0 已删除。
- 处置：带 glob 跑；若 `test/test/` 又出现（有人从备份恢复），直接移走，别去修那 11 个"失败"。
- 变体：`node --test` 报 `Cannot find module ...\test` → 也是这个原因，这版 Node 不认目录参数。

**⑩　预检退 2**

- 判据：摘要行 `skipped（… 要重锚 N）` 且 N > 0；或（有基线时）`⚠ 相对基线漂移: #…`。
- 处置：加 `--json` 看桶，逐条判：
  - 二段补丁（#46/#84/#91/#101）→ 不是故障，见 6.3；
  - `desktop-profile` 区的 missing（#71 / #4 / #76）→ 异树假漂移，见 6.4；
  - 真失配 → 改 `lib/patches.js` 的 pattern / marker，重跑预检到 0，再换包。
- **绝对不要**"先换包再说"：贴不上的补丁会在新宿主上留下半截行为，比不贴更难查。

---

## 八、改动纪律

### 8.1 改补丁表（`lib/patches.js`）

改完必跑的六条，少一条都不算改完：

```bash
cd "<插件根>"
node scripts/assert-patches.mjs        # 1. 条数 / id / name / file / CHANGELOG 对账
node scripts/assert-soul-guard.mjs     # 2. 动到 16 条关键补丁会在这里红（见下）
node --test "test/*.test.mjs"          # 3. 194 例
node scripts/sync-runtime.mjs --apply  # 4. 同步运行副本
node scripts/preflight-upgrade.mjs --host "<安装目录>/resources/app"   # 5. 现网树：必须仍 0 漂移
node scripts/preflight-upgrade.mjs --host "<候选树>/resources/app"     # 6. 目标版本树：看新锚点命中
```

`assert-soul-guard` 会拦 16 条（#1 #2 #3 #4 #25 #26 #32 #40 #43 #55 #66 #71 #73 #76 #87 #101）的 `id / name / file / rel / markers / replacements`。确实要改：`--update` + CHANGELOG 写理由，`soul-guard.lock` 一起提交。

表结构两条硬规矩：

- 新补丁用 `replacements: [{pattern, replace}]` + `markers`；legacy 形态（`patterns` / `replace` / `marker`）只剩 7 条（#5 #6 #7 #8 #10 #15 #16），别再新增。
- **删条目会跟上游分叉**。要"永久不贴某条"用 `exclude-patches.json`，不是删表（删了 `assert-patches` 的 `changelog=88` 也会红）。

### 8.2 改 `lib/core.js`

判据函数（`patchFileOutcome` / `filePatchSettled` / `patchApplied` / `targetLooksPatched` / `staleActionableReplacement`）不在 soul-guard 的指纹里，所以它们**只能靠测试和预检保护**。

```bash
node --test "test/*.test.mjs"                                        # 1. 全量
# 2. 真树上贴一遍（不落盘）：见 6.3 的链式干跑
node scripts/preflight-upgrade.mjs --host "<安装目录>/resources/app"   # 3. 现网树仍 0 漂移 = 判据没被改坏
node scripts/check-bak-judge.mjs "<宿主插件根>"                        # 4. 备份判据没被改坏
```

改判据时要守的三条不变量（每条都对应一个历史事故）：

1. **备份永远是原件**：任何"刷新 bak"的路径默认不许写盘，要写必须显式 `{apply:true}`，且调用方要知道自己传了。
2. **回滚永远不拿坏数据盖宿主**：`copyFile` 是这张表里唯一不可逆的一步，前面必须有 size / 截断校验。
3. **`skipped` 不许吞掉"贴过"**：marker 与补丁体字面不一致要能被发现（1.4.0 的宽松匹配 + 产物在场兜底就是为此）。

### 8.3 同步运行副本

宿主加载的是 `<DSH_HOME>/profiles/<profile>/node_modules/dsh-purge`，可以是指向源码的 Junction，也可以是实体副本。

```bash
node scripts/sync-runtime.mjs            # 只检查：源 / 副本 / 版本
node scripts/sync-runtime.mjs --apply    # 真同步（实体副本模式）
node bin/dsh-purge.js --sync                         # 等价入口
```

**[实测] 通过时**：

```
dsh-purge 运行副本同步 / runtime sync
  源码 / source  <插件根>  (1.4.0)
  desktop  副本  <DSH_HOME>/profiles/desktop/node_modules/dsh-purge
               版本 1.4.0  已同步

  全部同步。
```

三种姿势的区别（选错了会很迷惑）：

| 姿势 | 改源码后 | 适用 |
| --- | --- | --- |
| Junction | 立刻生效（同一份文件） | 开发 |
| 实体副本 | **必须 `--sync`**，否则宿主跑旧代码 | 发布 |
| 拷进 `node_modules` 调试 | `--sync` 语义不成立 | 只用于一次性调试 |

判据：`check-paths` 的"源与副本一致"那几行 + `sync-runtime` 的"已同步"。改完**要重启宿主**才加载。

### 8.4 版本号与 CHANGELOG

版本号有五处，改一处就会有人对不上：

| 位置 | 例子 | 判据命令 |
| --- | --- | --- |
| `package.json` → `version` | `1.4.0` | `node -p "require('./package.json').version"` |
| `package.json` → `dsh.version` | `1.4.0` | `node -p "require('./package.json').dsh.version"` |
| `package.json` → `dshTarget` | `0.2.2-rc.3`（**宿主**版本，不是插件版本） | `node -p "require('./package.json').dshTarget"` |
| `CHANGELOG.md` 最新小节标题 | `## 1.4.0 · 2026-11-16 · …` | `grep -n "^## " CHANGELOG.md`（取第一条） |
| `release-notes.md` 首行 | `# 1.4.0` | `head -1 release-notes.md` |

外加两处"会过期"的数字：`docs/zh/README.md` 的「一眼版本」和 `docs/zh/05-known-limits.md` 的「截至 x.y.z」。

一条命令全对账：

```bash
node -e 'const p=require("./package.json");
console.log("pkg",p.version,"| dsh",p.dsh.version,"| target",p.dshTarget)'
grep -n "补丁表[　 ]*[0-9]*[　 ]*条" CHANGELOG.md | head -2
node scripts/assert-patches.mjs     # 补丁条数声明对不上会直接红
```

规矩：**`dshTarget` 只在"这版补丁真在目标宿主上验过"之后才改**。改了它，预检的"破甲基准 ✓ 一致 / ⚠ 不一致"那行才跟着变；不改它就一直是"⚠ 不一致，模式可能要重锚"——那是提示，不是失败（1.4.0 仍然写 rc.3，因为 rc.5 没装机实跑过）。

### 8.5 提交前 checklist

```
[ ] assert-patches 绿
[ ] assert-soul-guard 绿（或已 --update 且 CHANGELOG 写了理由）
[ ] node --test "test/*.test.mjs" 194 绿
[ ] sync-runtime 已同步
[ ] 现网树预检 0 漂移
[ ] 补丁表改了 → CHANGELOG 的"补丁表 N 条"那句话没被改坏
[ ] 版本号五处一致
[ ] 动了注入正文/关键补丁 → soul-guard.lock 一起提交
```

---

## 附 A · 术语

| 词 | 意思 |
| --- | --- |
| 树 / aiBase | 一个 `@deepseek-ai` 目录。宿主可能同时有安装树和 `dsh\node_modules` 镜像树 |
| 解封 | 把 `app.asar` 挪开，让宿主读 `resources\app` 目录 |
| 二段补丁 | 锚点由另一条补丁插入的补丁，pristine 树上必然 skipped |
| 假绿 | 状态说 applied，文件里没有痕迹 |
| 假漂移 | 预检说 missing / skipped，真机上其实正常（异树 / 分区守卫造成） |
| 幽灵行 | 被 exclude 的补丁在面板上以"待贴 / 缺文件"出现，或分母对不上 |
| 单腿绿 | 多目标补丁里一个目标打上、另一个根本没解析到，整条仍报 applied |

## 附 B · 一页打印版

```
树   → node tools/check-paths.mjs            第一行必须是"解包目录"
态   → node bin/dsh-purge.js --status                    pending 应为 0
账   → node scripts/check-bak-judge.mjs      patched / suspect 必须 0
表   → node scripts/assert-patches.mjs       88 条 + changelog=88
魂   → node scripts/assert-soul-guard.mjs    digest 不变
码   → node --test "test/*.test.mjs"         194 绿
预   → node scripts/preflight-upgrade.mjs    退出码 0 + 无漂移
剪   → node tools/check-pruner.mjs           原始实现在线 + 4×32768
人   → count-injections.mjs 5                份数 = 1

换包：留资产 → 先升插件 → 解包候选 → 预检 0 → 停宿主 → 破甲换包 → 重打 → 2.8 全跑
回滚：revertAll 十桶；unrevertable / emptyBak / patched 三类停止操作，先找回原件
```
