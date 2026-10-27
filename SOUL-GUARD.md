# SOUL-GUARD · 破甲不许改灵魂

本仓库的存在目的是「**在不改变灵魂的前提下破甲**」。这条不是口号，是一道 diff 闸门：
下面这些文件/补丁只允许**原样搬运**，不允许"顺手优化一句"。

## 禁改清单

| 层 | 具体对象 | 说明 |
| --- | --- | --- |
| 注入正文 | `lib/default-prompt-inject.md` | 破甲正文本身（构建时由 `scripts/embed-default-prompt.mjs` 嵌进 `lib/core.js` 的默认注入常量）。改一个字都是改灵魂。 |
| 用户副本 | `$DSH_HOME/prompt-inject.md` | 注入正文在宿主机上的落地副本，由插件从上面那份种下去。用户自己改是用户的事；**插件不许改用户那份**。 |
| 预设 | `.agent-presets/redteam/agent.cordis.yml`、`anchor-gate.mjs` | 人格与能力协议经由它挂进会话（内容由补丁 #4 / #43 / #76 生成，仓库里没有预设源文件）。 |
| 补丁 #1 | `WORKSPACE_CONTEXT_INTRO` | 宿主自我介绍段，改它等于改"我是谁"。 |
| 补丁 #40 | `COMPLETE_PROMPT_KEEP_INJECT` | 收口阶段保住注入块，动的不是文案而是"它还在不在"。 |
| 补丁 #89 | `HUNG_PROMPT_AFTER_PERSONA` | 注入块挂在人格之后，位置本身就是语义。 |

## 判据

1. 任何一轮改动的 `git diff` 一旦出现上面禁改清单里的对象 → **越界，整轮回退**，不看改动多小。
2. 允许改的是**判据层与工具链**：备份/回滚判据（`targetLooksPatched`、`keyIsNoop`、`backupGap`）、
   写文件重试（`atomicWrite*` / `renameSyncWithRetry`）、解压（`lib/zip-extract.js`）、
   卸载收拾（`lib/host-state.js`）、测试与文档。
3. 汇报口径：一轮里只要碰到禁改清单，必须在提交信息里写"未触碰 SOUL-GUARD 清单"；
   碰了就必须回退，不许在报告里解释成"只是改了一个标点"。

## 这道闸门怎么跑（2026-10-27 落成，不再是纸）

```bash
node scripts/assert-soul-guard.mjs                       # 比对基线，越界 exit 1
node scripts/assert-soul-guard.mjs --update              # 改完灵魂后重写基线（soul-guard.lock 必须随提交一起进 git）
node scripts/assert-soul-guard.mjs --allow-soul-change   # 显式放行（提交信息里写清理由）
```

- 基线文件：`soul-guard.lock`。内容是 `lib/default-prompt-inject.md` 的 sha256，加上 **16 条灵魂补丁**
  （注入/身份/预设那一族：#1 #2 #3 #4 #25 #26 #32 #40 #43 #55 #66 #71 #73 #76 #87 #89）的语义指纹
  （id / name / file / rel / markers / replacements，RegExp 按 source+flags 序列化）。
  `desc`、`layer` 这类纯文案不在指纹里 —— 改措辞不算改灵魂。
- CI：`.github/workflows/release.yml` 的 **Soul guard** 一步跑它，红就是越界。
- 它还盯着「破甲预设补丁集合」：哪些补丁往 `.agent-presets` 里写文件，一变就红。

## 为什么写这个文件

2026-10-27 晚，上游 v1.1.80 恢复更新，本分支跟它已经**在 5 条补丁上语义分叉**
（#85/#86 的 steer 语义、#87/#89 的注入挂载位置、#40 的 pattern 容错）。
那批差异里有"更强"的写法，也有"更狠但会伤人"的写法；一旦开始"抄着抄着功能就多了"，
最先被牺牲的恰是灵魂。这张表就是那条不许越的线。

—— 2026-10-27 定，跨机器有效（宿舍机 + 家里机同一份代码）；2026-10-27 夜补上 CI 闸门与基线。
