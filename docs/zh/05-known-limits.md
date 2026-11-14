# 已知限制（截至 1.3.3）

诚实清单。都不影响当前这台机器（0.2.2-rc.3 / Windows），但换环境就会咬人。

## 1. `targetFiles()` 有 8 处键走裸 aiBase 路径

后果：19 个文件被判 `missing_file`（**文件其实在盘上**）。其中 `user-approval-invariant`
是 #5 / #9 / #12 的第二目标 → 那三条现在是"单腿绿"：主目标打上了，副目标根本没碰到，
而面板只会说 applied。哪天官方把那个文件加回来，就会变成真假绿。

## 2. `desktop-shell` 会被区域门整条丢掉

`allowTargetPathForAiBase`（非桌面安装树）会拒绝 `lib/main.js`。影子测试里那 5 条能命中，
是因为镜像里人工放了 `lib/main.js`，**不代表版本兼容**。

## 3. 判据的两个盲区

- 打完补丁原文就没了 → 人工改回去会掉成 `skipped` 而不是 `pending`，点应用也打不回来。
- 多目标补丁只要一个文件留着 marker，整条报 applied，其它目标漏了看不出来。

## 4. 两条跨版本还缺补丁

- `#40`：0.2.1-rc.3 的 waterfall 早退分支没有 `tools` 字段，现有第 7 条 pattern 死在这个字段上。
  要支持 0.2.1 得再加一条（不是改现有的）。
- `#56`：`client.js` 在前端构建里被压成 27 行 / 685 KB，四条 pattern 全含 `\n\t\t` 缩进，永远失配。
  宿主靠 `surfaceOp`（`replacementRange` / `shadowedSeqs`）自己处理，这条实际是空转。

## 5. `#17` 在运行期是空转的

`dsh-base/cordis.patch.yml` 里 `fs-observation-policy` 是 `disabled: true`——那个插件根本不组装。
文件改了，没人用。附带一句纠正：`tools.edit` 不先读也能改，是宿主 `editText(..., expected?.kind)`
自己的可选判断，**不是这条补丁的功劳**（2026-11-14 前我在文档里归因错过一次）。

## 6. `#6` 只对 macOS 有意义

它改的是 `seatbeltProfileArgs()`，Windows 上无效。

## 7. 平台覆盖

只在 Windows / x64 / 桌面端实测过。web 面（`DSH_SURFACE=web`）会少 5 条 desktop-only 补丁
（#45 #46 #82 #83 #84），其余判定不串。
