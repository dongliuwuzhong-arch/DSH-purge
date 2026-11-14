# 已知限制（截至 1.3.3）

诚实清单。当前这台机器（Windows / 0.2.2-rc.3）不受影响，换环境就会咬人。

## 1. `targetFiles()` 有 19 个键走裸 aiBase 路径

后果：**影子镜像上 `missing_file` 恒为 2 条**（#71 的目标在 `~/.dsh` 里、#83 在宿主进程外解析不到），
其余是"文件没被这个键指到"而不是"文件不存在"。典型受害者是 **`#5 / #9 / #12`**：
它们的第二目标 `user-approval-invariant` 在 rc.3 里根本不存在（`dsh-user-approval/lib` 只有
`index.js` 与 `types/index.js`），所以这三条是**单腿绿**——主目标打上了，副目标从来没碰过，
而面板只会说 applied。

## 2. `desktop-shell` 会被区域门整条丢掉

`allowTargetPathForAiBase`（非桌面安装树）会拒绝 `lib/main.js`。影子测试里那几条能命中，
是因为镜像里人工放了 `lib/main.js`，**不代表版本兼容**。

## 3. 判据的盲区

- **marker 命中即 applied**：多目标补丁（#70）只要一个文件留着 marker，整条就报完成，其它目标漏了看不出来。
- 打完补丁原文就没了：人工改回原文会退回 `pending`（还能打回去）；`skipped` 只在 pattern 彻底消失时出现。

## 4. 两条跨版本还缺补丁

- `#40`：0.2.1-rc.3 的 waterfall 早退分支没有 `tools` 字段，现有第 7 条 pattern 死在这个字段上。
  要支持 0.2.1 得**再加一条**（不是改现有的）。
- `#56`：`client.js` 在 rc.2/rc.3 里是 704,147 字节 / 27 行的压缩构建，四条 pattern 全含缩进，永远失配。
  宿主靠 `surfaceOp`（`replacementRange` / `shadowedSeqs`）自己处理，这条实际是空转。

## 5. `#17` 在运行期是空转的

`dsh-base/cordis.patch.yml` 里 `fs-observation-policy` 是 `disabled: true`——那个插件根本不组装。
文件改了，没人用。附带一句纠正：`tools.edit` 不先读也能改，是宿主自己的可选判断，
**不是这条补丁的功劳**（2026-11-14 前我在文档里归因错过一次）。

## 6. `#6` 只对 macOS 有意义

它改的是 `seatbeltProfileArgs()`，Windows 上无效。

## 7. 平台覆盖

只在 Windows / x64 / 桌面端实测过。web 面（`DSH_SURFACE=web`）会少 5 条 desktop-only 补丁
（#45 #46 #82 #83 #84），其余判定不串。
