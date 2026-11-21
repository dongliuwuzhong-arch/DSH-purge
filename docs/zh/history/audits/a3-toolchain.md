# 审计 A3 · 工具链健壮性（rc.3 之后）

> 审计对象：`%WORKSPACE%\tools\check-paths.mjs`、`check-persona-context.mjs`、
> 桌面 `DSH升级rc3\` 下 4 个 .ps1 + 4 个 .bat。
> 判定口径：凡「在 rc.3 下会失效或误判」的硬编码路径 / 隐含假设，都算缺陷；每处改动都给修前、修后的真实输出。
> 原件备份：`%WORKSPACE%\专项任务\破甲\_sim\orig\`（6 个文件，未改宿主任何东西）

---

## 0. 先说结论

找到 **9 处**会在 rc.3 下失效或误判的假设，全部已修并逐条验证。其中 3 处是**已经造成过实际误报**的，不是假想风险：

| # | 缺陷 | 性质 |
|---|---|---|
| A | check-paths 的 L3 版本「按目录顺序取第一个命中」 | **已误报过**：`必读-先看我.txt` 里留着的「底座 rc.1」就是它报的 |
| B | step3-check.ps1 的 node 候选顺序把旧 runtime 排第一 | 潜伏；本机两份 node 恰好同为 v24.21.0 才没炸 |
| C | 拿不到 `--app-path` 时整段判 unknown | **已误报过**：那时自检报「3 项没验成」 |
| D | 会话文件名假设（只认 `.jsonl`） | 潜伏；现名 `session.v4.jsonl.zstd` 靠巧合过关 |

其余 5 处：编码、超时、插件缺失误判为红、脚本失败报错不可读、提示里的 bat 名不存在。

---

## 1. 环境事实（全部实测，不是推断）

| 事实 | 值 | 怎么知道的 |
|---|---|---|
| 可用 node（安装目录） | `%INSTALL_DIR%\resources\runtime\primary-runtime\dependencies\node\bin\node.exe` = **v24.21.0** | 直接跑 `-v` |
| 另一份 node（`~/.dsh`） | `%USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe` = **v24.21.0** | 直接跑 `-v` |
| runtime.json（安装目录） | `desktopVersion = 0.2.2-rc.3` | 读文件 |
| runtime.json（`~/.dsh`） | `desktopVersion = 0.2.2-rc.1`，`payloadDigest` 与上面**完全相同**（0881fbf610a9…），node/python 字段也相同 | 读文件对比 |
| 会话根 | `%USERPROFILE%\.dsh\sessions`，4 个工作区 / **214 个会话文件** | 遍历 |
| 会话文件名 | **全部** `session.v4.jsonl.zstd`（214/214） | 扩展名统计 |
| `USERPROFILE` | **本会话环境里为空**（`process.env.USERPROFILE === undefined`）；`[Environment]::GetFolderPath('UserProfile')` 能正确回退到 `%USERPROFILE%` | 实测 |
| 宿主进程命令行 | 主进程只有 `"%INSTALL_DIR%\DeepSeek Harness.exe"`，`--app-path` **只出现在子进程上** | Get-CimInstance 实测 |
| app.asar 现状 | 已挪走，在 `app.asar.dshpurge-away` | 文件存在性 |

> 最后一行很关键：**自检能不能拿到 `--app-path`，取决于子进程有没有起来**。第 3 步自检又恰恰常在 DSH 没开的窗口里跑。

---

## 2. 改动清单

### 2.1 `%WORKSPACE%\tools\check-paths.mjs`（311 → 418 行）

| 行 | 改了什么 | 为什么 |
|---|---|---|
| 31 | `const DSH = process.env.DSH_HOME \|\| join(HOME,".dsh")` | 宿主支持 `DSH_HOME` 覆盖家目录，原来写死 `~/.dsh`，环境一变整套路径全错 |
| 37 | 新增 `INSTALL_ROOT = "C:\\Software\\DSH"` | 只作**最后**兜底锚点，不是主判据 |
| 40-45 | 新增 `argOf()`，支持 `--app-path` | 命令行抓不到时可以人工指定；也让"抓不到"这条分支能复现 |
| 52-59 | 新增 `psOut()`，所有 PowerShell 调用走它 | 前置 `[Console]::OutputEncoding=UTF8`。原来 PS 5.1 按 936 输出、脚本按 utf8 解，**安装路径一旦带中文 `--app-path` 正则就永远失配** |
| 63-121 | 段落 1 整体重写：三段兜底（人工参数 → 进程命令行 → 外壳 exe 路径 → 安装锚点）+「文件结构」第二判据 | 原来只认命令行，DSH 没开就全崩 |
| 111 | `hostMode` 统一出口（`asar` / `app`） | 段落 3 原来自己又算一遍 `readAsar`，两处口径会分叉 |
| 148-153 | 插件缺失改三级判定：两边都不在 = 跳过；只缺一边 = 红 | 原来「没装」也算「不对」，凭空多一条红 |
| 285-292 | `.py` 探针的 python 改成候选表（`~/.dsh`、安装目录、PATH） | 原来直接 `"python"`，PATH 里没有就 ENOENT |
| 303-308 | 探针超时单独识别为「没验成」 | 原来超时和报错混在一条 unknown 里 |
| 364-390 | L3 改成「两份都读 → 优先取与 L2 一致的 → 其次取版本最高 → 把另一份打出来」 | 见下面 A 项，这是**已误报过**的那处 |

### 2.2 `%WORKSPACE%\tools\check-persona-context.mjs`（226 → 269 行）

| 行 | 改了什么 | 为什么 |
|---|---|---|
| 71-76 | 新增 node 版本守卫（缺 `zlib.zstdDecompressSync` 就直接说明并 exit 2） | 会话是 zstd，要 node ≥ 22。旧 node 上会抛 TypeError，长得跟「人格不在」一模一样 |
| 42-45 | 新增 `RE_SESSION` / `RE_ZSTD` / `isSessionFile()`：认 `.jsonl`、`.jsonl.zstd`、`.zstd`、`.zst` | 原来只写 `/\.jsonl/`，靠名字里恰好还留着 `.jsonl` 才没出事 |
| 48-67 | 新增 `sessionRoot()`：默认路径不在时自动认最新的 `sessions*` 目录并打印 | 宿主改会话根名时不至于直接「没有找到任何会话」 |
| 127/129/133/187 | 三处过滤统一改用 `isSessionFile` | 同上 |
| 178-182 | 锚点为 0 时退化为只看体积 | `AGENTS.md` 太短取不到锚点时，原来会反过来判「人格不在」——那是探针自己的取样失败 |
| 215-216 | 锚点行打印「没取到锚点，只按体积判」 | 让人看得出判据降级了 |

### 2.3 `桌面\DSH升级rc3\step3-check.ps1`（55 → 104 行）

| 行 | 改了什么 | 为什么 |
|---|---|---|
| 9-13 | USERPROFILE 四级兜底：环境变量 → `HOMEDRIVE`+`HOMEPATH` → `GetFolderPath` → 写死用户名 | 本会话实测 `USERPROFILE` 就是空的 |
| 19-25 | node 候选顺序：**安装目录 → `~/.dsh` → PATH** | 原来是 `~/.dsh` 优先，而那份正是 rc.1 的旧 runtime |
| 36-42 | 打印实际选中的 node 与 `-v` | 选错了要看得见 |
| 62-64 | `WorkingDirectory` 不存在时退回脚本所在目录 | 原来写死 `%WORKSPACE%`，目录没了 `Process::Start` 直接抛未捕获异常 |
| 74-84 | 异步读 stdout/stderr + `WaitForExit(300000)` 真超时 | 原来 `ReadToEnd()` 会阻塞到进程退出，后面那句 `WaitForExit()` 是摆设，等于没超时 |
| 97 | 提示里的 bat 名改成真实存在的「第2步b-解封并重开DSH.bat」 | 原来写的「解封DSH-双击我.bat」**这个文件不存在** |
| 91-93 | `exit code 2`（没验成）和 `1`（红）分开提示 | 原来一律「判据有红项」 |

### 2.4 `桌面\DSH升级rc3\restore.ps1`（23 → 82 行）

| 行 | 改了什么 | 为什么 |
|---|---|---|
| 9-15 | `备份` 目录不存在 / 不是目录 → 可读中文报错 | 原来 `Get-ChildItem` 直接抛原始异常（英文 + 调用栈），双击的人看不出要干什么 |
| 20-22 | 挑备份用 `^app(-\|$)` 正则，并提示 `package.json` 缺失 | `app*` 连 `application` 这类名字都会匹配 |
| 34-37 | 进程检查改成数组计数 | 原来 `if (Get-Process ...)` 在多进程时语义含糊 |
| 47-53 | 改名目标撞名时自动加序号 | 同一分钟内跑两次会覆盖或报错 |
| 64-76 | 改名 / 复制分别 try-catch，失败给「原目录还在 X，没丢东西」 | 原来失败就是一条未处理的 .NET 异常 |
| 78-80 | 还原后提示 `app.asar` 还在解封态、插件副本没还原 | 原来还原完人以为全回去了 |

### 2.5 `桌面\DSH升级rc3\step1-backup.ps1`（25 → 59 行）

| 行 | 改了什么 | 为什么 |
|---|---|---|
| 14 | `app` 目录里没有 `package.json` 时警告 | 指错目录会静默备一堆没用的东西 |
| 19-23 | 备份目录撞名时加序号 | 原来 `Copy-Item -Force` 会**合并**进已有目录，留下半新半旧 |
| 28-36 | 复制失败给可读原因（空间不够 / 被占用）+ 半成品位置 | 原来抛原始异常 |
| 44-52 | 插件副本复制失败降级为黄色警告，不中断 | 备 app 才是主目的 |

### 2.6 `桌面\DSH升级rc3\step2b-unseal.ps1`（77 → 134 行）

| 行 | 改了什么 | 为什么 |
|---|---|---|
| 39-52 | 开头先验外壳 exe 和 `resources` 目录存在 | 原来要等改名**成功之后** `Start-Process` 才炸——白解封一趟 |
| 31-36 | `Start-Process` 失败时说明「解封本身已成功，手动双击 DSH 也一样」 | 原来失败后只报「DSH 没起来」 |
| 56 | `Add-Content` 写日志失败不再中断 | 日志目录只读时整趟白跑 |

### 2.7 `.bat`（4 个，全部纯 ASCII，未改内容）

原样保留，**逐个验证过 0 个非 ASCII 字节、无 BOM**：

```
万一坏了-还原.bat           188 字节  非ASCII=0  BOM=false
第1步-先备份.bat            167 字节  非ASCII=0  BOM=false
第2步b-解封并重开DSH.bat    210 字节  非ASCII=0  BOM=false
第3步-装完自检.bat          174 字节  非ASCII=0  BOM=false
```

> 任务说「三个 .bat」，实际是 **四个**。四个都合规。文件名本身是中文、目录也在中文路径下，
> 靠每份首行的 `chcp 65001` + `%~dp0` 撑住——实测正常（见 3.5）。

---

## 3. 逐项修前 / 修后验证

### 3.1 【A】L3 版本「按顺序取第一个」→ 假红

**根因**：本机有两份 `runtime.json`，一份 rc.3、一份 rc.1，旧代码按目录顺序取第一个。

**证据（顺序反过来跑，代表任何「`~/.dsh` 优先」的读法）**：

```
[!] 三层版本错位：外壳 0.2.2-rc.3 / 主程序 0.2.2-rc.3 / 底座 0.2.2-rc.1
有 1 处对不上：三层版本错位          ← exit=1
```

这不是假想：`必读-先看我.txt` 里留着的原文就是
> 「3. 三层版本错位：外壳/主程序 rc.3、底座 rc.1」

也就是说**旧 check-paths 在升级当时确实报过这一条**（那时 `resources\runtime` 还没展开，只能 fallback 到 `~/.dsh` 那份）。现在安装目录那份齐了，才碰巧绿的。

**修后**：

```
[·] 本机有 2 份 runtime.json，采用 0.2.2-rc.3；另一份 0.2.2-rc.1 在 %USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\runtime.json
[✓] 三层版本一致：0.2.2-rc.3（外壳 / 主程序 / 底座）
```

判定不再押在目录顺序上，而且**把两份都摆出来**——rc.1 那份还在不在，一眼看得见。
（补充事实：两份的 `payloadDigest`、node、python 字段完全相同，所以「底座错位」实际是 **runtime.json 的版本标签陈旧**，二进制是同一套。旧代码报红是保守正确的，但会让人以为要重装 runtime。）

### 3.2 【C】拿不到 `--app-path` → 一次自检 3 项没验成

**修前**（模拟 DSH 没开：命令行查询返回空）：

```
[?] 拿不到 --app-path，无法判定宿主读哪份
[?] 没有 resources 目录，跳过本体检查
[?] 三层版本只拿到 1/3：L1=? L2=? L3=0.2.2-rc.1
验过的都对，但有 3 项没法判定：app-path、resources、三层版本     ← exit=2
```

**修后**（同样的条件）：

```
[✓] 宿主读的是解包目录：%INSTALL_DIR%\resources\app（文件补丁能生效，依据：安装锚点）
[✓] 宿主读解包目录，三处落点都有破甲痕迹（预设 / persona / main.js）
[✓] 三层版本一致：0.2.2-rc.3（外壳 / 主程序 / 底座）
全部验过，都对得上。                                              ← exit=0
```

另外两条分支也测了：

```
--app-path 显式指定   → [✓] ...（依据：人工 --app-path）                    exit=0
--app-path 指向 asar  → [!] 宿主读的是 asar: ... / 有 1 处对不上：宿主读asar   exit=1
```

> 注意：判成 asar 是**保守方向**——asar 还在就默认宿主会读它，宁可报红也不给假绿。

### 3.3 【D】会话文件名假设

用真实会话复制出两份样本（`_sim\sessions\wsA\sidA\session.v4.jsonl.zstd` 与 `wsB\sidB\session.v5.zstd`）：

| 场景 | 修前 | 修后 |
|---|---|---|
| 全部会话都叫现名 | exit 0，1/1 通过 | exit 0，2/2 通过 |
| 会话改名成 `session.v5.zstd`（单独作根） | **exit 2「没有找到任何会话」** | exit 0，1/1 通过 |
| 部分改名（混在同一个根下） | exit 0，**静默只报 1/1，改名那个被整个忽略** | exit 0，2/2 |

第三种最危险：不报错、不报警告，只是少看了一个会话。修前实测：

```
[对照1] 原件  exit=0  结论: 1/1 个会话人格在上下文里，全部正常
[对照1] 改后  exit=0  结论: 2/2 个会话人格在上下文里，全部正常
```

### 3.4 【B】step3-check.ps1 的 node 顺序

**修前**：候选表第一项是 `$home2\.dsh\dsh-runtimes\...\node.exe`，实测这个文件**存在** → 旧版必然选它，也就是选了 rc.1 那套 runtime 里的 node。

**修后**：

```
node：%INSTALL_DIR%\resources\runtime\primary-runtime\dependencies\node\bin\node.exe
  v24.21.0
```

> 诚实说明：两份 node **当前都是 v24.21.0**，所以旧顺序**现在没有造成实际故障**，属于潜伏风险。
> 风险来源是「`~/.dsh` 那份 runtime 整体是 rc.1 的」，选了它等于把自检押在一套已经过期的运行时上。

### 3.5 编码

三层各自独立验证：

1. **4 个 .bat**：纯 ASCII、无 BOM（见 2.7 表）。
2. **4 个 .ps1**：全部 UTF-8 **带 BOM**。无 BOM 时 PS 5.1 按 ANSI 读中文，会在解析阶段就报 `Unexpected token '}'`——上次踩的就是这个。
3. **PowerShell 输出**：每个 .ps1 首部都有 `[Console]::OutputEncoding = UTF8`；check-paths 调 PS 时也前置了同一句。
4. **端到端**：把第 3 步 bat 完整跑一遍（`cmd /c 第3步-装完自检.bat`，中文目录 + 中文文件名 + `%~dp0`），中文输出完全正常：

```
[SELF CHECK] starting...
========== DSH 升级后的自检 ==========
外壳版本：0.2.2-rc.3
解包目录里的版本：0.2.2-rc.3
宿主读的是解包目录 —— 补丁能生效
...
```

> 顺带一个观察，不是缺陷：本会话的 shell 通道传中文命令行会被破坏（我第一次跑
> `node "%WORKSPACE%\tools\check-paths.mjs"` 就直接 ParserError，路径被吞成乱码）。
> 所以下面所有验证都是用参数数组 spawn，不经过 shell 拼字符串。**手工跑这两个 .mjs 时，
> 要么走 .bat，要么先 `chcp 65001`。**

### 3.6 失败分支的可读报错（实测）

```
[V1] restore.ps1，备份目录不存在   exit=1
     找不到备份目录：C:\...\_sim\v1-nobak\备份
     要么先跑一次「第1步-先备份.bat」，要么把旧的 备份 文件夹整个放回本目录。

[V2] step2b-unseal.ps1，已经解封过   exit=0
     app.asar 存在=False   away 存在=True
     已经解封过了，不用再跑。直接双击「第3步-装完自检.bat」。

[V3] step2b-unseal.ps1，外壳 exe 不在   exit=1
     找不到外壳：%INSTALL_DIR%\NOPE-nope.exe
     找不到 DSH 本体：%INSTALL_DIR%\NOPE-nope.exe
     DSH 是不是装到别的地方了？如果是，把本脚本里的 $exe 改掉再跑。
```

三份都是改后实测；V1 在改前是未处理的 .NET 异常加英文调用栈。

### 3.7 语法与格式复核

```
OK   restore.ps1
OK   step1-backup.ps1
OK   step2b-unseal.ps1
OK   step3-check.ps1
```

（`[System.Management.Automation.PSParser]::Tokenize` 零错误）

---

## 4. 最终 check-paths 结论

`node %WORKSPACE%\tools\check-paths.mjs`（exit **0**）：

```
[✓] 宿主读的是解包目录：%INSTALL_DIR%\resources\app（文件补丁能生效，依据：进程命令行 --app-path）
[✓] dsh-purge 源与副本一致（123353 字节，入口 lib\index.js）
[✓] dsh-soul 源与副本一致（42052 字节，入口 index.js）
[✓] dsh-frame 源与副本一致（11078 字节，入口 lib\index.js）
[✓] dsh-tool-gate 源与副本一致（10177 字节，入口 lib\index.js）
[✓] 宿主读解包目录，三处落点都有破甲痕迹（预设 / persona / main.js）
[✓] profile 覆盖层：minimal 已带 agent-instructions
[·] selectedDefault = minimal
[✓] 人格探针：1/1 个会话人格在上下文里，全部正常
[·] 本机有 2 份 runtime.json，采用 0.2.2-rc.3；另一份 0.2.2-rc.1 在 %USERPROFILE%\.dsh\dsh-runtimes\dsh-primary-runtime\runtime.json
[✓] 三层版本一致：0.2.2-rc.3（外壳 / 主程序 / 底座）

全部验过，都对得上。
```

结论行：**「全部验过，都对得上。」exit 0**

---

## 5. 看到但没改的（记录，不擅自扩大范围）

1. **`必读-先看我.txt` 自相矛盾**：开头说「已经全绿，不用再点解封」，后面又留着「现在还红着的三项」。
   它不在允许改的范围内（只允许 .ps1/.bat/.mjs），只读记录。建议谁维护这份说明时删掉那三行。
2. **`step1-backup.ps1` 没有实跑**：它要复制 737MB / 两万多个文件，跑一次会真的往桌面备份目录写一大坨。
   只做了语法解析 + 失败分支的静态审阅。**「能完整备份成功」这一条：未验证。**
3. **没有验证「DSH 真关掉时」的完整链路**：禁止重启 DSH，所以 `--app-path` 抓不到的场景是用
   「把 PowerShell 查询置空」模拟的，不是真的关进程。逻辑等价，但不是原件现场。
4. **`~/.dsh\dsh-runtimes\dsh-primary-runtime` 那份 rc.1 的 runtime 还在原地**：按约束「不动宿主文件」，
   没有删也没有改名。它的 `payloadDigest` 与 rc.3 那份相同，可能是同一套 payload 的旧标签。
   要不要清，是另一个决定，不是这次审计能做的。
5. **`check-persona-context.mjs` 没有伞形超时**：它单会话 160ms、5 个会话 `--all` 也是这个量级，
   暂不需要。但会话再大几个数量级时，唯一的上限来自 check-paths 的 180s 和 step3 的 300s。

---

## 6. 回滚

任何一处要退回去：

```
copy "%WORKSPACE%\专项任务\破甲\_sim\orig\check-paths.mjs"          "%WORKSPACE%\tools\"
copy "%WORKSPACE%\专项任务\破甲\_sim\orig\check-persona-context.mjs" "%WORKSPACE%\tools\"
copy "%WORKSPACE%\专项任务\破甲\_sim\orig\*.ps1" "%DESKTOP%\DSH升级rc3\"
```
