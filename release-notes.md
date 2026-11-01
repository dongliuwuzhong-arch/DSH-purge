# 1.2.3

目标宿主：DeepSeek Harness **0.2.1-rc.2 / rc.3 / rc.5**（桌面 / Web）

补丁表：**85 条定义**（1.2.2 的 83 条 + 从上游取回 #88 / #91，另有三条重新编号）

## 本版做两件事：编号隔离、取回上游

### 一、三条补丁挪到 #100 起，跟上游拉开隔离带

之前从 rc.2/rc.3 分支出来时，我们的 #86 / #89 / #90 和上游后来编的号撞了：

| 编号 | 上游 1.1.86 是什么 | 我们改前是什么 |
| --- | --- | --- |
| #86 | `SESSION_QUEUE_STEER_INTERRUPT` | `SESSION_STEER_ALWAYS_FOLLOWUP` |
| #89 | `SANDBOX_POLICY_BRAND_NEUTRAL` | `HUNG_PROMPT_AFTER_PERSONA` |
| #90 | `SKILL_BADGE_DESCRIPTION_NEUTRAL` | `EMPTY_TURN_AFTER_REASONING` |

同号不同物。运行上不出错（`installed-rev` 认版本号不认补丁 id），但以后想 cherry-pick 上游修复时，
「#90 修了什么」这句话会同时指两件事。现在挪到 **#100 / #101 / #102**。

**已装机器不丢状态、不重复打补丁。** 靠 `markersAny: true` 同时认新旧标记：

```js
markersAny: true,
markers: ["[dsh-purge-102]", "[dsh-purge-90]", "[dsh-fix 2026-11-01]"],
```

旧标记留着，面板照旧显示 applied；新产出的文件带新标记，下次再打是空转。
真宿主实测：改号后三条仍是 `applied`，`applyReplacementsToText` 的 `changed` 是 `false`。

### 二、从上游 1.1.86 取回两条

| 补丁 | 做什么 | 本机状态 |
| --- | --- | --- |
| **#88 HUNG_PROMPT_STRICT_NEEDLE** | 判据比 #87 严：ChatML 头和正文尾**都**在场才算挂住 | `skipped` |
| **#91 DESKTOP_HOST_SIGNAL_EXIT_LOG** | 宿主被信号杀掉时写持久化退出日志，仍不弹对话框 | 下次应用时打上 |

**#88 和 #87+#101 是互斥路线，不叠加。** 本机走 #87/#101（只看头），所以 #88 的 pattern 命中 0 次、
恒为 skipped——这是正常的。取回它是为了跟上游对齐、方便以后比对，不是指望它在本机生效。

### 同步改动

- `PATCH_DISPLAY_GROUPS`：`followup: [85, 100]`、`hang: [87, 88, 101]`
- `assert-soul-guard.mjs` 的 `SOUL_PATCH_IDS`：89 → 101，`soul-guard.lock` 重写基线
- `test/patch90.test.mjs` → `test/patch102.test.mjs`

### 验证

```sh
node scripts/assert-patches.mjs      # patches=85 unique_ids=ok changelog=85
node scripts/assert-soul-guard.mjs   # soul-guard ok（digest 7e5e018f）
node --test "test/**/*.test.mjs"     # 97 pass / 0 fail
```

真宿主实测（`DSH_SURFACE=desktop`，宿主 9 个进程在跑）：

| 补丁 | 落点 | 状态 | 会不会重复打 |
| --- | --- | --- | --- |
| #100 | agent-loop | applied | 否 |
| #101 | agent-loop | applied | 否 |
| #102 | llm-pi-ai | applied | 否 |
| #88 | agent-loop | skipped（互斥路线） | 否 |
| #91 | desktop-shell | 待应用 | — |

#91 的 pattern 在真实 `resources/app/lib/main.js` 里命中 1 次，产物 `node --check` 通过。

---

## 历史版本

