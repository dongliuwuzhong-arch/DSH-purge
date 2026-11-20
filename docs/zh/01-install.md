# 安装与升级

## 它改的是什么

dsh-purge 是两层东西：

1. **提示词层**——往 `~/.dsh/AGENTS.md` 的注入链里塞一段人格/口径（`soul-guard.lock` 看着它，防别人偷改）。
2. **宿主文件层**——直接改 DeepSeek Harness 装完之后的 JS/YAML（88 条补丁），把审批、沙箱、工具话术这些改成本机要的样子。

第 2 层决定了它必须**解开 asar** 才有用：宿主默认从 `resources\app.asar` 读代码，那是只读档案，改不动。

## 新装（宿主已经是解包态）

> 这一节是**调试用**的最短路径：拷进 `node_modules` 的是实体副本，之后 `--sync` 的语义不成立。
> 正式安装按 README 的**离线安装器**或**手动安装**五步：源码放 `$DSH_HOME/plugins/dsh-purge`，
> 再在 profile 的 `node_modules/dsh-purge` 建 Junction 指回它。

```bash
# 调试用：插件直接拷进 profile 的 node_modules（实体副本，不是链接）
cp -r dsh-purge ~/.dsh/profiles/<profile>/node_modules/

# 备份原件（重要：这一步之后才有 .dshpurge.bak）
node -e "import('file:///.../dsh-purge/lib/core.js').then(async m => {
  const ai = '<安装目录>/resources/app/dsh/node_modules/@deepseek-ai';
  console.log(await m.backupAll(ai));
})"

# 打补丁
# 面板点「应用」，或在宿主里调 purge_apply
```

打完全跑一次判据（见下）。

## 从密封 asar 升级到 rc.3 的完整顺序

2026-11 那轮实际走过的顺序，一步都不能换：

1. **先备份** `resources\app`（或整个安装目录）
2. **插件先升到最新**（旧插件不认识新版代码，先升插件再升宿主）
3. **装新版 DSH**
4. **解封**：宿主正常退出后，把 `resources\app.asar` 改名成 `app.asar.dshpurge-away`（或移走），
   让宿主回落到 `resources\app` 解包目录
5. **重打补丁**，跑判据
6. 重启宿主，确认补丁在运行期生效

### 解封这一步的坑（都是真踩过的）

- **`app.asar` 在 rc.3 安装包里可能是目录，不是文件**。宿主命令行会带
  `--app-path=...\resources\app.asar`，于是 `resources\app` 里改的东西全都不生效，而面板还显示已打。
  判据第一条就是查这个。
- **运行时改名必然 EBUSY**，硬杀进程也不行（子进程还握着句柄）。
  正确做法：等宿主**正常退出**再改名，然后重新启动。
- **`resources\runtime` 可能是空的**。rc.3 的安装包自带底座（`app-64.7z` 解出 6711 个条目 / 268 MB 未压缩；`docs/SEALED-ASAR.md` 里把同一个包记作 292 MB，两个数是不同口径），
  但安装器不一定落进去；底座会退回 `~/.dsh/dsh-runtimes` 里的旧版本。拿 7-Zip 解出来放回去即可。

## 装完怎么验

```bash
node scripts/assert-patches.mjs      # 补丁表自检：条数 / id 唯一 / CHANGELOG 数字对得上
node scripts/assert-soul-guard.mjs   # 提示词层没被人动过
node --test "test/*.test.mjs"        # 136 条
```

要连宿主的实际状态一起看，用配套的 `check-paths.mjs`（不在本仓库，随本机运维工具走）。
实跑是 9 行 ✓ + 2 行 ·（`selectedDefault = minimal`、两份 `runtime.json` 各一条提示），下面是**摘录**：

```
[✓] 宿主读的是解包目录
[✓] 插件源与副本一致
[✓] 三处落点都有破甲痕迹
[✓] 三层版本一致
全部验过，都对得上。      ← 退出码 0
```
