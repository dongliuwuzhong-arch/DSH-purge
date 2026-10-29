# SOUL-GUARD · 默认注入与关键补丁保护

这是一道 diff 闸门，不是功能说明。它约束兼容维护时哪些东西不能顺手改，避免为了适配宿主而悄悄改变插件的默认行为。

## 禁改清单

| 层 | 对象 | 说明 |
| --- | --- | --- |
| 注入正文 | `lib/default-prompt-inject.md` | 构建时由 `scripts/embed-default-prompt.mjs` 嵌入 `lib/core.js` 的默认注入常量 |
| 用户副本 | `$DSH_HOME/prompt-inject.md` | 插件不覆盖用户自己改过的副本 |
| 预设写入 | `.agent-presets/` 下的注入挂载文件 | 由补丁 #4 / #43 / #76 生成，仓库里没有预设源文件 |
| 补丁 #1 | `WORKSPACE_CONTEXT_INTRO` | 宿主自我介绍段 |
| 补丁 #40 | `COMPLETE_PROMPT_KEEP_INJECT` | 收口阶段是否保留注入块 |
| 补丁 #89 | `HUNG_PROMPT_AFTER_PERSONA` | 注入块挂载位置 |

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
