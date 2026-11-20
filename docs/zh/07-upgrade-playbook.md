# 07 · 宿主升级：破甲这边怎么跟

> 面向"官方发新版本了，我要不要现在升"这一刻。**升级前先跑预检，别先换包。**
> 2026-11-16 那场 rc.1 → rc.3 的事故就出在"没预检、自己写换包脚本、两套逻辑抢活"。

## 一、升级前：一条命令看清会怎样

```bash
# 把新版本的 resources\app 解包到任意目录（别动正在跑的安装）
node scripts/preflight-upgrade.mjs --host "<解包出来的 resources\app>"
```

它只读，按六个桶分（`scripts/preflight-upgrade.mjs:145`）；`skipped` 里再按 `optional` 分成两种读法：

| 桶 | 含义 | 要不要管 |
| --- | --- | --- |
| applied | 已贴上（或新版本自带了标记） | — |
| pending（待贴） | 模式对得上，装的时候会打上 | 不用管，刚解包就该是这样 |
| skipped · optional | 可选补丁，这棵树没装对应的包 | 不用管 |
| **skipped · 非 optional** | **官方改了这段，补丁贴不上去** | **要重锚** |
| na | 这棵树里不适用（宿主面 / 文件不存在） | 不用管 |
| missing | 目标文件根本不在这棵树里（第三方预设包缺席等） | 默认只提示；要它参与判定加 `--strict-missing` |
| excluded（已排除） | 被 `exclude-patches.json` 排掉了 | 正常 |

退出码：

| 码 | 什么时候 |
| --- | --- |
| `0` | 没有"非可选 + 模式不匹配"、也没有相对基线的漂移（没加 `--strict-missing` 时 `missing` 不算） |
| `2` | 有非可选补丁失配；`--strict-missing` 把 `missing` 也算进来；有基线时只算**相对基线**的漂移 |
| `1` | 用法 / 环境错误（`--host` / `--ai` 指不到 `@deepseek-ai`） |

**没有基线也能退 0**：一台装好的机器上现在有 4 条跳过（#56 #77 #80 #88），它们都是 `optional`，不计入失配。
反过来说，看到 `2` 就是真有非可选补丁贴不上——这时才需要重锚。

### 差分才是真信号

已知良好树上本来就有几条跳过。要分清"本来就跳"和"新版本弄坏了"，得先存基线，**分两次跑**：

```bash
# 第一次：在当前那棵已贴满的树上存基线（只写文件，不打印计数和差分）
node scripts/preflight-upgrade.mjs --host "<当前安装的 resources\app>" --save-baseline
# → 已记录基线 → <仓库>/scripts/preflight-baseline.json

# 第二次：对候选版本跑，这时才看得见差分
node scripts/preflight-upgrade.mjs --host "<新版本解包出来的 resources\app>"
```

第二次会多出基线那几行；没漂移时是这样：

```text
基线: dsh-desktop-runtime@0.2.2-rc.3（applied 74 / skipped 4）
相对基线无漂移。
```

一旦新版本弄坏了东西，就变成：

```text
⚠ 相对基线漂移（基线里贴得上、这棵树贴不上）: #70 #91
```

**只有漂移那行非空才是真要动手。** 绝对数字会骗人：一台机器上 4 条跳过是常态。
`--save-baseline` 那一趟只写 `scripts/preflight-baseline.json` 然后立刻 `return 0`（`preflight-upgrade.mjs:181-191`），
不打印计数也不打印差分；上面那两行只在"已有基线 + 本次没传 `--save-baseline`"时出现。

### 一棵已打满的树上跑一遍长什么样（真实输出）

```text
预检目标: <安装目录>\resources\app\dsh\node_modules\@deepseek-ai
宿主版本: @deepseek-ai/dsh-desktop@0.2.2-rc.3  /  @deepseek-ai/dsh-desktop-runtime@0.2.2-rc.3
破甲基准: 0.2.2-rc.3  ✓ 一致

补丁 88 条：applied 74 / 待贴 0 / 可选跳过 4 / ⚠模式不匹配 0 / na 9 / 已排除 1

桌面壳（独立核查 <安装目录>\resources\app\lib\main.js）：applied 6 / 待贴 0 / 模式不匹配 0

这棵树里不适用（文件不存在）：#76 #28 #30 #31 #47 #49 #57 #64 #65

基线: @deepseek-ai/dsh-desktop-runtime@0.2.2-rc.3（applied 75 / skipped 4）
相对基线无漂移。

结论：模式全对得上，可以换包。
```

### 排除清单的副作用

被 `exclude-patches.json` 排掉的 id 不进 `patchStatus`。预检自己读同一份清单、单独归进 `excluded` 桶
（`preflight-upgrade.mjs:143-150`），所以它不冒充 `missing`、也不参与退出码。
旧版脚本和旧面板没有这段逻辑，会把被排掉的 id 显示成"缺文件"或"待贴"——那是**预期**，别去追一个不存在的原件。

### 桌面壳单独核

`desktop-shell` 那几个补丁在纯 node 里永远报 `na`（`officialShellMain()` 要求
`detectSurface()==="desktop"`，子进程里不成立）。预检改成直接读候选树的
`lib\main.js` / `main.js` 自己判，输出里单独一段：

```
桌面壳（独立核查 …\lib\main.js）：applied 6 / 待贴 0 / 模式不匹配 0
```

## 二、换包顺序（踩过的坑，照做就行）

1. **别自己写换包脚本。** 破甲自己有换包逻辑；两套抢活就是 2026-11-16 那场事故。
2. 主机正常退出后再动文件（`EBUSY` 都是没退干净）。
3. 换完先跑 `node tools/check-paths.mjs`（不在本仓库：工作区 `tools\` 下的运维脚本），**第一条是"宿主读的是哪棵树"**：
   读 `resources\app` 才对，读 `app.asar` 说明补丁全在空转。
4. 再跑 `patchStatus`（面板或 `--status`）。"缺文件"不等于没贴上，
   `targetFiles(aiBase)` 只覆盖 57 个键（实测），壳和 hooks 那几类解析不到；判断以文件里的 markers 为准。
   另外：被 `exclude-patches.json` 排掉的补丁在旧面板里会显示成缺文件，那是预期（见上一节）。
5. 人格验证：让一个新会话说句话，确认注入了 1 份、没被截断
   （`node 专项任务\破甲\bin\count-injections.mjs 5`——不在本仓库：工作区脚本，参数是"最近场数"）。

## 三、回滚资产（换包前留好）

| 东西 | 说明 |
| --- | --- |
| `app.asar.bak` | 破甲认这个名字；`.manual-swap-*` 这类它看不见 |
| 上一版整个安装目录 | 官方 feed 只留最新版，旧版下不回来 |
| `~/.dsh` 冷备 | 人格、配置、会话都在里面 |

## 四、已知的"升级窗口期"问题

升级那一刻 Electron 读的是**官方 `app.asar`**，所以 #83/#84（抑制 host 退出弹崩溃窗）根本没生效，
弹窗会出现在这次切换里。1.3.6 把 `gracefulExit` 从 1500ms 放宽到 5000ms，能少弹，不能根除——
根除要改换包流程本身（先解包打补丁再启动），风险和收益不成比例，暂不做。
