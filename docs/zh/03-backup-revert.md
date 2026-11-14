# 备份与回滚

## `.dshpurge.bak` 是什么

打补丁前把目标文件原样拷一份，命名 `<文件>.dshpurge.bak`。它是**唯一**能把文件退回原样的东西。

三条规矩：

- 只在**第一次**打之前建；已有就不覆盖。
- 目标文件如果已经带着本表补丁的痕迹，**拒建**（`refused`）——建了也是假原件。
- 用户 patch 层（`~/.dsh/profiles/*/cordis.patch.yml`）永不建 bak。

## 回滚

`revertAll(aiBase)` 把 bak 覆盖回去，然后删掉 bak。判据是 `sameFileBytes`：
bak 与现文件字节相同就跳过——不过这时要看它落在哪个桶里：

- **`skipped`**：文件确实没被动过
- **`unrevertable`**：bak == 现文件，**而这个文件还带着补丁痕迹** → 这份"备份"是假的，回滚不掉，必须单独报出来

`backupGap()` 对应三类：`missing`（压根没 bak）、`suspect`（bak == 现文件又不算空操作）、
`noop`（补丁本来就是空操作，bak == 现网属正常）。

## 1.3.3 修的 P0：假备份是怎么来的

`inspectStaleBaks()` 原本在"判据认为当前文件没打过补丁"时，会把 bak **刷新成当前文件**：

```js
fs.writeFileSync(fp, originalBuf);   // originalBuf = 当前文件
```

于是只要判据误判一次（#103 那种不落标记的补丁必然误判），**唯一一份原件就被换成打完补丁的版本**。
之后 `revertAll` 看到 bak == 现文件，把它归进跳过，`restored 0 / skipped N` —— 回滚能力归零，
而面板还显示备份齐全。

影子里的现场（干净 rc.3 镜像）：

```
backupAll   → 文件 40014(打过) / bak 39521(原件)
apply ×1    → bak 39521
inspect     → bak 变成 40014     ← 原件没了
revertAll   → restored=0，文件仍是 40014
```

**1.3.3 之后**：默认只报告不落地，要刷新必须显式传 `{ apply: true }`；
`keys` 解析不出来时退回全表 marker 扫描，宁可少刷一份，也不动既有 bak。

## 自查

```bash
# 必须显式给 aiBase，不带参直接 exit 2
node scripts/check-bak-judge.mjs <安装目录>/resources/app/dsh/node_modules/@deepseek-ai
```

面板里看三行：`备份 / backup: 有`、`空操作备份 / no-op bak: N 个`（正常）、
`备份缺口 / backup gap`（missing / suspect，这两类要处理）。
