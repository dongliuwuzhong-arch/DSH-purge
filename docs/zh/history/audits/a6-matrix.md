# 影子矩阵复核 · A6

> 独立复核员：agent-6。被测：`_shadow-matrix.json` / `_shadow-apply.json` / `_shadow-relmap.json`。
> 方法：**不看那两个结果文件，自己从 `mirror-*` / `work-*` + relmap 重算**，再回头跟它们对。
> 判定函数直接调用插件本体 `lib/core.js` 的 `patchFileOutcome()`（core.js:3797），不自己重写，避免语义漂移。
> 环境：`DSH_SURFACE=desktop`、`DSH_HOME` 指向不存在的空目录（杜绝写到真 `~/.dsh`）。
> 插件版本：`dsh-purge 1.3.2`（package.json:3），`ALL_PATCHES` **87 条**。

---

## 0. 一句话结论

1. **判定本身没错**：87 条 × 4 版 = 348 个格子里，applied/pending/skipped 三态 **348/348 与 `_shadow-matrix.json` 完全一致**。
   唯一的分歧是**标签口径**：文件里那 6 条"optional 且目标文件不存在"被写成了 `missing`，实际插件给的是 `na`（每版 6 条，共 24 处）。
2. **"missing 7 条"这 7 条我全查清了**：6 条是 optional 的 `na`（目标对象本机根本没有），1 条是非可选的 `#71`，目标是 **`~/.dsh` 用户档里的 liangshen 预设**。**没有一条是版本差异，也没有一条是 desktop-shell。**
3. **"宿主 77 / 影子最高 76"这个说法要改。** 按文件内容实测影子是 **76 / 77 / 76 / 76**（0.2.1-rc.3 / 0.2.2-rc.1 / rc.2 / rc.3），**rc.1 也是 77**。两者数量相同的背后是**两条对调**：宿主有 `#71`（影子无此文件）、影子有 `#56`（宿主那份 client.js 是 27 行压缩构建，pattern 打不上）。
4. **`_shadow-apply.json` 的 applied 值三版各少 1**（rc.1 76、rc.2/rc.3 75），差的那条推演是 **`#40 COMPLETE_PROMPT_KEEP_INJECT`**——它对 0.2.1-rc.3 判 skipped、对 0.2.2 三版判 applied（已实测），与文件记录的 skipped 集合自洽。
5. **幂等成立**：work-0.2.2-rc.3 连跑三遍 apply，第 2/3 遍磁盘零变化、状态零变化。
6. **"假绿"是真实存在的，但不是你想的那一种**：删掉 marker 后不会退回 pending，而是退回 **skipped（灰）且 apply 打不回来**；真正的假绿在**多目标补丁**上——一个文件还留着 marker，整条照样判 applied（`#70` 实测）。

---

## 1. 我怎么算的（可复现）

```js
// 关键点：路径不走 targetFiles()，走 relmap；判定用插件本体
const rels = relmap[key] || [];                        // key = patch.file 别名
const fps  = rels.map(r => path.join(root, r)).filter(fs.existsSync);
if (!rels || !fps.length) missing++;                   // 键无映射 / 镜像无此文件
else for (const fp of fps) {
  const o = core.patchFileOutcome(fs.readFileSync(fp,'utf8'), p, fp);   // applied|pending|skipped
}
// 聚合抄 core.js:4202-4206
pending>0 ? 'pending' : applied>0 ? 'applied' : unmatched>0 ? 'unmatched'
         : skipped>0 ? 'skipped' : (p.optional ? 'na' : 'missing_file')
```

镜像路径映射（`_shadow-mirrors.json`）：`%SHADOW%/mirror-<ver 下划线化>`；
已应用副本：`%SHADOW%\work-<ver 下划线化>`（四棵树都存在，实测）。

---

## 2. 复算 vs `_shadow-matrix.json`

### 2.1 逐版计数（镜像原始态，未打补丁）

| 版本 | applied | pending | skipped | na（可选无目标） | missing_file（非可选无目标） | 文件里记的 |
| --- | --- | --- | --- | --- | --- | --- |
| 0.2.1-rc.3 | 5 | 67 | 8 | 6 | 1 | pending 67 / applied 5 / skipped 8 / missing **7** |
| 0.2.2-rc.1 | 5 | **68** | **7** | 6 | 1 | pending 68 / applied 5 / skipped 7 / missing **7** |
| 0.2.2-rc.2 | 5 | 67 | 8 | 6 | 1 | pending 67 / applied 5 / skipped 8 / missing **7** |
| 0.2.2-rc.3 | 5 | 67 | 8 | 6 | 1 | pending 67 / applied 5 / skipped 8 / missing **7** |

合计校验：5+67+8+6+1 = 87 ✔（四条都闭合）。文件里的 `missing` = 我的 `na` + `missing_file` = 6+1。

原生态就已经 applied 的 5 条（四版一致）：**#2 #3 #21 #24 #50** —— 官方上游本来就那样，不是补丁干的。

### 2.2 差异表（逐条，24 条 = 6 条 × 4 版）

全部是**同一个标签口径问题**：这些补丁 `optional=true` 且目标路径解析不到，插件给 `na`，矩阵记 `missing`。

| 版本 | 补丁 | 名字 | 我的判定 | 矩阵判定 | file 键 |
| --- | --- | --- | --- | --- | --- |
| 四版各一条 | #76 | PRESET_UNRESTRICTED_IDENTITY_STRIP | na | missing | `preset-unrestricted` |
| 四版各一条 | #28 | LIANGSHEN_PHASE1_KEEP_INJECT | na | missing | `liangshen-tool-bootstrap` |
| 四版各一条 | #30 | HOOKS_CLAUDE_DENY_ALLOW | na | missing | `hooks-claude-code`, `hooks-claude-code-nested` |
| 四版各一条 | #31 | HOOKS_CODEX_DENY_ALLOW | na | missing | `hooks-codex`, `hooks-codex-nested` |
| 四版各一条 | #64 | HOOKS_STOP_STEER_NEUTRAL | na | missing | 上面四个 hooks 键 |
| 四版各一条 | #65 | HOOKS_PRESTEP_REJECT_NEUTRAL | na | missing | 上面四个 hooks 键 |

**除这 24 处外零差异**（applied / pending / skipped 三态 348/348 逐格对得上）。

---

## 3. missing 那 7 条到底是什么

七条 = 上表 6 条（`optional`，应当是 `na`）+ **#71**（非可选，`strictFiles`，真 `missing_file`）。

| 补丁 | file 键 | 插件实际期望的路径 | 为什么镜像里没有 |
| --- | --- | --- | --- |
| **#71** LIANGSHEN_IDENTITY_LINE（非可选，patches.js:330） | `preset-liangshen`<br>`preset-liangshen-pkg` | `~/.dsh/.agent-presets/liangshen/agent.cordis.yml`（core.js:2600-2605 userPresetYml）<br>`~/.dsh/profiles/desktop/node_modules/@linxin666/dsh-liangshen/presets/liangshen/agent.cordis.yml`（core.js:3349-3355） | **dshHome 侧键**。镜像里只有 app 树没有 `~/.dsh`，relmap 把它记成 `[]`（`_shadow-relmap.json` 里 `"preset-liangshen-pkg": []`）。**第二个候选在宿主上真实存在**，实测 `patchFileOutcome = applied`。 |
| #76 PRESET_UNRESTRICTED_IDENTITY_STRIP（可选，patches.js:269） | `preset-unrestricted` | `~/.dsh/.agent-presets/unrestricted/agent.cordis.yml` + desktopDshHomeGuesses | dshHome 侧键，**本机没装 unrestricted 预设**（路径不存在） |
| #28 LIANGSHEN_PHASE1_KEEP_INJECT（可选，patches.js:1120） | `liangshen-tool-bootstrap` | 5 个候选：`~/.dsh/profiles/{web,desktop,.dsh-module-fallback}/node_modules/@linxin666/dsh-liangshen/presets/liangshen/tool-bootstrap.mjs`、`~/.dsh/.agent-presets/liangshen/tool-bootstrap.mjs`（core.js:964-975） | 全都不存在（我只验了 `profiles/desktop` 那条，不存在；其余同前缀同理） |
| #30 HOOKS_CLAUDE_DENY_ALLOW（可选，patches.js:1238） | `hooks-claude-code`<br>`hooks-claude-code-nested` | `<aiBase>/dsh-hooks-claude-code/lib/index.js`<br>`<aiBase>/dsh/node_modules/@deepseek-ai/dsh-hooks-claude-code/lib/index.js`（core.js:3193-3203） | **包没装**。宿主 338 个 `@deepseek-ai` 包里没有 `dsh-hooks-claude-code`，四镜像也没有 |
| #31 HOOKS_CODEX_DENY_ALLOW（可选，patches.js:1260） | `hooks-codex`<br>`hooks-codex-nested` | 同上，包名 `dsh-hooks-codex` | 同上，不存在 |
| #64 HOOKS_STOP_STEER_NEUTRAL（可选，patches.js:3173） | 四个 hooks 键 | 同上 | 同上 |
| #65 HOOKS_PRESTEP_REJECT_NEUTRAL（可选，patches.js:3207） | 四个 hooks 键 | 同上 | 同上 |

验证命令（存在性直接 stat，不是推测）：

```
不存在 %INSTALL_DIR%\resources\app\dsh\node_modules\@deepseek-ai\dsh-hooks-claude-code\lib\index.js
不存在 %INSTALL_DIR%\resources\app\dsh\node_modules\@deepseek-ai\dsh-hooks-codex\lib\index.js
存在   %USERPROFILE%\.dsh\profiles\desktop\node_modules\@linxin666\dsh-liangshen\presets\liangshen\agent.cordis.yml   → #71 patchFileOutcome = applied
不存在 %USERPROFILE%\.dsh\profiles\desktop\node_modules\@linxin666\dsh-liangshen\presets\liangshen\tool-bootstrap.mjs
```

**不是 desktop-shell。** `desktop-shell` 键在 relmap 里被映射成 `lib/main.js`，所以 #45/#46/#82/#83/#84（唯一 5 条 `surfaces:["desktop"]` 的补丁）在影子里有目标、在"missing"里根本不会出现——**但这恰恰是个假象，见第 7 节**。

**交叉核对**：`记录\rc3-兼容评估.md` 第 4 节表格写的是"目标对象不存在 6 条：#76 #28 #30 #31 #64 #65（本机没装那些东西，永远 na）"——与我这 6 条**完全吻合**，两份独立材料对上了。

---

## 4. 宿主 77 vs 影子：差的是"两条对调"，不是一条

### 4.1 宿主实测（我自己算的，只读）

aiBase 由插件自己解析：`core.findAiBase() = %INSTALL_DIR%\resources\app\dsh\node_modules\@deepseek-ai`（注意是 **@deepseek-ai 那一层**，不是 `resources\app`；层级搞错会全部解析失败，我第一遍就栽在这儿）。

```
目标文件键 61   tally: { applied: 77, na: 6, skipped: 4 }   总 87
applied 77 / skipped {56,77,80,88} / na {28,30,31,64,65,76} / pending 0
```

**与"现网宿主实测 applied 77"完全一致 → 这个数我认。**

### 4.2 影子已应用副本（文件内容实测）

| 版本 | applied | skipped | skipped 集合 | `_shadow-apply.json` 记的 |
| --- | --- | --- | --- | --- |
| 0.2.1-rc.3 | **76** | 4 | 40 77 80 88 | applied 76 / skipped 4 ✔ |
| 0.2.2-rc.1 | **77** | 3 | 77 80 88 | applied 76 / skipped 4 ✘ |
| 0.2.2-rc.2 | **76** | 4 | 56 77 80 88 | applied 75 / skipped 5 ✘ |
| 0.2.2-rc.3 | **76** | 4 | 56 77 80 88 | applied 75 / skipped 5 ✘ |

### 4.3 宿主 vs 影子 rc.1 的 applied 集合差

```
宿主 applied 77   影子rc1 applied 77
  宿主有、影子没有: 71
  影子有、宿主没有: 56
  宿主 skipped: 56 77 80 88
  影子rc1 skipped: 77 80 88
```

- **#71**：目标是 `~/.dsh/profiles/desktop/node_modules/@linxin666/dsh-liangshen/presets/liangshen/agent.cordis.yml`——**在 app 树之外**。影子镜像装的是 app 树，永远够不到这条，跟"版本"无关。
- **#56** REWIND_HIDE_CUT_ONLY（patches.js:2627，可选；file 键 `conversation-client`）：
  ```
  #56 host:        bytes=685459  lines=27     outcome=skipped
  #56 mirror-rc1:  bytes=921756  lines=23145  outcome=pending
  #56 work-rc1:    bytes=923991  lines=23198  outcome=applied
  ```
  宿主那份 `dsh-client-ui-conversation/lib/client.js` 是 **27 行压缩构建**，跟 asar 里 23k 行的原件不是同一份构建；pattern 在宿主上根本不存在 → skipped。
  **所以"宿主 77 减影子 X = 一条"这个减法本身不成立**，两边的 77 是不同集合。

### 4.4 `_shadow-apply.json` 差的那 1（推演，自洽但未直接取证）

四版里三版少 1、skipped 多 1，且只在 0.2.2 上出现。逐条推演唯一自洽的解释是 **#40 COMPLETE_PROMPT_KEEP_INJECT**（keys `system-prompt` + `system-prompt-nested`）：

```
#40  system-prompt 判定： 0_2_1-rc_3=skipped   0_2_2-rc_1=applied   0_2_2-rc_2=applied   0_2_2-rc_3=applied
```

把 #40 一律当 skipped，四个版本的 applied/skipped 就与 `_shadow-apply.json` **逐版对上**（76/4、76/4、75/5、75/5）。
**标注：这是推演。** 留存件只存了聚合计数，没有逐条 status，所以我无法直接点名；下轮请把每条的最终 status 落盘（见第 8 节建议）。

---

## 5. 压力测试（work-0_2_2-rc_3）

### 5.1 连跑三遍 apply —— 幂等成立

跑法：`core.applyPatches(aiBase)`，`aiBase = work-0_2_2-rc_3\dsh\node_modules\@deepseek-ai`（宿主同构），`DSH_HOME` 指向不存在的空目录。每遍前后对**整棵 work 树 78 个文件**做 sha1 全量对比。

| 遍次 | 报告 applied / already | 磁盘 changed / added / gone | 状态表 |
| --- | --- | --- | --- |
| 起始 | — | — | applied 70 / na 11 / skipped 4 / missing_file 2 |
| 第 1 遍 | 0 / 70 | **0 / 0 / 0** | 同起始 |
| 第 2 遍 | 0 / 70 | **0 / 0 / 0** | 同起始 |
| 第 3 遍 | 0 / 70 | **0 / 0 / 0** | 同起始 |

**三遍零改动、状态不变 ✔**（而且第 1 遍就是零改动——说明上一轮 apply 已经把该落的都落了，没有残留 pending）。

> **过程披露（我动过 work 树，属允许范围）**：第一次跑的时候我把 `aiBase` 取成了 `work-0_2_2-rc_3` 根（少解析 13 个键），那一遍第 1 次 apply **写了 1 个文件**——`dsh/node_modules/@deepseek-ai/dsh-web-app/presets/cordis.patch.yml`，第 2/3 遍零改动；换成宿主同构的 `@deepseek-ai` 层做 aiBase（即上表）后三遍全零改动。
> 也就是说：**"幂等"在这棵树上成立**（收敛之后再打就是空转），但**上一轮留下的副本里至少有 1 个文件当时是不全的**——按宿主同构口径它现在已 settled，这一处差异是"路径解析广度"造成的，不是补丁表造成的。
补充：`applyPatches` 里 `repairPluginCordisYaml()` 会碰插件自己的 `cordis.patch.yml`，我先验了 `sanitizeYamlPersonaScalars(text) !== text` → **false**，即该文件不需要清理，全程没写插件目录。

顺带修正一个数字口径：用插件真实语义（`allowTargetPathForAiBase`，core.js:945-951）跑同一棵树只有 **applied 70**，因为**这台"影子树"不在桌面安装目录里**，`desktop-shell` 被白名单拒绝 → #45/#46/#82/#83/#84/#91 全部解析不到。relmap 法能到 76，靠的是把 `desktop-shell` 硬映射成镜像里的 `lib/main.js`。见 7.2。

### 5.2 删 marker 测试（"假绿"检测能力）

我选两条非可选、纯 marker 型补丁，删掉 marker 所在行后重算：

| 补丁 | 删掉的行 | 该文件 outcome | 整条 status | 再 apply 后 |
| --- | --- | --- | --- | --- |
| #70 PRESET_SHELL_NETWORK | `- id: persistent-pwsh # [dsh-purge] preset shell network` | **skipped** | **仍是 applied（假绿）** | marker 没回来 |
| #2 REPLACEMENT_WORKSPACE_CONTEXT_INTRO | `const REPLACEMENT_AGENT_INSTRUCTIONS_INTRO = "This complete workspace instructio…` | **skipped** | skipped | **打不回来**（`字节复位: false`） |

两个结论，都是坏事：

1. **不会退回 pending，只会退回 skipped。** 因为 marker 一没，补丁要找的**原文**也跟着不匹配了（`patchHasRemainingWork` 为假）→ 落进 core.js:3804-3805 的"原文对不上、再点应用也变不了"分支。**灰 ≠ 安全**：灰的意思正是"这条补丁救不回来了"。
2. **多目标补丁会假绿。** #70 的另一个目标文件上 marker 还在 → 聚合 `applied>0` 直接判 applied（core.js:4203）。**一个文件坏了，面板照样绿。** 这正是 #26 那类假绿的同胞：那次是"marker 在但插入块缺失"，这次是"一个文件在、另一个文件缺"。

**还原**：把 `presets/minimal.patch.yml` 与 `agent-instructions/lib/index.js` 从 `mirror-0_2_2-rc_3` 原件覆盖回来，再整体 apply 一次（applied 5 / already 65 —— 正好是被覆盖的那 5 条重新落地）。

```
#70 outcome=applied marker在=true
#2  outcome=applied marker在=true
恢复后全表: {"applied":70,"na":11,"skipped":4,"missing_file":2}   ← 与破坏前基线逐项一致
```

> **未验证**：恢复后是否与破坏前**字节级**同一（我删行前没把全树 hash 基线留下来对照）。可验证的是状态表与两条 outcome 完全回到基线、marker 都在。

---

## 6. `DSH_SURFACE=web` 跑 rc.3：只影响 5 条，且影响得很干净

```
mirror-rc3  desktop={"pending":67,"applied":5,"na":6,"skipped":8,"missing_file":1}
mirror-rc3  web    ={"pending":64,"applied":5,"na":11,"skipped":6,"missing_file":1}
mirror-rc3  差异: #45:pending→na #46:skipped→na #82:pending→na #83:pending→na #84:skipped→na

work-rc3    desktop={"applied":76,"na":6,"skipped":4,"missing_file":1}
work-rc3    web    ={"applied":71,"na":11,"skipped":4,"missing_file":1}
work-rc3    差异: #45:applied→na #46:applied→na #82:applied→na #83:applied→na #84:applied→na
```

- 全表 87 条里只有 **5 条**（`surfaces:["desktop"]`：#45 #46 #82 #83 #84）随 surface 变 `na`，其余 82 条判定**一字不变**。
- 也就是说：**surface 不会串**——它不改文件解析、不改 pattern 匹配，只按 `patchAppliesHere`（core.js:3936-3941）把桌面外壳专属补丁整条屏蔽。
- 附带一个真实风险：**web 面跑同一个 app 树，桌面外壳那 5 条会静默消失（判 na）**。所以在 web 宿主上引用"applied 数"会天然低 5（76→71），谁要拿这个数做交付门槛，得先说清 surface。

---

## 7. 我判定的"你漏掉的东西"

### 7.1 relmap 的键集是"宿主键集"，不是"补丁键集"——11 个键漏了

- 补丁一共用到 **71 个不同 file 键**；relmap 只有 **61 个**，且其中 `base-package` 一个补丁都不用它（多记）。
- 漏掉的 11 个键：`preset-unrestricted`、`preset-liangshen`、`liangshen-tool-bootstrap`、`user-approval-invariant`、`hooks-claude-code`、`hooks-claude-code-nested`、`hooks-codex`、`hooks-codex-nested`、`tool-web-nested`、`system-prompt-nested`、`dsh-tools-ptc`。
- 后果分三类：
  1. **3 个 dshHome 键**（preset-unrestricted / preset-liangshen / liangshen-tool-bootstrap）——影子本来就没有 `~/.dsh`，记不记都 false negative，影响可控；
  2. **4 个 hooks 键**——包没装，影响可控；
  3. **3 个 nested 键影响可忽略但要说清**：`tool-web-nested` / `system-prompt-nested` 与主键 `tool-web` / `system-prompt` 在桌面解包布局下**指向同一个文件**（core.js:3193-3203 的 `entry()` 只拼 `<aiBase>/dsh/node_modules/@deepseek-ai/<pkg>`），所以 `#29/#40/#66` 没被漏判；
  4. **`user-approval-invariant` 才是真漏点**：#5 / #9 / #12 都拿它当第二目标（`dsh-user-approval/lib/invariant.js`）。这个文件在宿主和四镜像里都不存在 → 那三条目前只靠 `user-approval` / `user-approval-code` 单腿站立，判 applied 是"一条腿绿"。**今天是巧合（文件本来就没有），哪天官方把它加回来，relmap 法会继续假绿。**

### 7.2 `desktop-shell` 是 relmap 人工"造"出来的目标，不是镜像自带的

- 插件推导桌面壳走 `officialShellMain()`（core.js:2607-2623）：从**当前进程的桌面安装目录**推 `lib/main.js` 或 `main.js`。影子树里那个 `lib/main.js` 是 relmap 手写映射进去的。
- 更要紧的是白名单：`allowTargetPathForAiBase()`（core.js:945-951）对"不在桌面安装目录里的 aiBase"会**拒绝一切 desktop-install 路径**。所以：
  - 用插件真实语义跑影子树 → `desktop-shell` 根本没注册 → #45/#46/#82/#83/#84 **全判不可达**（applied 70，不是 76）；
  - 用 relmap 法 → 这 5 条在影子里能判绿。
- **结论：影子矩阵里这 5 条的绿/黄，证明的是"镜像里也有个 lib/main.js"，不证明任何版本兼容性。** 引用四版数字时必须带上这个前提。

### 7.3 镜像不是完整 app 树（42–44 个包 vs 宿主 338）

`mirror-*/dsh/node_modules/@deepseek-ai` 里只有 **42 / 44 / 44 / 44** 个包（宿主 338）。镜像只抽了补丁目标文件。所以：
- **任何"文件缺失"结论都可能是抽取不全**，不能直接当"这版没有这个包"；
- 但反过来说，**四版之间"目标文件有没有少"这个问题，用这套镜像答不了**（它按需抽的，本来就齐）。`rc3-兼容评估.md` 里那句"57 个目标文件一个都没少"是拿 asar 抽的，不是拿这套镜像抽的——两件事别混。

### 7.4 关于"数量差一条"的记账方式

现在四版的 applied 数分别是 76 / 77 / 76 / 76，**但它们不是同一个集合**（skipped 集合 021rc3={40,77,80,88}、rc1={77,80,88}、rc2/rc3={56,77,80,88}）。
**只比总数会让 #40 和 #56 的版本差异互相抵掉**——建议以后固定输出"applied 集合"而不是"applied 计数"。

### 7.5 我顺手动的、和没动的

- 只写了本报告一个文件。
- 我在 `%SHADOW%` 根上临时落过两个中间件（`_host-status.json` / `_recalc.json`），**已删除**，现在根目录没有我的残留。
- 破坏性测试只发生在 `work-0_2_2-rc_3` 内，已从 `mirror-0_2_2-rc_3` 原件还原并重打，状态回基线。
- ⚠️ 同一时刻 `%SHADOW%` 下出现了别人的 `work-a7-rc3*` / `home-a7-rc3`。**如果 A7 在我 5.2 破坏/还原的那几分钟里从 `work-0_2_2-rc_3` 取过对照，需要复核。**

---

## 8. 未验证 / 局限 / 下轮建议

**未验证**
1. `_shadow-apply.json` 那 1 条差额的**具体补丁号**——#40 是自洽推演，不是直接取证（留存件只有聚合计数）。
2. 破坏测试还原后的**字节级**同一性（状态与 marker 已验，全树 hash 基线没留）。
3. `#71` 在宿主上"applied"是否真的落到了 liangshen 预设文件的正确位置（我只读了 outcome，没逐行比对插入内容）。
4. `~/.dsh/profiles/{web,.dsh-module-fallback}/.../tool-bootstrap.mjs` 三条候选路径我只验了 `profiles/desktop` 那条（同前缀，判断一致，但没逐一 stat）。

**下轮建议（都很便宜）**
1. 矩阵 runner 落盘**逐条 status**（id/name/status/per-file outcome），别再只存聚合——今天这条 1 之差就是被聚合害的。
2. 矩阵表里把 `missing` 拆成 `na`（可选、无目标）和 `missing_file`（非可选、无目标）两列，否则 7 条会一直混着读。
3. 影子结论固定输出 **applied 集合 + skipped 集合**，不只给计数。
4. relmap 增补 `user-approval-invariant` 键；`desktop-shell` 那 5 条在报告里单独标注"目标为人工映射，不代表版本兼容"。
