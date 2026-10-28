# 1.1.96-dsh

> 目标宿主 0.2.1-rc.3（桌面 desktop / Web web 两面具支持）· 补丁表 **82 条**（一条没加没删）

## 一句话

补丁 #57 在 **responses 通路上一直是空转的** —— 上游把变量名从 `role` 改成了 `instructionRole`，pattern 不匹配，而同一个补丁的 completions 文件带上了 marker，把这条漏清洗盖成了 `applied`。现在两个通路都修住了，并且有回归测试盯着。

## 问题：一条补丁、两个文件、只修住了一个

#57 `DEEPSEEK_SYSTEM_ROLE` 的目的是**不让第三方中转站收到 `developer` 角色消息**。它同时管两个文件：

| 通路 | 文件 | 状态 |
| --- | --- | --- |
| completions | `pi-ai/dist/api/openai-completions.js` | 命中，一直有效 |
| responses | `pi-ai/dist/api/openai-responses-shared.js` | **pattern 不匹配，从未生效** |

- 上游 0.2.0-rc.2 起，responses 那行的变量名是 `instructionRole`：
  `const instructionRole = model.reasoning && compat?.supportsDeveloperRole !== false ? "developer" : "system";`
  而 #57 里写的 pattern 是 `const role = ...`。
- 它却一直显示 `applied`：`skipIfMarked` 与状态汇总只看 **marker**，而 marker 是 completions 那条打上去的。
  **一个文件命中，整条补丁就算过了** —— 这是判据本身的盲区，不是这条补丁独有的。
- 后果：走 responses API 的中转站仍然拿到 `developer` 角色，系统提示被静默丢弃。
  审查实验证实过差值：同样内容 `system` 计 117 tokens、`developer` 只 87 tokens，差的正好是指令本身。

## 改法

`lib/patches.js` 的 #57 在原有两条 `const role = ...` 之外**并存**两条 `instructionRole` 变体：

- 新装：`const instructionRole = ... !== false ? "developer" : "system";` → 加 `api.openai.com` / `azure.com` 白名单 + marker
- 老用户升级：带 `// [dsh-purge] deepseek.com keeps system role` 尾巴的 instructionRole 行 → 升级成白名单

旧的 `role` 两条**没删**，供 0.2.0-rc.1 及更早的宿主。四条互不重叠，谁命中算谁的。

回归测试两条（`test/judge.test.mjs`）：

- responses 通路的四种写法（新/旧变量名 × 新装/老用户升级）逐条喂 `applyReplacementsToText`，
  断言 `changed === true` 且产物同时带 marker 与白名单；
- completions 通路的两态另有一条，防止改 responses 时把它碰坏。

## 顺手补的备份

profile 的 pi-ai 三份文件一直没有 `.dshpurge.bak`。原因：`profiles/desktop/node_modules` 是 junction，
realpath 落在 `profiles/pack-test/node_modules`，pnpm 重链后目标被重新物化成上游原件，备份跟着就没了。

用 npm 的 **pi-ai 1.3.0 pristine** 补回三份 bak。依据是重放校验：从 npm 取 pristine，逐条打补丁后与现网三个文件
**字节一致** —— 所以 pristine 就是真正的还原基线。

⚠️ 资源树里那三份老 bak（Oct 27 22:27）是**更早一个构建**的产物，比 npm 1.1.0 还少一行 `parseStreamingJson`。
从它们还原会把文件降级。**别拿老 bak 当基线。**

## 怎么自查（两分钟，不改任何文件）

```sh
node scripts/assert-patches.mjs        # 期望 patches=82 unique_ids=ok changelog=82
node scripts/assert-soul-guard.mjs     # 期望 digest 6320043cad95
node --test "test/**/*.test.mjs"       # 期望 39 条全过
```

想确认 responses 通路真的被清洗了，直接看文件：

```sh
grep -n "instructionRole" ~/.dsh/profiles/desktop/node_modules/@earendil-works/pi-ai/dist/api/openai-responses-shared.js
```

带 `// [dsh-purge] developer role allowlist: openai/azure` 就是清洗过了；只有裸的 `? "developer" : "system";` 就是没打上。

## 验证记录（本机实测，非推测）

- 单元测试 **39/39**（原 37 + 本轮 2 条）
- `patches=82 unique_ids=ok changelog=82`；灵魂闸门 `digest 6320043cad95`（与 1.1.95 一致）
- 真宿主：修复前 profile 的 `openai-responses-shared.js:131` 是未清洗原文；修复后重跑 `applyPatches`
  报 `applied: 1 / already: 1 / missing: 0`，该行已带 allowlist 注释
- 重放校验：npm pi-ai 1.3.0 pristine + 补丁表 == 现网三个文件，全部 identical

## 还没验的两件事（照旧写在这儿，不粉饰）

1. **真宿主上没跑过整趟卸载。** `revertAllShims` / `revertCmdFlash` 两段仍只在注入式测试里覆盖。
2. **真宿主升级时 bak 刷新那一场仍未验。** 判据错一次就会把干净的备份一次性污染，不可逆。
   先跑 `node scripts/check-bak-judge.mjs` 预演，等宿主 0.2.2 出来再说。

## 资产

| 项 | 值 |
| --- | --- |
| 包 | `dsh-purge-1.1.96-dsh.zip` |
| 目标宿主 | 0.2.1-rc.3（desktop / web） |
| 补丁表 | 82 条 |
| 大小 / sha256 | 见 Release 与 GitHub digest（`git archive` 打包，每次构建可能不同） |
