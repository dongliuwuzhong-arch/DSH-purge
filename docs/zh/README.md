# 破甲 · 中文文档总导航

> 破甲自 dsh-purge 1.1.71 分出后独立维护：宿主定版在 0.2.2-rc.5，补丁表、判据与文档只服务这一棵树，不再跟随任何外部发行节奏。；**原仓库已不可访问，本仓库即唯一来源**（fork 点 1.1.71，MIT）；**原仓库已不可访问，本仓库即唯一来源**（fork 点 1.1.71，MIT）
## 一眼版本

- 当前插件版 **1.5.4**
- 当前适配 **DSH 0.2.2-rc.5**（定版；宿主换包看 handbook 的换包篇）
- 补丁表 77 条，最大 id 105；存档区另存 4 条（不参与计数）
- 测试 **356 例**；四道门见 [deep-dive/03](deep-dive/03-工程与发版.md)

这四个数的「权威位点」只有这里一处；根 README 两版与 `release-notes.md` 另有同样几个数，靠 `assert-versions`（版本四处）与 `assert-docs`（版本、宿主基线、补丁条数、用例数）盯着，所以它们不会各说各话。

其余各篇写**口径**、不写绝对值——同一个数抄到三篇里而没人守，三个月后必有一处是假的。

---

## 三册，各管一类问题

| 册 | 读者 | 什么时候打开 | 只回答什么 |
| --- | --- | --- | --- |
| [handbook/](handbook/README.md) | 三个月后的我，手里只有这台机器 | 要动手的时候 | 装、验、日常看、备份、回滚、换宿主包、人格注入、出事怎么查 |
| [deep-dive/](deep-dive/01-补丁表.md) | 要改代码、改判据、改补丁的人 | 想知道「为什么」的时候 | 77 条补丁怎么组织、逐条改了什么、状态怎么算出来、两面（web / desktop）差在哪、门与 CI 怎么跑 |
| [history/](history/README.md) | 追一句结论出处的人 | 只在怀疑某个结论时 | 当时查了什么、当时的证据是什么。**数字全部过期** |

规则只有一条：**册与册之间单方向引用。** handbook 可以指向 deep-dive，deep-dive 不回头抄 handbook 的操作步骤；history 只被引用，不引用现状。

---

## 我要干什么，读哪篇

| 我现在要 | 去哪 |
| --- | --- |
| 第一次装 | [handbook/01-安装与首装](handbook/01-安装与首装.md) |
| 每天开工先看机器 | [handbook/02-日常运维](handbook/02-日常运维.md) 的命令表 |
| 面板说贴上了，但感觉没生效 | [handbook/04-宿主换包与解包态](handbook/04-宿主换包与解包态.md) 的「解包态判据」 |
| 要回滚 / 怀疑备份坏了 | [handbook/03-备份与回滚](handbook/03-备份与回滚.md) |
| 人格少了一段 / 出现两份 | [handbook/05-人格与注入链](handbook/05-人格与注入链.md) |
| 起不来、崩、报权限 | [handbook/06-故障处置](handbook/06-故障处置.md) |
| 半夜只有五分钟 | [handbook/99-速查卡](handbook/99-速查卡.md) |
| 要加 / 改 / 停一条补丁 | [deep-dive/01-补丁表](deep-dive/01-补丁表.md) |
| 要解释一个红灯、要改判据 | [deep-dive/02-判据与状态机](deep-dive/02-判据与状态机.md) |
| 要改代码 / 发一版 | [deep-dive/03-工程与发版](deep-dive/03-工程与发版.md) |
| 要查某一条补丁到底改了什么 | [deep-dive/04-补丁清单](deep-dive/04-补丁清单.md)（77 条逐条一行） |
| web 面怎么装 / `--status` 说「插件根未找到」 | [deep-dive/05-web面](deep-dive/05-web面.md) |
| 想知道某条结论当年是怎么查出来的 | [history/](history/README.md) |

英文入口在仓库根的 [README.md](../../README.md)。

---

## 1.5 的迁移表：旧路径 → 新路径

1.5 之前 `docs/zh/` 是 8 篇平铺（`00`~`07`）+ 9 篇审计。现在按问题类型分册，对应关系如下。

| 旧路径 | 新路径 | 状态 |
| --- | --- | --- |
| `00-maintenance.md`（1183 行） | 拆成 `handbook/00`~`99` 八篇 | **文件已删，也没有指针页**（1.5 删的）。`assert-docs` 第 2 类那条宿主基线锚是候选列表 `files: ["docs/zh/handbook/00-总览与定位.md", "docs/zh/00-maintenance.md"]`，取第一个存在的——门盯的是 `handbook/00`，不是这个已删的文件 |
| `01-install.md` | `handbook/01-安装与首装.md` | **已删**（要点与判据已进 handbook/01） |
| `02-patches.md` | `deep-dive/01-补丁表.md`（表与锚）+ `deep-dive/02-判据与状态机.md`（判据） | 旧正文已删，留 8 行指针页（本文件与 `history/02-patches.md` 指着它，handbook 里没有引用）；原文进 `history/02-patches.md` |
| `03-backup-revert.md` | `handbook/03-备份与回滚.md` | **已删**（十桶、四类缺口、五级救法都在 handbook/03） |
| `04-shadow-test.md` | `history/SHADOW-TEST.md`（方法与结果按快照留档） | **已迁** |
| `05-known-limits.md` | `handbook/06-故障处置.md` + `deep-dive/01` 第四节 | **已删** |
| `06-audits.md` | [history/README.md](history/README.md)（索引搬过去了） | **已删** |
| `07-upgrade-playbook.md` | `handbook/04-宿主换包与解包态.md` | **已删** |
| `audits/a1`~`a8` + `shadow-summary` | `history/audits/`（原文不动，位置变了） | **已迁** |
| 根目录 `COMPAT-0.2.1.md` | `history/COMPAT-0.2.1.md` | **已迁** |
| `docs/SEALED-ASAR.md` | `history/SEALED-ASAR.md`（正文并入 `handbook/04`） | **已迁** |

**删除的规矩只有一条：先有替身，再删原件。** 每一篇都是等 handbook 或 deep-dive 里对应的那篇写到能替代之后才删的；删之前逐篇对过要点（安装三法、十桶与四类缺口、七档自愈、十四条排障），不是按标题猜。

**现在只剩一个指针页**：`00-maintenance.md` 已经删掉（`assert-docs` 的宿主基线锚点早就是候选列表，取 `handbook/00` 那一份，删文件不会让门变红）；`02-patches.md` 留着，因为它那 8 行本身就是一块「旧路径 → 新路径」的换乘牌子，删了会让 `history/02-patches.md` 与本文的迁移表各断一节。删文件容易，删完让链接断掉才是麻烦。

---

## 名词口径（只有这一处定）

| 词 | 在这套文档里指什么 |
| --- | --- |
| 宿主 | DeepSeek Harness 本体（定版 0.2.2-rc.5），不是本插件 |
| fork 点 | `YuJunZhiXue/dsh-purge` 1.1.71（仓库已不可访问）—— 只管版权与出身，本仓库即唯一来源 |
| 出厂原文 / 宿主自带 | 宿主包里本来就这么写的那段代码，我们没动过 |
| 定版 | 宿主锁在 0.2.2-rc.5，本仓库不追任何外部发行节奏；要换包走 handbook 的换包篇 |
| 补丁 / 条目 | `lib/patches.js` 里的一条（有 id），77 条 |
| 终态 / 桶 | 一个补丁算出来的那一个字：applied / pending / unmatched / skipped / na / missing_file |

---

## 路径占位符（发布版里会替换成它）

开发副本里写的是本机绝对路径；**发布出去的 tar / zip 里，它们被替换成占位符**（发布卫生那条规矩：本机路径不进包）。两套写法指同一件事，照抄发布版时先把占位符换成你自己的路径：

| 占位符 | 指什么 | 本机开发副本里的值 | 用在哪 |
| --- | --- | --- | --- |
| `%INSTALL_DIR%` | 宿主（DeepSeek Harness）的安装根目录 | `%INSTALL_DIR%` | 换包、解包态、预检 `--host`、桌面壳路径 |
| `%USERPROFILE%` | Windows 用户目录 | `%USERPROFILE% | `.dsh` 那一侧的全部路径 |
| `%WORKSPACE%` | 工作区根目录（不是插件仓，是「随工作区走」那几个工具脚本所在处） | `%WORKSPACE%` | `tools/check-paths.mjs`、`专项任务/破甲/bin/count-injections.mjs` |
| `%DSH_HOME%` | 运行时的 `DSH_HOME` | `%USERPROFILE%/.dsh` | profile、会话、`dsh-purge/` 台账 |

⚠ **别把带 `%VAR%` 的路径直接粘进 bash。** Windows 只在 cmd 里展开它们；bash 把整串当一个普通字符串，于是写出一个名叫 `%SystemDrive%` 的目录（真发生过）。bash 里用 `$INSTALL_DIR` / `$USERPROFILE` / `$DSH_HOME`，PowerShell 里用 `$env:INSTALL_DIR` 这种写法，或者干脆换成本机绝对路径。
