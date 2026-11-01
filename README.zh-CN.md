# dsh-purge

**DSH 0.2.1-rc.2 / rc.3 / rc.5 兼容变体 · 1.2.3**

- 上游：[YuJunZhiXue/dsh-purge](https://github.com/YuJunZhiXue/dsh-purge)
- 本仓库：[dongliuwuzhong-arch/DSH-purge](https://github.com/dongliuwuzhong-arch/DSH-purge)

> 🔴 **先读这一条：补丁生效需要一个前提。**
>
> 官方桌面版把宿主代码封在 `resources\app.asar` 里，而补丁只能写进解开的 `resources\app\`。
> Electron 的加载顺序是 `app.asar` → `app` → `default_app.asar`，**asar 在就永远轮不到目录**。
>
> 所以「补丁写上了」不等于「补丁生效了」。判断方法只有一条：看状态面板里有没有
> `✗ app.asar: 还在` 这一行——有这行就是全在空转。
>
> 1.2.1 起，升级后的自愈是自动的；完整机制见 [`docs/SEALED-ASAR.md`](docs/SEALED-ASAR.md)。
`dsh-purge` 是装在本机 DeepSeek Harness 上的提示词与宿主补丁插件。它在会话标题旁提供一个「清洗」侧栏，用来管理提示词、规则集、Skill 和宿主补丁；你确认后，它才会把改动写进当前 profile 和当前宿主。

本仓库是上游 `dsh-purge` 的兼容分支，跟的是 DSH **0.2.1-rc.2 / rc.3 / rc.5**。它保留上游的补丁体系与注入流程，主要维护宿主版本适配、桌面端路径处理、备份/回滚判据和安装文档。它不是从零重写的另一个插件，也不隐藏上游来源。

## 它实际有什么

### 会话侧栏

会话标题旁的 **dsh-purge** 按钮打开右侧栏，当前只有一页：**清洗**。

| 区域 | 作用 |
| --- | --- |
| 补丁 | 按组查看补丁状态，执行应用、还原、卸载 |
| 提示词 | 编辑 `prompt-inject.md`，作为当前会话的覆盖段 |
| 规则集 | 管理多套 `AGENTS.md` / `CLAUDE.md`，启用后写入当前 `$DSH_HOME` |
| Skill | 导入压缩包或文件夹到当前宿主的官方 `skills/<id>/SKILL.md`；匹配和加载由 DSH 负责 |
| 自己的服务器 | 每行登记一个 IP 或完整主机名，保存到 `net-scope-allow.txt` |
| 回退 | 与官方 `session.fork({ atSeq })` 对齐的回退一次 / 回退上一轮；也支持 `/rewind` |

### 提示词与规则

- 默认注入正文随插件提供，构建时嵌入，不读取宿主磁盘上的提示词文件。
- `prompt-inject.md` 是用户文件；还原和卸载默认保留它。
- 支持规则集切换；规则集写入 `$DSH_HOME/rules/`。
- 工作区策略有 `strict` / `fallback` / `always` 三种，决定是否保留 DSH 的 workspace baseline 段。
- Skill 不进入注入段，也不顶替提示词；卸载插件不会删除用户自己导入的 Skill。

### 补丁

- 补丁表当前为 **85 条定义**；实际状态按当前宿主面匹配，分成已应用、待应用、跳过。
- 应用前把目标文件备份为 `<文件>.dshpurge.bak`，重复应用是幂等的。
- 「还原」用备份覆盖回去并删除备份；没有备份时，至少剥掉本插件写入 shim 的行。
- 「卸载」会先还原已应用的补丁，再删除注入文件、规则库和插件本身。
- 目标文件已经带补丁痕迹时，插件不会伪造一份“看起来一样”的备份；这种情况会在状态里点名。

### 命令行与聊天入口

```sh
dsh-purge --status
dsh-purge --apply
dsh-purge --revert
dsh-purge --uninstall
dsh-purge --edit
dsh-purge --sync
```

```text
/purge status | apply | revert | uninstall | edit | help
/rules list | use <id> | create <id> | delete <id> | reset | help
/skills list | import <压缩包或文件夹> | create <id> [说明] | delete <id> | help
/rewind
```

模型工具：`purge_status`、`purge_apply`、`purge_revert`。

## 兼容范围

- 官方桌面端：DeepSeek Harness **0.2.1-rc.2 / 0.2.1-rc.3 / 0.2.1-rc.5**
- 官方 Web：`dsh web` 的 0.2 系
- Node.js **>= 18**；Windows 下想避免闪窗，建议 **Node >= 22**
- Web 和桌面端分开安装、分开应用，各用各的 profile 和 `$DSH_HOME`
- 不支持 0.1.x；0.1.7 请使用上游对应旧版本
- 社区桌面端不维护

## 安装

> 这个包不在 npm 上，`dsh-purge` 直接 `add` 会 404。安装源是仓库压缩包、本地目录或手动放置。

### 官方桌面端

普通 `dsh` CLI 会拒绝 `--profile desktop`，要用安装目录自带的桌面 CLI：

```sh
NODE="<DSH安装目录>/resources/runtime/primary-runtime/dependencies/node/bin/node.exe"
CLI="<DSH安装目录>/resources/app/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js"

"$NODE" "$CLI" plugin --profile desktop add <本仓库压缩包或 main.tar.gz 地址>
```

如果安装目录还是 `resources/app.asar`，把上面的 `resources/app/` 换成 `resources/app.asar/`。

### 官方 Web

```sh
dsh plugin --profile web add <本仓库压缩包或 main.tar.gz 地址>
```

### 离线安装（推荐）

仓库自带安装器，不跑 pnpm，不联网，不自动应用补丁：

```sh
node scripts/install-offline.mjs --profile desktop --dsh-home "$HOME/.dsh" --dry-run
node scripts/install-offline.mjs --profile desktop --dsh-home "$HOME/.dsh"
node scripts/install-offline.mjs --verify --profile desktop --dsh-home "$HOME/.dsh"
```

也可以直接安装压缩包：

```sh
node scripts/install-offline.mjs --zip dsh-purge-1.2.3.zip --profile desktop --dsh-home "$HOME/.dsh"
```

安装器会校验包、复制到 `$DSH_HOME/plugins/dsh-purge`、修改 profile 的 `package.json`、建立 `node_modules/dsh-purge` 链接，并写入 `desktop-install.txt`。默认**不执行 pnpm、不 Apply、不重启**。

### 手动安装

1. 找到当前宿主真正使用的 `$DSH_HOME`。它应当包含 `profiles/`，并且 `profiles/<web|desktop>/package.json` 的 `name` 分别是 `dsh-profile-web` 或 `dsh-profile-desktop`。
2. 把插件放到 `$DSH_HOME/plugins/dsh-purge`。目录名和 `package.json` 里的 `name` 都必须是 `dsh-purge`。
3. 只改当前宿主对应的 profile `package.json`：
   - `dependencies` 增加 `"dsh-purge": "file:../../plugins/dsh-purge"`
   - `dsh.profile.bundles` 末尾追加 `"dsh-purge"`
4. 建立链接（Windows 用 Junction）：

```powershell
New-Item -ItemType Junction -Path "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-purge" -Target "$env:USERPROFILE\.dsh\plugins\dsh-purge"
```

5. 完全退出宿主再打开，然后点会话标题旁的 **dsh-purge → 清洗 → 应用**。

安装成功后应能看到侧栏按钮；聊天里的 `/purge status` 应打印当前 `DSH_HOME` 和补丁状态。

## 使用顺序

1. 先安装并重启宿主。
2. 打开 **dsh-purge → 清洗**，确认补丁分组和状态。
3. 需要改提示词或规则集时，先编辑再应用。
4. 点 **应用**。应用成功后宿主会重启一次，让补丁进入当前进程。
5. 新开一轮对话；已经存在的会话不会自动重装旧提示词。

> 只把插件写进 profile 不会自动改宿主。`Apply` 是明确动作；默认配置不会替你点应用。

## 数据与状态

运行时文件在 `$DSH_HOME`：

- `prompt-inject.md`：用户提示词
- `rules/`：规则集
- `skills/`：用户 Skill
- `net-scope-allow.txt`：自己的服务器名单
- `dsh-purge/`：插件状态、备份索引和重启保护文件

插件源码在 `$DSH_HOME/plugins/dsh-purge`。profile 的 `node_modules/dsh-purge` 是安装时的副本，不是源码链接；改源码后需要 `dsh-purge --sync` 或重新安装才会进入运行副本。

## 补丁口径

状态里的数字可能有两套，不是 bug：

- 桌面面板按桌面面可运行的补丁统计；
- 命令行 `dsh-purge --status` 默认按 Web 面统计，能匹配到更多定义。

不同宿主面的数字只在同一面内比较。可选包没有安装时，对应补丁会显示跳过，不阻塞本次应用。当前宿主上出现少量 `skipped` / `missing_file` 属于正常情况，重点看 **待应用是否为 0**。

## 已知边界

- 只处理本机官方 `@deepseek-ai` 包、本机 profile 和用户目录下的覆盖文件；不是公网扫描器，也不包含对外攻击载荷。
- 不修改第三方插件的源码仓库；对已安装的 doctor / market / 梁神 / mnemon 只会做尽力而为的运行时兼容。
- 桌面端不依赖 `dsh.cmd` shim；shim 状态显示 `original` 或 `missing` 不影响聊天功能。
- 宿主升级后，原文对不上的补丁会显示跳过，不会被乱改。

## 上游与许可

- 上游项目：[YuJunZhiXue/dsh-purge](https://github.com/YuJunZhiXue/dsh-purge)
- 本分支基于上游 **1.1.71** 分叉，跟随 DSH 0.2.1-rc.2 / rc.3 / rc.5 维护兼容补丁
- 许可证：MIT，见 [LICENSE](LICENSE)
- 上游作者与贡献者的版权归其各自所有；本仓库只对兼容分支的修改负责

如果这个分支帮你省了时间，请也给上游点个 Star。