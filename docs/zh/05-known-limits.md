# 已知限制（截至 1.4.2）

诚实清单。当前这台机器（Windows / 0.2.2-rc.3）不受影响，换环境就会咬人。

## 1. `missing_file` 的口径，以及"单腿绿"

`targetFiles(aiBase)`（`lib/core.js:3422`）在现网 rc.3 树上解析出 **57 个键 / 60 个路径**（实测）：
59 个落在 `@deepseek-ai` 下，1 个指向 `~/.dsh` 里的预设文件（`preset-liangshen-pkg`）。

- 一个目标都解析不到、补丁又不是 `optional` → `missing_file`（`core.js:4512`）；`optional` 的落 `na`。
- **现网实测 `missing_file = 0`**（applied 69 / na 15 / skipped 3 / 排除 1）。
- 影子镜像上曾出现 2 条（#71 的目标在 `~/.dsh` 里、#83 在宿主进程外解析不到）；A6 复核时按
  "optional 应算 na"的口径又记成 7 条。**这个数字取决于镜像怎么拼，不要当常量抄**；
  A6 / A7 里"19 个裸键"与"13 个裸键"也是两套口径，同样别抄。

真正的风险不在 `missing_file`，在**单腿绿**：多目标补丁里一个目标打上了、另一个目标压根解析不到，
`patchStatus` 仍然报 `applied`（那一票 `missing` 不参与降级，`core.js:4508-4512`），面板看不出副目标从没被碰过。
典型是 **`#5 / #9 / #12`** 的第二目标 `user-approval-invariant`：rc.3 的 `dsh-user-approval/lib`
只有 `index.js` 与 `types/index.js`，没有 `invariant.js`，所以这三条现在是 applied（实测），
但保住的只是主目标。

## 2. `desktop-shell` 会被区域门整条丢掉

`allowTargetPathForAiBase`（非桌面安装树）会拒绝 `lib/main.js`。影子测试里那几条能命中，
是因为镜像里人工放了 `lib/main.js`，**不代表版本兼容**。

## 3. 判据的盲区

- **多目标补丁的部分完成看不出来**：#70 只要一个目标 applied、另一个漏了，整条仍报 `applied`
  （另一个是 `pending` 时整条才降级）；只有另一个是 `skipped` 的那种才算假绿。
- 打完补丁原文就没了：人工改回原文会退回 `pending`（还能打回去）。
  其它终态各有各的来源：`strictFiles` 对不上是 `unmatched`、非 optional 一个目标都解析不到是 `missing_file`、
  `skipped` 只在没结算且原文也改不动时出现——全表见 [02-补丁表](02-patches.md)。

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
