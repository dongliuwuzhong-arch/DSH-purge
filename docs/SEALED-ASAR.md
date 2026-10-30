# 密封 asar：补丁为什么不生效，以及 1.2.1 怎么解决

> 这份文档只讲一件事：**官方桌面版把代码封在 app.asar 里，而补丁只能写进解开的目录。**
> 只要宿主还在读 asar，所有宿主代码补丁都是**空转**——界面一切正常、日志没有报错，
> 但补丁一条都没进进程。这是本插件历史上最容易误判的故障形态。

---

## 一、先看清现象

假设你刚装好插件、点了「应用」，状态面板显示：

```
补丁 / patches: 61/66 applied, 0 pending
```

看起来一切正常。但如果你去查宿主**实际加载的代码**：

```powershell
Get-CimInstance Win32_Process -Filter "Name='DeepSeek Harness.exe'" |
  Where-Object { $_.CommandLine -match 'expose-internals' } |
  Select-Object -ExpandProperty CommandLine
```

如果输出里是 `...\resources\app.asar\dsh\...`，那就是**密封态**：
宿主读的是压缩包里的原件，你写进 `resources\app\` 的补丁它根本看不见。

### 怎么用一条命令确认

状态面板里如果出现这一行：

```
✗ app.asar: 还在。补丁写在解开目录，当前进程读不到
```

**有这行 = 补丁全在空转。** 这行不是装饰，是故障指示灯。

---

## 二、为什么会这样

### Electron 的加载顺序

桌面版打包时，宿主代码被封进一个 asar 归档文件：

```
C:\Software\DSH\
├─ DeepSeek Harness.exe
└─ resources\
   ├─ app.asar            <- 官方原件，182 MB，代码全在里面（只读）
   ├─ app.asar.unpacked\  <- 需要原生模块的少数文件，解在外面
   └─ app\                <- dsh-purge 解包 + 打补丁的副本（本机实测 18290 个文件 / 416 MiB）
```

Electron 启动时按一个固定顺序找可加载的 app：

```cpp
// electron/shell/common/node_bindings.cc（v44.7.0 实测）
const std::vector<std::string> search_paths = {"app.asar", "app", "default_app.asar"};
```

**`app.asar` 排第一。** 只要它在，就永远轮不到 `app` 目录。

配合 `OnlyLoadAppFromAsar` 这个 fuse 关闭，加载循环是：

> 该 fuse 位的实测方法：exe 里有一段 fuse wire magic `dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX`，
> 紧跟「版本(1) 长度(1) wire」。本机读到 `fuseVersion=1  count=9  wire=101100011`。
> Electron v44 的 fuse 表里 `OnlyLoadAppFromAsar` 在索引 5，`wire[5]` 是 0 = **disabled**。
> （索引 4 是 `EnableEmbeddedAsarIntegrityValidation`，同样是 0。）

加载循环是：

```js
for (a of appSearchPaths) try {
  c = load(join(resourcesPath, a, "package.json"));
  break;
} catch { continue; }
if (c == null) { process.exit(1); }
```

所以：

- `app.asar` 存在 → 读 asar 里的原件（**没有补丁**）
- `app.asar` 不存在 → 落到第二项 `app` → 读解开的目录（**有补丁**）

### 那插件为什么不自己把 asar 挪走

它设计上就是要挪的。`lib/extract-asar.js` 里的 `renameAsarAside()` 干的就是这件事。

完整流程是六步：

1. 把 `app.asar` 解到 `resources\app.dshpurge-next\`
2. 换成正式目录名 `resources\app\`
3. 对目录里的文件逐条打补丁（会留 `*.dshpurge.bak` 原件备份）
4. 记录「已应用」的版本戳
5. **把 `app.asar` 改名挪走** ← 关键，前四步的前提
6. 重启宿主，让 Electron 找不到 asar、转而读 `app\`

**第 5 步没做，前四步全是白工。** 而 1.2.0 及更早，第 5 步有两条路径会走不到：

| 场景 | 1.2.0 的行为 | 后果 |
|---|---|---|
| 首次安装后点「应用」 | 会挪 asar | 正常 |
| **官方更新装完** | `autoApplyOnStart` 默认 `false`，启动逻辑直接 return | 升级标记 `reapply-asar.pending` 写了但没人消费 |
| **密封态下点「应用」** | `settleMayReapply()` 在 desktop + sealed 时硬返回 `false` | 提示「等待应用」，但应用也过不去 |

---

## 三、官方更新为什么一定会把它顶回去

每次官方更新都会安装一个新的 `app.asar`。安装完成后：

1. 新的 `app.asar` 出现 → Electron 又开始读它
2. 补丁全在 `resources\app\` 里 → **再次空转**
3. 界面完全正常，没有任何报错

更隐蔽的是 `lib/official-update.wscript` 里这段：

```vbscript
if (!fso.FileExists(asar) && fso.FileExists(bak)) {
  fso.CopyFile(bak, asar, true);
  log('restored-asar');
}
```

**它看到「asar 不在 + bak 在」会把 bak 复制回去。** 这个分支本意是「更新失败时恢复原样」，
但如果 `app.asar.bak` 一直躺在 `resources\` 里，下次更新就会被它当成恢复源。

所以光改个名不够，**还得把 bak 挪出 `resources\`**。

---

## 四、1.2.1 做了什么

### 1. 升级标记可以穿透 autoApplyOnStart

```js
// lib/index.js
const upgradeMarkerNow = Boolean(officialUpdate.upgradeMarkerExists(process.execPath));

if (config.autoApplyOnStart !== true && !upgradeMarkerNow) {
  // 日常启动：尊重用户的「点一次才写宿主」设置
  return "skip:boot-no-host-write";
}
```

只有**读到升级标记**时才无视该开关。日常启动行为不变。

### 2. settleMayReapply 增加升级例外

```js
export function settleMayReapply({ surface, sealed = false, upgraded = false } = {}) {
  if (surface === "desktop" && sealed) return upgraded === true;
  return true;
}
```

原来的 `return false` 是为了防「就地 extract/swap 和官方 Host 的 Fiber._reload 抢锁」。
但**升级刚完成那一刻**不存在这个冲突：asar 是新文件，没有正在运行的 Fiber 持有它。

### 3. 新增启动期自愈 lib/sealed-heal.js

升级标记只覆盖「刚升级完这一次」。它还处理不了三种残留：

- 换了 asar 但没把 bak 挪出 `resources\`
- 上次换包中途失败，asar 还在、补丁树也在
- 用户手动重装了同版本，标记没人写

判定逻辑（纯函数，可单测）：

```js
export function decideHealAction(s) {
  if (!s.tree) return "broken-no-tree";            // 补丁树都没了，没法自愈
  if (s.asar) {
    if (!s.treeMarked) return "needs-apply-first"; // 树是空的，换包等于换成没补丁的
    return "needs-reapply";                        // 重打 + 换包
  }
  if (s.bak) return "needs-unbury-bak";            // 已换过，但 bak 还埋着
  if (!s.treeMarked) return "needs-apply-first";
  return "healthy";
}
```

**五种状态，每种一个明确的动作。** 其中 `needs-apply-first` 是刻意保守：
补丁树还没补丁时绝不换包，否则等于把宿主指向一份空目录，比现状更糟。

### 4. 修掉「清洗失败却报告重启成功」

1.2.0 的 `scheduleApplyRestart` 在密封分支里绕过了 clean 闸：

```js
// 1.2.0
if (core.desktopAsarStillSealed()) {
  const planned = core.restartSealedDesktopIfNeeded({ ctx });
  return { ...planned, restarting: Boolean(planned && (planned.restarting || planned.asarSwap)) };
}
```

`restartSealedDesktopIfNeeded` 只要能定位 exe/asar 就无条件返回 `asarSwap: true`，
于是「清洗没写进宿主」时面板照样报「正在重启」，实际什么都没换。1.2.1 先过 clean 闸。

---

## 五、对你意味着什么

### 装完之后该确认什么

```powershell
# 1. 宿主从哪加载？（应该是 resources\app\dsh，不是 app.asar）
Get-CimInstance Win32_Process -Filter "Name='DeepSeek Harness.exe'" |
  Where-Object { $_.CommandLine -match 'expose-internals' } |
  Select-Object -ExpandProperty CommandLine

# 2. 补丁有没有进进程？（应该 > 0）
node -e "const t=require('fs').readFileSync('C:/Software/DSH/resources/app/lib/main.js','utf8'); console.log((t.match(/dsh-purge/g)||[]).length)"
```

### 官方更新后会发生什么

| 情况 | 1.2.0 | 1.2.1 |
|---|---|---|
| 升级装完，标记在 | 不消费，补丁失效 | 自动重打 + 换包 + 重启 |
| 换包成功但 bak 埋着 | 下次更新被复原 | 启动自愈把 bak 挪进归档区 |
| 换包中途失败 | 卡住，无提示 | 下次启动重试 |

### 出问题了怎么回退

**回退到官方原件：**

```bat
rem 1. 完全关掉 DSH
taskkill /f /im "DeepSeek Harness.exe"

rem 2. 找回原件（归档区里最新的那份）（没有输出 = 还没归档过，属正常）
dir "%USERPROFILE%\.dsh\dsh-purge\asar-archive"

rem 3. 复制回去
copy "%USERPROFILE%\.dsh\dsh-purge\asar-archive\[文件名]" "C:\Software\DSH\resources\app.asar"

rem 4. 重开 DSH
```

**换包失败时宿主不会自动重开。** `lib/restart-desktop.js` 的实际行为是：

```js
if (info.asar && !asarReleased) {
  log("asar still sealed; not relaunching");
  process.exit(1);
}
```

改名没成功时它**直接不启动**，你会看到 DSH 没起来。这时候：
1. 手动双击 DSH 启动一次（asar 还在，宿主正常跑旧包，补丁不生效但能用）；
2. 下次启动自愈会重试；
3. 如果一直失败，按上面的回退步骤处理。

---

## 六、配置项

| 项 | 默认 | 作用 |
|---|---|---|
| `autoApplyOnStart` | `false` | 启动时要不要自动写宿主文件。false = 等你点「应用」。**升级标记不受此限制。** |
| `autoSwapAfterUpgrade` | `true` | 升级重打后要不要自动换包。关掉它是「升级后仍读写 asar，补丁失效」。 |
| `autoHealSealedAsarOnStart` | `true` | **1.2.1 新增**。启动时自检密封状态并自愈。 |

三个开关的关系：

```
autoApplyOnStart          -> 日常该不该写宿主
autoSwapAfterUpgrade      -> 升级后该不该换包
autoHealSealedAsarOnStart -> 启动时该不该自检修复残留状态
```

全关掉的话：插件只做提示词注入，宿主代码补丁完全不生效。这本身也是一种合法用法。

---

## 八、已知问题：patch 40 与 rc.5 失配

**现象**：`#40 COMPLETE_PROMPT_KEEP_INJECT` 在 DSH 0.2.1-rc.5 上六条 pattern 全部匹配失败，
状态显示 `skipped`。

**原因**：rc.5 的 `dsh-system-prompt/lib/index.js` 在 399–405 行插入了 `requiredContexts`，
`contexts` 那一行也从 `runtimeContextSuppressed ? [] : transformed.contexts`
改成了 `runtimeContextSuppressed ? transformed.contexts.filter(...) : transformed.contexts`。
patch 40 的六条锚点写的都是旧结构。

**影响**：

| 场景 | 影响 |
| --- | --- |
| 预设是 `complete: false`（如 minimal） | **无影响**。`completeSection` 恒 `undefined`，399 行直接 `return transformed`，401–405 那段死代码根本不执行 |
| 预设是 `complete: true` | 有影响。注入稿会被 `sections: [completeSection]` 丢掉 |

**这不是 1.2.1 引入的**：`lib/patches.js` 在 1.2.1 里一行未改，`git show 1.2.0:lib/patches.js`
与当前逐字节相同。

**1.2.1 为什么要提它**：因为 1.2.1 一度把「提示词清洗干净」当成换包的前置条件，
而这个前置条件的判据恰好依赖 patch 40 写的标记。于是 rc.5 上出现死循环——
patch 40 写不进标记 → 检查恒 false → 换包永远被拦 → 补丁永远进不了宿主。

**1.2.1 的处置**：把 clean 闸和换包解耦。

```js
// lib/desktop.js
const wantsAsarSwap = options.asarSwap === true;
if (!wantsAsarSwap && options.requireClean !== false && !unpackedHostIsClean(exe)) {
  return { restarting: false, clean: false };
}
```

换包路径（`restartSealedDesktopIfNeeded`）显式传 `asarSwap: true`，绕过这道闸；
普通重启（为了提示词而重启）仍然受它约束。

**尚未修**：patch 40 本身的 pattern 仍是旧结构。补它需要按 rc.5 重写六条锚点，
并重新验证 `complete: true` 预设下的注入保留行为。在补完之前，
用 `complete: true` 预设的用户会遇到注入稿被丢——这是 1.2.0 就有的老问题，不是回退。

---
## 七、给排障的人：三个判据，别信界面

这个插件的毛病一直是**不报错**。以下三条是实测判据，界面显示不算：

```powershell
# 判据 1：宿主到底读哪份（期望 0 个进程引用 app.asar）
Get-CimInstance Win32_Process -Filter "Name='DeepSeek Harness.exe'" |
  Where-Object { $_.CommandLine -match 'app.asar' } | Measure-Object | Select -Expand Count

# 判据 2：补丁有没有真的进进程（期望 > 0，本机实测 9）
node -e "const t=require('fs').readFileSync('C:/Software/DSH/resources/app/lib/main.js','utf8'); console.log((t.match(/dsh-purge/g)||[]).length)"

# 判据 3：bak 有没有埋着（期望：不存在）
Test-Path "C:\Software\DSH\resources\app.asar.bak"
```

三条都对，才算真的对。