# 备份与回滚

## `.dshpurge.bak` 是什么

打补丁前把目标文件原样拷一份，命名 `<文件>.dshpurge.bak`。它是**唯一**能把文件退回原样的东西。

三条规矩：

- 只在**第一次**打之前建；已有就不覆盖。
- 目标文件如果已经带着本表补丁的痕迹，**拒建**（`refused`）——建了也是假原件。
- 用户 patch 层（`~/.dsh/profiles/*/cordis.patch.yml`）永不建 bak。

## 回滚

`revertAll(aiBase, options)`（`lib/core.js:3134-3197`）把 bak 覆盖回去再删掉 bak，一共返回 10 个桶：

| 桶 | 什么时候 | 怎么读 |
| --- | --- | --- |
| `reverted` | bak 覆盖回去了 | 正常回滚 |
| `skipped` | bak == 现文件、且文件没有补丁痕迹；或启动自愈里被保留的前端 `client.js`（`preserveClientBundles`） | 本来就不该动 |
| `noop` | bak == 现文件、有痕迹，但这条补丁对这个文件本来是空操作（`core.js:3179`） | **正常**，不是故障 |
| `unrevertable` | bak == 现文件、有痕迹、补丁确实改过它（`core.js:3180`） | **故障**：这份"备份"是假的，回滚不掉 |
| `noBackup` | 没有 bak，文件还在、还带着补丁（`core.js:3194`） | 有补丁没原件，不会混进 `skipped` |
| `preservedUser` | 用户 patch 层（`~/.dsh/profiles/*/cordis.patch.yml`）：只丢 bak，绝不覆盖回去（#43） | 正常 |
| `dropped` | 清掉的过期用户层 bak | 正常 |
| `errors` | 拷贝 / 删除抛错 | 逐条看 |

`skipped` / `noop` / `unrevertable` 三个都用 `sameFileBytes()` 判"bak 与现文件是不是同一份"，
差别只在"有没有补丁痕迹"和"这条补丁是不是空操作"。**把 `noop` 和 `unrevertable` 当成一回事就会误判**：
前者是正常，后者是原件已经没了。

`backupGap(aiBase)` 是另一条线（`core.js:3089-3123`），**四类**：

| 类 | 含义 |
| --- | --- |
| `missing` | 压根没有 bak |
| `patched` | 没有 bak，但文件已经带着补丁痕迹、而且这条补丁对它不是空操作（`core.js:3114`）→ **原件要另外找回** |
| `suspect` | bak 在、bak == 现文件、有痕迹且非空操作 → 这份"备份"是假的 |
| `noop` | bak == 现文件，但补丁对它本来是空操作 → 正常 |

四类里 `patched` 最容易漏：它只出现在"没有 bak"的那批文件里，面板上也不是单独一行，
而是 `missing` 列表里后缀"（已带补丁痕迹：原件要另外找回）"的那几条（`lib/index.js:167`）。

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
# 带参最稳；不带参时脚本先取 DSH_PURGE_AI_BASE，再退 findAiBase()，两样都拿不到才 exit 2
node scripts/check-bak-judge.mjs <安装目录>/resources/app/dsh/node_modules/@deepseek-ai
```

面板里看四行（`lib/index.js:162-182`）：

- `备份 / backup`：至少有一份 bak；
- `备份缺口 / backup gap`：`missing` 的条数，列表里每行可能带后缀"（已带补丁痕迹：原件要另外找回）"——带后缀的是 `patched`；
- `可疑备份 / suspect bak`：bak 和现文件一模一样、而文件确实被打过 → 这份备份是假的；
- `空操作备份 / no-op bak`：正常，不用管。
