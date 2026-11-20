# 1.4.1

影子 + 沙箱测试后的收尾。补丁表 88 条；测试 205 → 217。

- **#24** 在出厂 preset 上从未真正生效（pattern 是 liangshen 形态，出厂三份是 `fetch: true`）→ 新增出厂整块分支 + `satisfiedBy`。
- **#62 / #100 / #101 / #102** 的 marker 声明是改号前别名 → 新增 `markersWritten`，落地核对只认实际写入的标记。
- **`applyPatchesAllHosts` 会枚举到现网宿主** → 默认只打显式传入的 aiBase，全宿主需 `{ allHosts: true }`。
- `revertAll` 不再留等值 bak。

rc.5 实测：61 目标文件，applied 71 / already 5 / missing 7 / pattern_not_found 4（既有已知）；桌面壳 5 条全贴，
与现网壳逐行 diff 只差版本字面量一行；人格注入 1 份（22,997 字符，digest 705670d9）；无崩溃窗；现网零改动。
