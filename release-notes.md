# 1.2.6

目标宿主：DeepSeek Harness **0.2.1-rc.2 / rc.3 / rc.5 / 0.2.2-rc.1**（桌面 / Web）

补丁表：85 条定义（未增删，只改注释与文档）

## 更正：1.2.4 里我把 #62 的成因写错了

1.2.4 的说明里写「#62 的 `=== undefined` 改成 `=== void 0`」，把它当成 0.2.2 引入的变更。**这是错的。**

独立复审把 0.2.1-rc.1 / rc.2 / rc.3 / rc.4 / rc.5 / 0.2.2-rc.1 六个版本全拉下来实测：
运行时包**从 rc.1 起就是 `approval === void 0`**，那几条 `=== undefined` 的变体在运行时
`lib/index.js` 上**一律 0 命中**——`undefined` 只活在 `lib/types/index.js` 那份副本里。

所以真实结论比原来那句严重：

> **1.2.4 之前，#62 一直是「假阳性」。**
> `types/index.js` 那份打上了，运行时 `index.js` 没打，状态面板却报 `applied`。

也就是说 1.2.4 顺手修掉的是 **rc.5 上一直存在的旧 bug**，不是新增的 0.2.2 适配。
本机 `dsh-tools/lib/index.js:3537` 现在是真的 `kind: "allow"` 且带 marker——这一刀以前从没落下去过。

### 门禁为什么没拦住

`assert-patches` 只校验 id 唯一 / name / file / 条数对 CHANGELOG，**不校验任何 pattern 能不能命中真宿主**；
97 个测试里也没有一条覆盖 0.2.2 变体。门禁绿 ≠ 变体对——这次是靠人工复审逐个下载真包实打才发现的。

## 这一版只有注释和文档

补丁逻辑与 1.2.5 **完全一致**，装在 0.2.1-rc.5 或 0.2.2-rc.1 上行为都不变。

如果你已经在 1.2.4 / 1.2.5 上，**不需要为此升级**——只关乎文档准确性。

### 验证

```sh
node scripts/assert-patches.mjs      # patches=85 changelog=85
node scripts/assert-soul-guard.mjs   # soul-guard ok（digest 7e5e018f，未变）
node --test "test/**/*.test.mjs"     # 97 pass / 0 fail
```

---

## 历史版本

### 1.2.5 · 发布卫生

1.2.4 代码是对的，但发布口径三处没对齐：资产落后一个 commit（#62 marker 未进 zip）、
CHANGELOG 顶部停在 1.2.2 且 1.2.3 缺条目 1.2.4 标题粘在文件底、README/COMPAT 目标宿主漏写 0.2.2。
本版收尾。

**CHANGELOG 为什么会坏**：写 1.2.4 时用 `indexOf("## 1.2.3 ·")` 找插入点，
而 1.2.3 那次根本没写 CHANGELOG，`indexOf` 返回 -1，切片把内容甩到末尾还吃掉一个字符。

### 1.2.4 · 适配 DSH 0.2.2-rc.1

官方 0.2.2-rc.1 于 11-04 发布。干净 npm 包 A/B 对打发现 6 条失配，其中 4 条必需、全在审批/提权链路：
**#12** 审批句前缀换掉、**#14** 插了 displayReason、**#67** 多包一层 try 缩进变了、
**#74** 中间插三行且 assemble 改收对象。**#62** 运行时用 `void 0`（见上方更正）、
**#60** 那段文案被删（optional，功能被另一条变体兜住）。

做法：老 pattern 全保留，追加 0.2.2 变体。`lib/core.js` 的 `dsh-tools` key 同时收 `lib/pipeline.js`。

### 1.2.3 · 补丁编号隔离

三条补丁和上游 1.1.86 撞号（#86 / #89 / #90），挪到 #100 / #101 / #102。
`markersAny` 同时认新旧标记，已装机器不丢状态。另从上游取回 #88 / #91。

### 1.2.2 · 空回合判定（#102）

模型把答案写进思考通道时，官方只判 `content.length === 0`，而这种回合长度是 1，
于是被判成正常结束：不重试、不报错、界面上一条空气。补丁让它也走 `EMPTY_RESPONSE`。

---

