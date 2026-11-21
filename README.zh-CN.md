# dsh-purge（破甲）

**DeepSeek Harness 提示词与宿主补丁插件 · 1.5.3**

> 破甲自 dsh-purge 1.1.71 分出后独立维护：宿主定版在 0.2.2-rc.5，补丁表、判据与文档只服务这一棵树，不再跟随任何外部发行节奏。（出处：YuJunZhiXue/dsh-purge 1.1.71，MIT）

> 📚 **中文文档总导航：[docs/zh/README.md](docs/zh/README.md)** —— 三册：运维手册（照着做）/ 原理（为什么）/ 存档（当时怎么查的）。

| 项 | 值 |
| --- | --- |
| 当前插件版 | 1.5.3 |
| 宿主基线（定版） | DSH 0.2.2-rc.5 |
| 补丁表 | 77 条，最大 id 105（另有 4 条在存档区，不参与计数） |
| 测试 | 356 例 |
| 源码来源 | [YuJunZhiXue/dsh-purge](https://github.com/YuJunZhiXue/dsh-purge) 1.1.71（fork 点，只管版权与出身） |
| 本仓库 | [dongliuwuzhong-arch/DSH-purge](https://github.com/dongliuwuzhong-arch/DSH-purge) |

## 它能做什么

- **会话侧栏「清洗」**：补丁分组与状态、应用、还原、卸载；提示词覆盖段；规则集切换；Skill 导入；自己的服务器名单；回退一轮。
- **宿主补丁**：77 条文本替换，全部幂等。改之前把目标文件备份成 `<文件>.dshpurge.bak`，还原时按备份覆盖回去。
- **人格注入**：默认注入正文随插件提供，构建时嵌进密封槽；`prompt-inject.md` 是用户文件，还原与卸载默认保留。
- **命令行与聊天入口**：`dsh-purge --status|--apply|--revert|--uninstall|--edit|--sync`；`/purge`、`/rules`、`/skills`、`/rewind`；模型工具 `purge_status`、`purge_apply`、`purge_revert`。

## 它不做什么（先看这段，能省掉一半误判）

- **不是公网工具。** 只碰本机的官方 `@deepseek-ai` 包、本机 profile、`$DSH_HOME` 下的覆盖文件。没有扫描器，没有对外载荷。
- **不改第三方插件的仓库。** 对已装的 doctor / market / 梁神 / mnemon 只做尽力而为的运行时兼容。
- **不替你点「应用」。** 把插件装进 profile 不会自动改宿主。
- **不提供旧宿主版本的补丁表。** 不支持 0.1.x；社区桌面端不维护。
- **不管 Web 与桌面端的差异。** 两面分开安装、分开应用，各用各的 profile 与 `$DSH_HOME`；两面的数字只在同一面内比较。

> 🔴 **一个必须知道的前提：补丁写上 ≠ 补丁生效。**
>
> 官方桌面版把宿主代码封在 `resources\app.asar` 里，而补丁只能写进解开的 `resources\app\`。
> Electron 的解析顺序是 `app.asar` → `app` → `default_app.asar`，**asar 在就永远轮不到目录**。
>
> 判据只有一条：看状态里还有没有 `app.asar` 那一行——出现「还在。补丁写在解开目录，当前进程读不到」就是全在空转。
> （更硬的一条在 `check-paths`：第一行必须说「宿主读的是解包目录」。）
> 1.2.1 起升级后的自愈是自动的；机制与处置见 [handbook/04](docs/zh/handbook/04-宿主换包与解包态.md)，机制长文在 [history/SEALED-ASAR.md](docs/zh/history/SEALED-ASAR.md)。

## 四道门：改完必须全绿

| 门 | 命令 | 看到什么算对 |
| --- | --- | --- |
| 补丁表 | `node scripts/assert-patches.mjs` | `✓ 补丁表自检通过` |
| 灵魂层 | `node scripts/assert-soul-guard.mjs` | `soul-guard ok`，digest 与 `soul-guard.lock` 一致 |
| 版本 | `node scripts/assert-versions.mjs` | `✓ 四处一致：1.5.3` |
| 文档 | `node scripts/assert-docs.mjs` | 六类数字 + 第 7 类命令冒烟。**末行**是 `七类全绿。`（三条冒烟都真跑过）；有跳过时末行写 `六类全绿；第 7 类命令冒烟跳过 N 条（未核）`——跳过不算通过。倒数第二行说跑到哪几条 |

这四道门是「文档写错了也会红」的机制：禁用词、行号漂移、补丁条数、用例数、版本五处，全靠它们守。各自的边界见 [deep-dive/03-工程与发版.md](docs/zh/deep-dive/03-工程与发版.md)。

## 安装：三条路，选一条

> 这个包不在 npm 上，`add dsh-purge` 会 404。安装源是仓库压缩包、本地目录或手动放置。

### ① 离线安装器（推荐）

不跑 pnpm、不联网、不自动应用补丁：

```bash
node scripts/install-offline.mjs --profile desktop --dsh-home "$HOME/.dsh" --dry-run
node scripts/install-offline.mjs --profile desktop --dsh-home "$HOME/.dsh"
node scripts/install-offline.mjs --verify --profile desktop --dsh-home "$HOME/.dsh"
```

看到什么算对：`--dry-run` 打五行 `[dry-run]`（source / target / profile / would-copy / would-write）——**前提是 profile 里已经有这条依赖**；首装会多一行 `would update package.json`（共六行）。两种都不落盘。正式跑：profile 需要改时**先**打 `profile backup: <profile 的 package.json>.dsh-purge.<时间戳>.bak`，再打 `installed dsh-purge@<版本>` 加后面四行（plugin / profile / node_modules link / not running…）。

`--verify` **两种形态都认，都退 0**，第一行永远是 `verified <插件版本>`：

- **junction**（安装器建的那种）必须指回插件源目录；指向别处才抛 `链接指向别处 / link points elsewhere` 并退 1。
- **实体副本**（`--sync` 铺出来的那份，本机就是）核它**自己**是不是一份完整可用的 dsh-purge（名字 / 必需文件 / 版本），通过时打 `实体副本 / copy（与源码同版本 X）`；副本版本落后源码只把这句换成 `（副本 A，源码 B（跑 node scripts/sync-runtime.mjs --apply 对齐；没对齐不影响 --verify 的判定））`，**不判失败**。

要核到「源与副本逐字节一样」再跑 `node scripts/sync-runtime.mjs`（「全部同步」）+ `check-paths.mjs`（「源与副本一致」）——那是另一件事，不是安装判据。

它做五件事：校验包 → 复制到 `$DSH_HOME/plugins/dsh-purge` → 改 profile 的 `package.json` → 建 `node_modules/dsh-purge` 的 junction → 写 `desktop-install.txt`。**不跑 pnpm、不 Apply、不重启。**

也可以直接装压缩包：

```bash
node scripts/install-offline.mjs --zip dsh-purge-1.5.3.zip --profile desktop --dsh-home "$HOME/.dsh"
```

### ② 官方 CLI（需要网络）

普通 `dsh` CLI 会拒绝 `--profile desktop`，要用安装目录自带的桌面 CLI：

```bash
NODE="<DSH安装目录>/resources/runtime/primary-runtime/dependencies/node/bin/node.exe"
CLI="<DSH安装目录>/resources/app/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js"

"$NODE" "$CLI" plugin --profile desktop add <本仓库压缩包或 main.tar.gz 地址>
```

Web 面用普通 CLI：`dsh plugin --profile web add <同上>`。

**安装目录还是 `resources/app.asar` 时**，把上面路径里的 `resources/app/` 换成 `resources/app.asar/`。

### ③ 手动放置

1. 找到宿主真正在用的 `$DSH_HOME`：它必须含 `profiles/`，且 `profiles/<web|desktop>/package.json` 的 `name` 是 `dsh-profile-web` 或 `dsh-profile-desktop`。
2. 把插件放到 `$DSH_HOME/plugins/dsh-purge`，目录名与 `package.json` 的 `name` 都必须是 `dsh-purge`。
3. 只改当前宿主那一份 profile 的 `package.json`：`dependencies` 加 `"dsh-purge": "file:../../plugins/dsh-purge"`，`dsh.profile.bundles` 末尾追加 `"dsh-purge"`。
4. Windows 建 Junction：

```powershell
New-Item -ItemType Junction -Path "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-purge" -Target "$env:USERPROFILE\.dsh\plugins\dsh-purge"
```

5. 完全退出宿主再打开，点 **dsh-purge → 清洗 → 应用**。

装完看到什么算对：侧栏出现按钮；`/purge status` 打出当前 `$DSH_HOME` 与补丁状态。

## 目录导览

| 位置 | 放什么 |
| --- | --- |
| `docs/zh/handbook/` | **运维手册**：装、验、日常、备份、回滚、换宿主包、人格注入、故障处置、速查卡 |
| `docs/zh/deep-dive/` | **原理**：[补丁表](docs/zh/deep-dive/01-补丁表.md) / [判据与状态机](docs/zh/deep-dive/02-判据与状态机.md) / [工程与发版](docs/zh/deep-dive/03-工程与发版.md) / [补丁清单 77 条逐条](docs/zh/deep-dive/04-补丁清单.md) / [web 面](docs/zh/deep-dive/05-web面.md) |
| `docs/zh/history/` | **存档**：9 篇审计、0.2.1 兼容攻坚、密封 asar 长文、旧补丁表。**数字全部过期** |
| `lib/` | 插件实现：`patches.js`（主表）/ `patches-legacy.js`（存档区）/ `core.js`（判据与读写）/ `sealed-heal.js`（自愈判定） |
| `scripts/` | 门与工具：`assert-*` 四道门、`preflight-upgrade.mjs`、`install-offline.mjs` |
| `test/` | 53 个测试文件 / 356 例 |

## 三条会真坏事的教训（写在这里，免得翻 CHANGELOG）

1. **备份会被判据误判吃掉。** 1.3.3 前 `inspectStaleBaks` 会把 `.dshpurge.bak` 刷成「打完补丁的版本」，之后回滚判「没被动过」直接跳过——面板显示齐全，实际回不去。
2. **补丁 `applied` 不等于生效。** #17 的目标插件在宿主自带配置里是 `disabled: true`，插件根本不组装；#73 曾靠 marker 撞车假装 applied。
3. **解封那一步必须等宿主正常退出。** 运行时改名 `app.asar` 必然 EBUSY，硬杀也会留子进程句柄。

## 数据与状态

运行时文件都在 `$DSH_HOME`：

- `prompt-inject.md` —— 用户提示词
- `rules/` —— 规则集
- `skills/` —— 用户 Skill
- `net-scope-allow.txt` —— 自己的服务器名单
- `dsh-purge/` —— 插件状态、备份索引、`exclude-patches.json`、`asar-swap.json`（换包台账）

插件源码在 `$DSH_HOME/plugins/dsh-purge`。profile 的 `node_modules/dsh-purge` 有两种形态：**junction**（离线安装器建的）或**实体副本**（`--sync` 往实体目录里铺）。`--verify` 两种都认、都退 0：junction 必须指回源码（指错才红），实体副本按它自己核（名字 / 必需文件 / 版本）。要「源与副本逐字节一致」是另一件事，用 `sync-runtime` + `check-paths`。改了源码要 `dsh-purge --sync` 或重装才会进运行副本。

## 来源与许可

- 源码来源（fork 点）：[YuJunZhiXue/dsh-purge](https://github.com/YuJunZhiXue/dsh-purge) **1.1.71**
- 许可：MIT，见 [LICENSE](LICENSE)
- 原作与贡献者的版权归其各自所有；本仓库只对自己这部分改动负责

**fork 点之后的一切都是本地决定**：宿主基线、补丁表增删、判据、文档分册，都不需要与任何外部发行对齐。
