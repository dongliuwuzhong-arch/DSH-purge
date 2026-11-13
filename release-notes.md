# 1.2.8

补上 1.2.7 漏发的 #103，修掉「备份缺口」的假警报。补丁表 86 条。

## 补上 #103 WORKSPACE_INIT_ERROR_LOG

11-12 加了这条诊断补丁，只改了本地文件没提版本，于是「1.2.7」在本地和 `main` 上是两份东西
（本地 86 条 / 仓库 85 条）。这次连版本号一起补。

它把 `storageDomain.open` 那段包进 try/catch，失败时把堆栈写进
`~/.dsh/logs/workspace-init-error.log` 再原样 rethrow。不改行为，只在出事时留下证据。
起因：`workspace.json` 的 `createdAt` 写成数字、schema 拒收，UI 只有一句
`workspaceController unavailable`，没堆栈没日志，只能靠"最近改过什么"反推。

## 备份缺口不再冤枉「上游已经包含」的文件

`backupGap()` 在 bak 缺失时只看 `targetLooksPatched()`，而它只问「替换后的文本在不在」，
不问这条替换到底改没改东西。上游把补丁要做的事自己做了之后，
`patternHit=false / replaceAlreadyThere=true / changed=false`，文件一字节没被打过，
面板却报「已带补丁痕迹：原件要另外找回」。

改成 missing 分支也跑一次 `keyIsNoop()`。新增 `test/backupgap-noop.test.mjs` 两条用例：
一条确认「上游已包含」只进 `missing`、不进 `patched`；一条确认真被打过的文件照旧进 `patched`。

## 文档

`README.zh-CN.md` / `COMPAT-0.2.1.md` 的补丁表计数 85 → 86。

## 提醒

加完补丁**先重启宿主，再用 `purge_status` 确认新 id 出现在列表里，然后才点应用**。
插件是 ESM，宿主启动时 import 一次；改盘上的 `lib/patches.js` 不会让正在跑的进程认识新 id。
