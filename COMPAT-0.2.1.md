# 0.2.1 兼容说明

本仓库基于上游 [YuJunZhiXue/dsh-purge](https://github.com/YuJunZhiXue/dsh-purge) **1.1.71** 分叉，目标是让插件在 DeepSeek Harness **0.2.1-rc.2 / rc.3 / rc.5** 上正常启动、注入、应用和回滚。上游机制与提示词仍是原作者成果；本分支主要维护宿主版本适配和兼容性判据。

## 已处理的问题

### 1. `cwd` 提示词变量导致整轮对话失败

0.2.1 的 `dsh-agent-loop` 只注册 `provider` / `model` 两个 prompt 变量，官方移除了 `cwd`。旧注入稿里有 4 处仍会产出 `{{cwd}}`，渲染时抛出 `unknown prompt variable`，表现为整轮对话发不出去。

本分支已把这 4 处改成纯文本：

- `cordis.patch.yml` 的 `system-prompt.personaSuffix`
- `lib/identity.js` 的 `DSH_INTERPOLATE_ALLOWED`
- `lib/identity.js` 的 `CWD_ONLY_SUFFIX` / `stripHarnessPersona`
- `lib/core.js` 的 `ALLOW_EXEC_PERSONA_BLOCK` / `ALLOW_EXEC_PERSONA_LINE`

### 2. 桌面端反复解包、重启

旧判据把 `resources/app.asar` 是否改名当成“补丁是否生效”。官方桌面端默认从 `app.asar` 加载，文件不改名时补丁永远显示未生效，于是每次启动都重打并重启。

处置方式：首次应用后把 `resources/app.asar` 改名为 `app.asar.bak`，让 Electron 从已解包的 `resources/app` 加载。回滚时改回原名。

### 3. 同一文件挂两个 key 时误报“没有备份”

`dsh-web-app/presets/standard.patch.yml` 同时被 `agent-preset` 和 `preset-standard` 两个 key 引用。旧 `targetFilePairs()` 按条目展开、不按路径去重，回滚第一条时已经消耗掉备份，第二条再查就报 `noBackup`。

现在按规范化路径归并，产出 `{ key, keys, path }`；备份、回滚、缺口检查都按路径处理。

### 4. 孤儿 `.bak` 清理不掉

`repairOfficialCliAfterUnpack()` 会生成 `dsh.cmd.dsh-purge.bak`，旧清理逻辑只认 `.dshpurge.bak`，且默认遍历范围不包含 `resources/runtime/cli/bin`。

现在清理范围包含桌面 shim 目录，并识别 `.dsh-purge.bak`；只删除孤儿备份，不拿它做还原，因为解包后 `app.asar` 可能已经不存在。

## 补丁表

当前补丁表为 **85 条定义**。实际应用时按宿主面匹配，分为已应用、待应用、跳过；可选包缺失时会显示 `missing_file`，不阻塞本次应用。

```sh
node scripts/assert-patches.mjs
# 期望：patches=85 unique_ids=ok changelog=85
```

面板和命令行的数字可能不同：桌面面板按桌面面统计，`dsh-purge --status` 默认按 Web 面统计。只在同一面内比较数字，重点看 pending 是否为 0。

## 验证

```sh
node --check lib/index.js
node --check lib/core.js
node --check lib/rewind.js
node --check lib/skills.js
node --check client.js
node --check lib/runtime-sync.js
node --check bin/dsh-purge.js

node scripts/assert-patches.mjs
node scripts/assert-soul-guard.mjs
node --test "test/**/*.test.mjs"
node scripts/check-bak-judge.mjs
```

当前版本的本机测试为 **41 / 41 pass**；补丁表自检和关键补丁指纹校验均通过。

## 已知边界

- 桌面壳 `resources/app/lib/main.js` 的补丁只能在真实安装上验证，仓库测试覆盖不到 Electron 壳的全部路径。
- 官方桌面更新器写入 `app.asar` 还是已解包的 `app/`，未在所有版本上验证；升级后建议重新执行 `--status` 并检查补丁状态。
- 本分支只维护提示词注入、宿主补丁、规则集、Skill 管理和回滚能力。
- 不改第三方插件源码仓库；对已安装的兼容包只做尽力而为的运行时处理。
- 卸载后的重启清理队列、未来宿主版本的 `bak` 判据仍需在对应版本上实测。

## 上游与许可

- 上游：[YuJunZhiXue/dsh-purge](https://github.com/YuJunZhiXue/dsh-purge)
- 本仓库：[dongliuwuzhong-arch/DSH-purge](https://github.com/dongliuwuzhong-arch/DSH-purge)
- 许可证：MIT；上游作者与贡献者的版权归其各自所有
