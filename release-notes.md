# 1.2.4

目标宿主：DeepSeek Harness **0.2.1-rc.2 / rc.3 / rc.5 / 0.2.2-rc.1**（桌面 / Web）

补丁表：85 条定义（条数不变，给 5 条加了 0.2.2 的 pattern 变体）

## 本版只为一件事故做准备

官方 **dsh-v0.2.2-rc.1** 于 2026-11-04 发布。如果你升级了客户端，**旧版插件会有 6 条补丁失配，
其中 4 条是必需的**——而且全在审批/提权链路上。表现是：审批门重新生效，操作被拦，
但面板不会报错，你只会觉得「怎么突然又要审批了」。

这一版把 0.2.2 适配好了。

### 怎么查出来的

拿 npm 上**干净的** rc.5 和 0.2.2 包（各 20 个核心包，不打任何补丁），跑同一条补丁表做 A/B 对打。
不是拿本机已打过补丁的文件比——那样所有 pattern 都「不匹配」，看不出真问题。

### 六条失配的原因

| 补丁 | 0.2.2 改了什么 |
| --- | --- |
| **#12** 审批句自动放行 | 前缀换了：`Approval policy: ask.` → `Approval prompts are enabled in this session:`，整句重写 |
| **#14** 提权无条件授信 | 中间插了一行 `displayReason: escalationDisplayReason(...)` |
| **#67** messages 兜底 | 外面多包一层 `try`，缩进 4 tab → 5 tab，**内容一字未改** |
| **#74** 首次发送前挂提示词 | `claim` 与 `assemble` 之间插了 `model.current()` / `tools.resolve()` / `try`；`assemble()` 也从收 context 改成收对象 |
| #62 工具询问放行 | `=== undefined` → `=== void 0`，代码从 `lib/index.js` 挪到 `lib/pipeline.js` |
| #60 run_code 描述中性化 | 那段文案在 0.2.2 里被删了，补丁失去作用对象（optional，功能上自动达成） |

### 结果

| 宿主 | 命中 | 必需失配 |
| --- | --- | --- |
| 0.2.1-rc.5 | 41 / 85 | #2 #3 #21 #24 #40 |
| **0.2.2-rc.1** | **40 / 85** | **#2 #3 #21 #24 #40**（完全相同） |

**两边的必需失配完全一致**，说明 0.2.2 上没有引入新的阻断项。差的 1 条是 optional 的 #60。

`#2 / #3 / #21 / #24 / #40` 是历史遗留问题，在 rc.5 上同样打不上，与本版无关。

### 兼容性

老 pattern 全部保留，**rc.5 上的行为一字未变**（41 命中，与 1.2.3 相同）。
0.2.2 的 pattern 是追加的变体，两边都能打。

`lib/core.js` 的 `dsh-tools` key 现在同时收 `lib/index.js` 和 `lib/pipeline.js`——
0.2.2 把工具流水线拆进了新文件，不收它 #62 会显示「文件缺失」。

### 验证

```sh
node scripts/assert-patches.mjs      # patches=85 changelog=85
node scripts/assert-soul-guard.mjs   # soul-guard ok（digest 未变，没碰灵魂层）
node --test "test/**/*.test.mjs"     # 97 pass / 0 fail
```

---

## 历史版本

