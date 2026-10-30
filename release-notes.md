# 1.2.1

目标宿主：DeepSeek Harness **0.2.1-rc.2 / rc.3 / rc.5**（桌面 / Web）

补丁表：**82 条定义**（本版未增删补丁）

仓库从 `dsh-purge-021rc2` 改名成 **`DSH-purge`**。

## 本版只解决一件事：补丁静默失效

官方桌面版把宿主代码封在 `resources\app.asar`，补丁只能写进解开的 `resources\app\`。
Electron 的加载顺序是 `app.asar` → `app` → `default_app.asar`，**asar 在就永远轮不到目录**。

所以「面板显示 applied」不等于「补丁进进程」。这个故障最难发现的地方是**它不报错**。

### 修掉的四条路径

- **升级标记穿透 `autoApplyOnStart`**：`autoApplyOnStart` 默认 false，1.2.0 的启动逻辑直接 return，
  于是 `official-update.wscript` 装完写下的 `reapply-asar.pending` 永远没人消费。现在读到标记就放行。
- **`settleMayReapply` 增加 `upgraded` 例外**：原来 `desktop + sealed` 硬返回 false，
  导致密封态下点「应用」也过不去。升级刚完成那一刻 asar 是新文件、没有 Fiber 抢锁，可以放行。
- **新增启动期自愈 `lib/sealed-heal.js`**：处理升级标记覆盖不到的三种残留
  （bak 还埋在 resources、上次换包中途失败、手动重装同版本）。五种状态五种动作，
  其中「补丁树还没补丁」时**绝不换包**——换了等于把宿主指向一份空目录，比现状更糟。
- **修掉「清洗失败却报重启成功」**：`scheduleApplyRestart` 的密封分支原来绕过 clean 闸，
  `restartSealedDesktopIfNeeded` 只要能定位 exe/asar 就无条件返回 `asarSwap: true`，
  于是报错时面板照样显示「正在重启」。现在先过 clean 闸再决定。

### 新增配置

`autoHealSealedAsarOnStart`，默认 `true`。关闭后启动时不做密封状态自检。

### 安全护栏

换包会杀掉整个宿主进程树，所以：
- 同一宿主进程内只允许排一次（`healSwapScheduled`），不会出现「重启两次、第一次刚起来就被第二次杀掉」
- 非桌面壳不做换包
- `autoSwapAfterUpgrade: false` 时不自愈

### 测试

`test/sealed-heal.test.mjs` 18 个用例（五种判定分支、路径推导、标记计数、bak 归档、
重复归档不覆盖、EXDEV 跨盘兜底、非 EXDEV 错误不吞）。
另新增 `test/clean-gate.test.mjs` 9 个用例锁住「clean 闸不拦换包」与「报错不报成功」两条核心判定。
全套 **83 个测试通过**。

### 文档

新增 [`docs/SEALED-ASAR.md`](docs/SEALED-ASAR.md)（277 行）：从现象、Electron 加载顺序、
官方更新为什么会把它顶回去，到 1.2.1 的四项改动、配置项关系、回退步骤，
以及给排障者的三条实测判据。

### SOUL-GUARD 基线更新

`#26 MINIMAL_PERSONA_PURGE` 的指纹变了，但 `lib/patches.js` 在 1.2.1 里**一行未改**——
这是 1.2.0 就带着的基线漂移。真机验证过新锚点确实生效
（`minimal.patch.yml` 里 `id: agent-instructions` 从 0 处变成 1 处），所以更新基线而不是回退代码。

---
## 历史版本

# 1.1.100-dsh

目标宿主：DeepSeek Harness **0.2.1-rc.2 / rc.3 / rc.5**（桌面 / Web）

补丁表：**82 条定义**（本版未增删补丁）

## 本版变更

- 升级标记从 `resources\` 搬到 `~/.dsh/dsh-purge/`：安装目录会被 NSIS 升级整棵清空，写在那儿等于没写。
- wscript 自己在脚本里算标记路径，不再依赖宿主填占位符。
- 保留对旧位置标记的读取与清理。
- 新增 4 条回归测试。

## 验证

```sh
node scripts/assert-patches.mjs   # patches=82
node --test test/*.test.mjs       # 56 / 56 pass
```

## 尚未验证

- 新标记位置要等下一次真升级才实战走一遍。

---

# 1.1.99-dsh

目标宿主：DeepSeek Harness **0.2.1-rc.2 / 0.2.1-rc.3**（桌面 / Web）

补丁表：**82 条定义**（本版未增删补丁）

## 本版变更

- **升级不再打回原型**：官方升级重打完，若 asar 仍密封，自动用 PowerShell 换包并重开。
- 新增配置 `autoSwapAfterUpgrade`（默认 true）；设 false 退回"只写盘不换包"。
- 新增 `shouldSwapAfterUpgrade()` 与 5 条回归测试。

## 验证

```sh
node scripts/assert-patches.mjs   # patches=82 unique_ids=ok changelog=82
node --test test/*.test.mjs       # 52 / 52 pass
```

## 尚未验证

- 真实官方升级没跑过（当前没有新版本），行为待下一次升级检验。

---

# 1.1.98-dsh

目标宿主：DeepSeek Harness **0.2.1-rc.2 / 0.2.1-rc.3**（桌面 / Web）

补丁表：**82 条定义**（本版未增删补丁，只改判据与诊断）

## 本版变更

- 修 #26 假绿：markers 命中不再等于 applied，还留一条非幂等 replacement 就如实报 pending。
- 修重启闸门：只有落在宿主 app 目录里的 pending 才挡重启，且报错点名是哪一条。
- 修 surface 判定：入参给了身份字段就按隔离判定算，不再拿本进程的 resourcesPath/argv 去顶。
- 新增 6 条回归测试。

## 验证

```sh
node scripts/assert-patches.mjs      # patches=82 unique_ids=ok changelog=82
node --test test/*.test.mjs          # 47 / 47 pass
```

## 尚未验证

- 宿主外 pending 放宽阻断之后，面板还没有展示项（后续版本补）。
- 桌面壳上重新 pack asar 的路径本版未触碰。

## 上游

- [YuJunZhiXue/dsh-purge](https://github.com/YuJunZhiXue/dsh-purge)
- 本分支基于上游 1.1.71 维护 0.2.1 兼容性
- 许可证：MIT