# 影子测试：四个纯净版本各装一次

不上宿主、不动真环境，把每个版本的**出厂 app 树**拆出来，在上面真跑一遍安装流程。

## 材料从哪来

| 版本 | 来源 |
| --- | --- |
| 0.2.1-rc.3 / 0.2.2-rc.1 / 0.2.2-rc.2 | 官方 CDN 的历史安装包：`https://download.deepseek.com/dsh-desk/bin/win-x64/deepseek-harness-<ver>-win-x64.exe` |
| 0.2.2-rc.3 | 本机解封时挪走的那份 `resources\app.asar.dshpurge-away` |

拆法（Windows / 7-Zip）：

```bash
7z e -o<dir> setup.exe "$PLUGINSDIR\app-64.7z"      # 内层是这个名字；用 "*.7z" 通配会静默解出 0 个
7z x -o<dir> <dir>\app-64.7z "resources\app.asar"    # 7-Zip 的 asar codec 会直接解成目录
node bin/asar-unpack.mjs <asar 文件> <输出目录>        # 或者用仓库自带的解包器
```

## 一个必须知道的坑

**路径里只要出现 `app.asar` 这一段，宿主自带的 fs 层就会去当 asar 档案解析**，
子进程里 `existsSync` 全是 false。所以影子树不能直接叫 `...\resources\app.asar\...`，
要么改名成 `tree`，要么只把需要的文件拷出来做镜像（本机做法：`mirror-<ver>`，rc.1/rc.2/rc.3 各 62 个文件，0.2.1-rc.3 是 59 个）。

## 跑什么

```
backupAll → applyPatches ×2 → inspectStaleBaks → revertAll
```

每一步都在"四棵干净树"上验五件事：改了几个文件、第二遍是否零改动（幂等）、
bak 有没有被动过、revert 后是否逐字节回原件、预设有没有被打成非法 YAML。

## 2026-11-14 的结果

```
              改   幂等  bak稳定  revert回原件  preset悬挂
0.2.1-rc.3    ✓    ✓      ✓         ✓            无
0.2.2-rc.1    ✓    ✓      ✓         ✓            无
0.2.2-rc.2    ✓    ✓      ✓         ✓            无
0.2.2-rc.3    ✓    ✓      ✓         ✓            无
```

87 条（**当时**的表长，现在是 88）× 4 版 = 348 格判定，**85 条四版完全一致**。只有两条不同：

- `#40 COMPLETE_PROMPT_KEEP_INJECT`：0.2.1-rc.3 判 skipped（那版 return 里还没有 `tools` 字段）
- `#56 REWIND_HIDE_CUT_ONLY`：rc.2/rc.3 判 skipped（`client.js` 压缩成 27 行，pattern 失配）

原生态就已是 applied 的 5 条：#2 #3 #21 #24 #50（上游本来就这么写）。

## 这一轮抓出来的两个 P0

见 [03-备份与回滚](03-backup-revert.md)（备份覆写）与 [02-补丁表](02-patches.md) 里的 #43（rc.2 预设打成非法 YAML）。
