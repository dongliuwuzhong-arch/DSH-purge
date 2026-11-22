# deep-dive 05 · web 面

> 破甲自 dsh-purge 1.1.71 分出后独立维护：宿主定版在 0.2.2-rc.5，补丁表、判据与文档只服务这一棵树，不再跟随任何外部发行节奏。；**原仓库已不可访问，本仓库即唯一来源**（fork 点 1.1.71，MIT）；**原仓库已不可访问，本仓库即唯一来源**（fork 点 1.1.71，MIT）
读者：在 CLI 里跑出一条「插件根未找到 / plugin root not found。桌面端：用 --surface desktop 或设 DSH_SURFACE=desktop（DSH_BASE 只在非桌面场景有用）」的人，或者要在 web 宿主上装这个插件的人。

这一册只回答一件事：**这套插件有两个宿主面（web / desktop），两面的目标树、键表、命令行为都不一样，混着看会得出相反的结论。**

补丁表怎么组织在 [01-补丁表](01-补丁表.md)，判据怎么算在 [02-判据与状态机](02-判据与状态机.md)，逐条清单在 [04-补丁清单](04-补丁清单.md)。

---

## 一、面是怎么判出来的

判定只有一个入口：`lib/surface.js` 的 `detectSurface()`。顺序写死，**先命中先返回**：

| 序 | 判据 | 结果 |
| --- | --- | --- |
| 1 | 环境变量 `DSH_SURFACE` 是四个合法值之一（`web` / `desktop` / `gui` / `tui`） | 用它，不再往下判 |
| 2 | 进程身份像桌面端：exe 名（`DeepSeek Harness.exe` 等）、安装路径带 `/deepseek harness/resources`、argv 里出现桌面路径、`resources` 下有 `app.asar` 或 `app/dsh` | `desktop` |
| 3 | 都不命中 | `web` |

`gui` / `tui` 能识别，但适配仍然回退 web（`adapterFor()`）。

于是同一台机器上会出现这样的分裂：

| 谁在跑 | 判出来是 | 为什么 |
| --- | --- | --- |
| 桌面版宿主进程（`%INSTALL_DIR%`） | `desktop` | 进程身份命中第 2 条 |
| 面板 / 设置页 / 宿主会话里的 `purge_status`、`purge_apply` | `desktop` | 它们跑在宿主进程里，面是现成的 |
| shell 里的 `node bin/dsh-purge.js --status` | `desktop` | **CLI 自己先定了一次档**，见下 |
| shell 里的 `node scripts/preflight-upgrade.mjs` | `web` | 它不自己定档，纯 node 走第 3 条 |

**CLI 这一层是自己补的。** `bin/dsh-purge.js` 在进主逻辑之前先按 **`--surface <web|desktop>` > `DSH_SURFACE` > 安装锚点**（`DSH_DESKTOP_INSTALL`，或 `<DSH_HOME>/dsh-purge/desktop-install.txt` 里记的那个目录）定档，再把结果写回 `DSH_SURFACE`：

```
宿主 / surface desktop（判据 / via: 安装锚点 / install anchor）
安装锚点       %INSTALL_DIR%
```

所以「面板说 applied 71、CLI 说插件根未找到」这件事**在本机已经不该再出现**；还出现的只有两种：锚点丢了（没有 `desktop-install.txt`），或者你跑的是**不带这段定档的脚本**——`preflight-upgrade.mjs` 和任何自己写的 `node --input-type=module -e` 探针都属于后者。

---

## 二、两面差在哪：先看键表

`targetFiles(aiBase, dshHome)` 是唯一把「键」翻成「路径」的地方，它按面出不同的表：

| 面 | 键数 | 路径数（去重） | 只在这一面出现的键 |
| --- | --- | --- | --- |
| `desktop` | 61 | 64（去重 63） | `liangshen-minimal-prompt` + `pi-ai-completions` / `pi-ai-responses-shared` / `pi-ai-anthropic-messages` |
| `web` | 57 | 60（去重 59） | 无（web 是 desktop 的子集） |

少掉的 4 个键落在两类路径上：

- **`@earendil-works/pi-ai` 下那三个文件**：它不在 `@deepseek-ai` 里，web 面的探测只认 `@deepseek-ai` 形态的插件根，所以解析不到；
- **profile 里的 `@linxin666/dsh-liangshen` 那份 `minimal-prompt.mjs`**：第三方插件提供的目标，只有桌面面才注册这个键（#28 用它）。

**后果一眼就能看见**：把 `aiBase` 显式喂进去、面仍是 web（自己写探针时最常见）得到的是

```
applied 68 / na 8        ← web 面
```

而同一棵树在 desktop 面是 `applied 71 / na 4 / missing_file 1`。差的 8 条 `na` 是：

| id | 为什么在 web 面 na |
| --- | --- |
| #47 #49 #57 | 目标在 `@earendil-works/pi-ai` 下，web 面解析不到键 |
| #45 #82 #83 #84 #91 | `file` 是 `desktop-shell`，web 面根本没有这个键 |

⚠ 上面那张表里 #83 在 desktop 面是 `missing_file`（它没声明 `optional`），另外四条是 `na`（声明了）。**五条桌面壳补丁在 `patchStatusDetail()` 里一条都不是 applied** —— 原因是纯 node 进程里没有 `process.resourcesPath`，`desktop-shell` 这个键解析不到 `resources/app/lib/main.js`。预检另跑一遍 `resolveShellMain()`、从 `--host` 反推壳路径，所以它那一段才敢打「桌面壳：applied 5」。**这是两段管线，不是两套真相。**

---

## 三、三个坑：谁会自己定档，谁不会

### 会自己定档：`bin/dsh-purge.js`（`--status` / `--apply` / `--revert` / `--sync`）

顺序是 **`--surface <web|desktop>` > `DSH_SURFACE` > 安装锚点 > 回落 web**，定完把结果写回 `DSH_SURFACE`，因此 `gatherState` 里所有探测看到同一个值。本机裸跑：

```bash
node bin/dsh-purge.js --status
# 宿主 / surface desktop（判据 / via: 安装锚点 / install anchor）
# 安装锚点       %INSTALL_DIR%
# 插件根 / root  %INSTALL_DIR%\resources\app\dsh\node_modules\@deepseek-ai
# 补丁 71/72 已清洗, 0 待清洗, 1 跳过
```

两种情况它会给你 `surface web` + 「插件根未找到」：

1. **安装锚点丢了**——`<DSH_HOME>/dsh-purge/desktop-install.txt` 不存在、内容不是桌面安装目录，且没设 `DSH_DESKTOP_INSTALL`。应急：`--surface desktop`，或者用安装器重装一次把锚点写回来。
2. **你显式给了 `--surface web`**（排查 web 面时才有意义）。

`DSH_BASE` 单独设**永远没用**（实测）：web 面的探测认 `@deepseek-ai` 形态的路径，但同时把「落在桌面安装目录里」的那些排除掉，而本机唯一那份宿主就在 `%INSTALL_DIR%` 里。所以那句「set DSH_BASE 后重试」是错的指路。

```bash
DSH_BASE="%INSTALL_DIR%/resources/app/dsh/node_modules/@deepseek-ai" node bin/dsh-purge.js --status
# 仍然是：插件根未找到 / plugin root not found。桌面端：用 --surface desktop 或设 DSH_SURFACE=desktop（DSH_BASE 只在非桌面场景有用）
```

### 不会自己定档：`preflight-upgrade.mjs` 和你写的探针

它们直接调 `detectSurface()`，纯 node 进程一律 `web`。于是：

```bash
node scripts/preflight-upgrade.mjs --host "%INSTALL_DIR%/resources/app"
# 补丁 77 条：applied 73 / na 3 / …      ⚠ 相对基线漂移：#47 #49 #57
# 结论：有 3 条要处理（漂移 3 条）——先重锚再换包，否则它们会静默落空。
```

**这 3 条「漂移」是假的**，就是上面那三条 `pi-ai` 补丁解析不到键。补上环境变量立刻变回来：

```bash
DSH_SURFACE=desktop node scripts/preflight-upgrade.mjs --host "%INSTALL_DIR%/resources/app"
# 补丁 77 条：applied 76 / na 0 / excluded 1
# 相对基线无漂移。结论：模式全对得上，可以换包。
```

**照假漂移去「重锚」，会改掉三条本来好好的锚。** 这是本册存在的直接原因。同样要显式给环境变量的还有自己写的 `node --input-type=module -e '…patchStatusDetail(ai)…'` 这类探针——[04-补丁清单](04-补丁清单.md) 的生成脚本就带着这个前缀。

### 正确姿势

| 场景 | 怎么做 | 判据 |
| --- | --- | --- |
| 想看补丁状态 | `node bin/dsh-purge.js --status`（不用加前缀） | 第二行是 `surface desktop（判据 / via: 安装锚点）` |
| 想跑预检 | `DSH_SURFACE=desktop node scripts/preflight-upgrade.mjs --host "<安装目录>/resources/app"` | `补丁 77 条：applied 76` + `相对基线无漂移` |
| 想自己写探针 | 前面加 `DSH_SURFACE=desktop` | 键数 61 / 路径 64（desktop）而不是 57 / 60（web） |
| 手里只有面板 | 打开设置页 / 侧栏「清洗」 | 面板与 `purge_status` 本来就在宿主进程里，面是现成的 |

**判据只有一条**：先看输出里写的是哪个面，再决定这个数字能不能用。
---

## 四、web 面怎么装、怎么应用

装法与桌面面同一条通道，只有 profile 名不同：

```bash
# 官方 CLI（需要网络）
NODE="<DSH安装目录>/resources/runtime/primary-runtime/dependencies/node/bin/node.exe"
CLI="<DSH安装目录>/resources/app/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js"
"$NODE" "$CLI" plugin --profile web add <本仓库压缩包或 main.tar.gz 地址>
```

离线/手动两种装法见 [handbook/01](../handbook/01-安装与首装.md)，把里面每一处 `profile desktop` 换成 `web`、`profiles/desktop` 换成 `profiles/web` 即可。判据也照 01 的「装完必跑」，只是：

- `--status` **不用**加 `DSH_SURFACE=desktop`——web 宿主本来就在 web 面；
- `desktop-install.txt` 这条认领与 web 宿主无关（那份文件是给桌面安装用的）；
- 桌面壳那 5 条（#45 #82 #83 #84 #91）在 web 面一律不进分母，别去追。

**应用（点「应用」/ `purge_apply` / `--apply`）走的是同一个 `applyPatchesAllHosts`。** 它的默认范围只有 `options.aiBase` 那一棵；要一次覆盖多个宿主，必须显式 `{ allHosts: true }`，返回里 `hostPaths` / `skippedHosts` / `scope` 会逐条说打到哪儿（细节在 [02-判据与状态机](02-判据与状态机.md) 第五节）。

---

## 五、三条要背下来的规矩

1. **数字只在同一面内比。** 「面板 71 / CLI 68 / 预检 76」可以同时为真——它们是三个面三种口径。跨面对数字是这套东西里最贵的一种浪费。
2. **「会不会自己定档」要分清。** `bin/dsh-purge.js` 会（`--status` / `--apply` / `--revert` / `--sync`，按安装锚点定）；`preflight-upgrade.mjs` 和你手写的 `patchStatusDetail()` / `targetFiles()` 探针不会，必须显式 `DSH_SURFACE=desktop`。`check-bak-judge` 是第三种——它拿显式 `aiBase` 直接判，两面输出一致，给不给都一样。
3. **看到「漂移」先问是哪个面。** 漂移 = 基线里贴得上、这棵树贴不上；而「这棵树」是不是你要的那面，由 `DSH_SURFACE` 决定。三条 `pi-ai` 补丁在 web 面永远 drift，在 desktop 面永远不 drift。
