# SOUL-GUARD · 默认注入与关键补丁保护

这是一道 diff 闸门，不是功能说明。它约束兼容维护时哪些东西不能顺手改，避免为了适配宿主而悄悄改变插件的默认行为。

## 2026-11-22 · 1.5 灵魂层对账（基线重写）

- **#40（COMPLETE_PROMPT_KEEP_INJECT）移出清单**：它的 7 个锚在 rc.5 的 `dsh-system-prompt/lib/index.js` 上**逐条 0 命中**，
  宿主文件里只剩 1.4.4 贴下的旧产物（`[dsh-purge] complete prompt keeps inject`）。1.5 起它进存档区
  （`lib/patches-legacy.js`），**不再影响人格注入的组装**，因此不再看守它。
- **#76（PRESET_UNRESTRICTED_IDENTITY_STRIP）同样移出清单**：1.5 起不在主表，`apply` 从不加载它；
  要恢复预设身份句清除，从存档区捞回。
- **#101 指纹随修账更新**：replace 与 `markersWritten` 从 `[dsh-purge-89]` 归位成 `[dsh-purge-101]`（旧 tag 仍认），
  语义未变——这是修账，不是改灵魂。
- 注入正文（`lib/default-prompt-inject.md` 与 `lib/asset-table.js` 的密封槽）**一字未动**，源 / 槽指纹不变。

按规矩显式放行并重写基线：`node scripts/assert-soul-guard.mjs --allow-soul-change --update`。

## 禁改清单

| 层 | 对象 | 说明 |
| --- | --- | --- |
| 注入正文 | `lib/default-prompt-inject.md` | 构建时由 `scripts/embed-default-prompt.mjs` 嵌入 `lib/core.js` 的默认注入常量 |
| 用户副本 | `$DSH_HOME/prompt-inject.md` | 插件不覆盖用户自己改过的副本 |
| 预设写入 | `.agent-presets/` 下的注入挂载文件 | 由补丁 #4 / #43 生成，仓库里没有预设源文件（#76 1.5 起进存档区） |
| 补丁 #1 | `WORKSPACE_CONTEXT_INTRO` | 宿主自我介绍段 |
| 补丁 #101 | `HUNG_PROMPT_AFTER_PERSONA` | 注入块挂载位置（旧编号 #89，主表里已不存在 #89） |

`desc`、`layer` 这类纯文案不在语义指纹里，可以改措辞；注入正文和上述补丁的 `id / name / file / rel / markers / replacements` 不能随手改。

## 允许改的范围

- 备份、回滚和补丁判据：`targetLooksPatched`、`keyIsNoop`、`backupGap`
- 写文件重试：`atomicWrite*`、`renameSyncWithRetry`
- 解压与宿主路径：`lib/extract-asar.js`、`lib/desktop.js`
- 卸载清理：`lib/host-state.js`
- 测试、安装说明和普通文档

## 校验

```sh
node scripts/assert-soul-guard.mjs
```

- 基线文件：`soul-guard.lock`
- 内容：默认注入正文的 sha256，加上关键补丁的语义指纹
- CI：发布工作流会跑同一脚本；失败即视为越界

确实需要改注入正文或关键补丁时，先说明原因，再显式更新基线：

```sh
node scripts/assert-soul-guard.mjs --update
```

`soul-guard.lock` 必须和改动一起提交。没有说明理由的基线更新，等同于绕过闸门。
