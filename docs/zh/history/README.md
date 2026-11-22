# history · 存档区（全都过期了）

> 破甲自 dsh-purge 1.1.71 分出后独立维护：宿主定版在 0.2.2-rc.5，补丁表、判据与文档只服务这一棵树，不再跟随任何外部发行节奏。；**原仓库已不可访问，本仓库即唯一来源**（fork 点 1.1.71，MIT）；**原仓库已不可访问，本仓库即唯一来源**（fork 点 1.1.71，MIT）
## 先看这一句

**这里所有数字都是当时的快照，全部过期。不要当现状。**

这批文件的价值只有一种：**追一句结论是哪次查出来的、当时的证据是什么。**它们的补丁条数、测试数、宿主版本、行号、路径、函数名，都按写作那天的机器写，今天读回来大半对不上——这不是错误，是存档的定义。

要现状，去 [handbook](../handbook/README.md) 与 [deep-dive](../deep-dive/01-补丁表.md)；要「我现在该敲什么」，去 handbook 的速查卡。

---

## 库里有什么

| 文件 | 当时的日期 | 是什么 | 现在去哪找同类信息 |
| --- | --- | --- | --- |
| [audits/a1-patch-proof.md](audits/a1-patch-proof.md) | 2026-11-14 | 补丁实证：逐条看「文件里有标记」vs「代码语义真改了」三方对照 | [deep-dive/01](../deep-dive/01-补丁表.md) 第五节 |
| [audits/a2-mismatch.md](audits/a2-mismatch.md) | 2026-11-14 | 9 条失配补丁：写错了还是宿主把代码搬包了 | [deep-dive/01](../deep-dive/01-补丁表.md) 第四节 |
| [audits/a3-toolchain.md](audits/a3-toolchain.md) | 2026-11-14 | 自检脚本在当时的宿主上做的假设审计 | [deep-dive/03](../deep-dive/03-工程与发版.md) |
| [audits/a4-docs.md](audits/a4-docs.md) | 2026-11-14 | 两份运维文档 vs 实机（上一轮文档回归） | [deep-dive/03](../deep-dive/03-工程与发版.md) |
| [audits/a5-implement.md](audits/a5-implement.md) | 2026-11-14 | 把 A2 的草案写进 `patches.js` / `core.js` 的过程 | [deep-dive/01](../deep-dive/01-补丁表.md) |
| [audits/a6-matrix.md](audits/a6-matrix.md) | 2026-11-14 | 348 格判定矩阵复核 + 假绿压力测试 | [deep-dive/02](../deep-dive/02-判据与状态机.md) |
| [audits/a7-shadow-install.md](audits/a7-shadow-install.md) | 2026-11-14 | 造影子 DSH_HOME 真跑 apply / revert | handbook 的备份与回滚篇 |
| [audits/a8-cross-version.md](audits/a8-cross-version.md) | 2026-11-14 | 跨版本差异抽查 | [deep-dive/01](../deep-dive/01-补丁表.md) |
| [audits/shadow-summary.md](audits/shadow-summary.md) | 2026-11-14 | A6 那批数据的短版（先看它，细节回 A6 / A7 / A8） | 同上 |
| [COMPAT-0.2.1.md](COMPAT-0.2.1.md) | 2026-11 | 0.2.1 那次兼容攻坚的全过程 | handbook 的安装与换包篇 |
| [SEALED-ASAR.md](SEALED-ASAR.md) | 2026-11 | 「为什么面板绿了却没用」的机制长文 | **已并入 handbook/04**，这里只留原文 |
| [02-patches.md](02-patches.md) | 2026-11 | 1.5 前那一版补丁表说明（88 条口径） | [deep-dive/01](../deep-dive/01-补丁表.md) + [02](../deep-dive/02-判据与状态机.md) |

---

## 怎么读这批东西

三条规矩，读完再信里面的任何一句话：

1. **只看结论与证据的关系，不看数字。** 这些报告的写法是「实测输出 + 结论」，可复用的部分是**它们怎么证的**，不是它们证出来的值。
2. **当时的「上游」字样保持原样，不改。** 那是当年的措辞与当年的参照系，改了就把证据也改了。存档区的禁用词不做替换，这是有意的例外——现状文档里出现那个词才是事故。
3. **正文一字未改，所以里面的相对链接可能已经指不到文件。** 这是搬动的必然结果，不是坏链；要找对应内容，看上面那张表的「现在去哪找同类信息」。
4. **结论被采纳的，都已经进了 CHANGELOG。** 想知道某条结论后来怎样了，看 `CHANGELOG.md` 对应版本那一节，那里才是决策记录。

---

## 为什么放在子目录

1.5 之前这 9 篇审计占 `docs/zh/` 文字量的六成，而且会随 npm 分发包发给用户。**读者最容易读到的部分，恰恰是全部过期的部分**——所以把它们挪出正文区：位置变了，警示才生效。
