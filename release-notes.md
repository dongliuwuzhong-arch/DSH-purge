# 1.2.7

修一个真 bug 和一条失配的 pattern。补丁表仍是 85 条，未增删。

## 假备份：`.dsh-purge.bak` 存的是改后内容

`lib/desktop.js` 的 `repairOfficialCliAfterUnpack()` 里写备份用的是 `atomicCopyFile`（async），
但那个函数本身是同步的，**少了一个 await**：

```js
try { atomicCopyFile(fp, bak); } catch {}   // async，第一个 await 是 fsp.mkdir，让出执行权
atomicWriteSync(fp, patched.text, "utf8");  // 同步写立刻落盘
```

等异步复制醒来去读 fp，它已经是改后的内容了。实测：`dsh.cmd` 562 字节、
`.dsh-purge.bak` 562 字节，`cmp` 报 IDENTICAL —— **看着有备份，实际还原不了原文**。

改成 `fs.copyFileSync(fp, bak)`。新增 `test/shim-bak.test.mjs`（3 个用例，含"不 await 会坏"的对照组）。

## #82 的 pattern 绑错了尾部锚点

原来的 pattern 是「那行 `import { REMOTE_STREAM_MUX_PATH, ... }` + `//#region ../../packages/util/home-paths/lib/index.js`」。
从 0.2.2 起，那行 import 后面跟的是 mime 的 region，home-paths 挪到 1700 多行去了，
于是整条补丁 **0 命中**。

它是 `optional: true` + `skipIfMarked`，所以只表现成 `na`，不报错 —— 面板上看着没事，
实际上「双击 exe 从 explorer 继承 env 常缺 DSH_PROFILE → cordis 不加载 → inject 全断」这个坑没兜住。

现在只锚 import 行本身（全文件唯一，实测 1 次）。新增 `test/patch82.test.mjs`（4 个用例）。

## 验证

```
node --test test/*.test.mjs     104 pass / 0 fail
node scripts/assert-patches.mjs patches=85 unique_ids=ok changelog=85
node scripts/assert-soul-guard.mjs  soul-guard ok (digest 7e5e018ffdf6)
```
