# 1.2.2

目标宿主：DeepSeek Harness **0.2.1-rc.2 / rc.3 / rc.5**（桌面 / Web）

补丁表：83 条定义（1.2.1 的 82 条 + 新增 #90）

## 本版只解决一件事：空回合

模型把答案写进了思考通道，界面上什么都没有——**不重试、不报错、不留痕迹**。
你只看到一条空气，然后不知道是自己网络的问题还是它傻了。

### 这不是破甲搞坏的

从 `backup/plugins-20261030/app.asar.original`（破甲前的原版 asar）里抽出的
`dsh-llm-pi-ai/lib/index.js`，125589 字节、md5 `8db95ccb…`，与磁盘那份逐字节一致。
破甲原有 82 条补丁里命中 `llm-pi-ai` 的是 **0 条**。这个洞一直都在。

### 判据错在哪

`dsh-llm-pi-ai/lib/index.js` 的 `mapStopReason()`：

```js
case "stop":
    if (message.content.length === 0) return { /* EMPTY_RESPONSE */ };
    return { kind: "stop" };
```

吞句那条消息的 `content` 是 `[{type:"thinking", ...}]`，长度是 **1**。
长度不为 0，所以判成正常结束，不进重试队列。

全库统计：12800+ 次重试里 `EMPTY_RESPONSE` 只触发过 1 次 —— 漏掉的正是最常见的那种情形。

### #90 EMPTY_TURN_AFTER_REASONING

判据改成「没有正文、没有工具调用、但有思考」也走 EMPTY_RESPONSE，
接上 `retry-policy.js` 里**本来就有**的重试（`EMPTY_RESPONSE_CODE` 在
`DEFAULT_RETRYABLE_CODES` 里，`maxRetries: 5`、指数退避）。补丁不新造重试，只让这个洞能被认出来。

八种输入实测：

| 回合内容 | 结果 |
| --- | --- |
| 正常文字回复 | 正常结束 |
| 只有思考（吞句） | **判 EMPTY_RESPONSE，会重试** |
| 只有工具调用 | 正常结束 |
| 思考 + 工具 | 正常结束 |
| 完全空 | 判 EMPTY_RESPONSE（原本就是这样） |
| 思考 + 空白正文 | 判 EMPTY_RESPONSE |
| `reasoning` 别名 | 判 EMPTY_RESPONSE（扛上游改名） |
| `tool-call` 别名 | 正常结束（扛上游改名） |

**带工具调用的回合不会误伤**：全库 11409 条工具回合里有 6104 条正文为空，那是协议要求
（工具回合本来就不说话），判据靠 `hasTool` 把它们排除掉。

类型名容易看错：pi-ai 内部是 `thinking` / `toolCall`（驼峰），会话日志里看到的
`reasoning` / `tool-call` 是 DSH 自己的序列化格式，两回事。两种都认是为了扛上游改名。

### 新增 `llm-pi-ai` 目标别名

`targetFiles()` 原来没有指向适配器的 key。磁盘上叫 `pi-ai` 的东西有两个，混了就打错文件：

| 包 | 是什么 | 归谁管 |
| --- | --- | --- |
| `@deepseek-ai/dsh-llm-pi-ai` | DSH 适配层，`mapStopReason` 在这里 | **本版新增的 `llm-pi-ai`** |
| `@earendil-works/pi-ai` | 它 import 的上游库 | 原有的 `pi-ai-completions` 等三个 key |

### 两条标记都认

`markersAny: true` + `["[dsh-purge-90]", "[dsh-fix 2026-11-01]"]`。

这个补丁 2026-11-01 凌晨是**手工**写进宿主文件的，机器上那份带的是手打标记。
只认新标记的话，第一次自动应用会在旧块上再叠一层，把 `case "stop": {` 套进第二个花括号里——
**语法还成立，行为是错的**，而且不会当场炸，等下一次吞句才露头。

### 测试

新增 `test/patch90.test.mjs` 14 个用例：把 `case` 块套进最小 `switch` 外壳当真正的
`mapStopReason` 跑，八种输入逐条验。另有一条对照用例证明「官方原版确实会把只有思考的回合判成正常结束」——
没有它，测试只能证明新代码能跑，证明不了它修的是真问题。

全套 **97 个测试通过**（1.2.1 是 83 个）。

### 代价

每次吞句多花一次请求。按历史频率（全库 16 次吞 / 1495 条纯文本回合），平均每 90 个回合多一次重试。
重试也救不回来的时候（模型连续 5 次都把答案写进思考通道），最后还是空——
补丁不能治模型，只能兜底。

### 还原

删掉 `case "stop": { ... }` 整块，恢复成 `if (message.content.length === 0)` 那一行。

---

## 历史版本

