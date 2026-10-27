# 1.1.95-dsh

> 目标宿主 0.2.1-rc.3（桌面 desktop / Web web 两面具支持）· 补丁表 **82 条**（一条没加没删）

## 一句话

演练台整个砍掉了（侧栏瘦掉 60% 的体积），`lib/core.js` 从 8301 行拆到 4912 行，顺手认出了社区那几个 Electron 端。**一条补丁都没动**，灵魂闸门 digest 还是 `6320043cad95`。

## 砍了什么

### 演练台：前端 4213 行 + 后端一整条链

侧栏里那块 `__DSH_PURGE_DRILL_BEGIN__` 到 `END` 之间是 **4213 行**，占了 8764 行里的将近一半。它自己带一条授权链：

- 前端：`AuthGate`（含一整页法律声明 `AUTH_LEGAL_HTML`）、`readDrillAuth` / `writeDrillAuth` / `syncDrillGrant` / `requestDrill`、`drillGrantGen` 那组全局状态、`dock.drill` / `dock.full` / `dock.unauthorized` 与 `auth.*` 共 36 条 i18n
- 后端：`lib/drill-grant.js`（`$DSH_HOME/dsh-purge/drill-grant.json`）、`lib/index.js` 里 `/dsh-purge/drill-grant` 那条路由、`lib/uninstall.js` 里的 `clearDrillGrant` 调用
- 文档：两张预览图、两份 README 里的五处段落

全删之后 **`client.js` = 4287 行 / 199509 字节**（−4477 行，−59.9% 字节），侧栏只剩「清洗」一页。

### 唯一留下的：`EnvAdaptSendGate`

它看着像演练台的一部分，其实不是 —— 它只做一件事：**当前会话若挂着红队预设，发消息前拦一下，提示环境还没适配**。它不吃 `drill-grant` 路由，所以能独立活着，也是红队环节唯一的安全阀。留下的同时摘掉了它内部两处「未授权就跳演练台授权窗」的分支（现在只弹一个「跳过 / 去适配」的提示）。

## 拆了什么

### `lib/core.js`：8301 → 4912 行

| 新文件 | 字节 | 内容 |
| --- | --- | --- |
| `lib/atomic-io.js` | 3443 | `renameSyncWithRetry` / `renameWithRetry` / `atomicWriteSync` / `atomicWriteFile` / `atomicCopyFile` + 退避常量 |
| `lib/patches.js` | 166047 | 整张 82 条补丁表与其 22 个顶层依赖 |

两个副产物：

- **`core.js` ↔ `desktop.js` 的循环 import 断了。** `desktop.js` 以前从 `core.js` 拿 `atomicCopyFile` / `atomicWriteSync`，而 `core.js` 又 import `desktop.js` —— 以前能跑全靠 ESM 把函数声明提升，属于走钢丝。现在两边都指向 `atomic-io.js`。
- **外部引用一行没改。** `core.js` 仍 `export { ALL_PATCHES }`（转出 patches.js），所以 `scripts/assert-patches.mjs`、`scripts/assert-soul-guard.mjs`、`test/judge.test.mjs` 三处 `import { ALL_PATCHES } from "../lib/core.js"` 原样有效。

## 补了什么

### 认社区 Electron 端

`lib/surface.js` 新增 `isCommunityElectronHost()`，认 `ds-bot` / `dsbot` / `deepseek-bot` / `dsh-next` 四种进程名与安装路径（以前只认官方桌面安装目录）。

关键约束：**宽判据只在 `process.versions.electron` 存在时才生效**。纯 Node 进程哪怕路径里带 `dsh-next`，仍判 `web` —— 否则你在源码仓库里跑会把它误当桌面安装，去动根本不存在的 app.asar。

### CI 的语法检查不再逐个人工列文件名

以前 `release.yml` 里是七个 `node --check lib/xxx.js` 硬编码。这轮新加了 `lib/atomic-io.js` 与 `lib/patches.js`，**不写进清单就等于没检查，绿是假的**。改成遍历：

```sh
for f in lib/*.js lib/*.mjs bin/*.js client.js; do node --check "$f"; done
```

## 怎么自查（两分钟，不改任何文件）

```sh
node scripts/assert-patches.mjs        # 期望 patches=82 unique_ids=ok changelog=82
node scripts/assert-soul-guard.mjs     # 期望 digest 6320043cad95
node --test "test/**/*.test.mjs"       # 期望 37 条全过
```

装好后重启宿主，侧栏应当只剩「清洗」一个页签；若还能看到「演练台」，说明跑的还是 1.1.94 或更早的运行副本（`scripts/sync-runtime.mjs --apply` 同步后再重启）。

## 验证记录（本机实测，非推测）

- 单元测试 = **37/37**（judge 6 + cycle 5 + write 5 + host 6 + uninstall 2 + shim 7 + surface 6）
- 补丁表 `patches=82 unique_ids=ok changelog=82`；灵魂闸门 `digest 6320043cad95`（与 1.1.94 完全一致）
- 逐文件 `node --check`：`lib/` 37 个 .js + 1 个 .mjs、`bin/`、`client.js` 全过
- `client.js` 里 `__dshPurgeDrill` / `AuthGate` / `drillGrant` / `AUTH_KEY` 残留 **0 命中**

## 还没验的两件事（照旧写在这儿，不粉饰）

1. **真宿主上没跑过整趟卸载。** `revertAllShims` / `revertCmdFlash` 两段仍只在注入式测试里覆盖。
2. **真宿主升级时 bak 刷新那一场仍未验。** 判据错一次就会把干净的备份一次性污染，不可逆。先跑 `node scripts/check-bak-judge.mjs` 预演，等宿主 0.2.2 出来再说。

## 资产

| 项 | 值 |
| --- | --- |
| 包 | `dsh-purge-1.1.95-dsh.zip` |
| 目标宿主 | 0.2.1-rc.3（desktop / web） |
| 补丁表 | 82 条 |
| 大小 / sha256 | 见 Release 与 GitHub digest（`git archive` 打包，每次构建可能不同） |
