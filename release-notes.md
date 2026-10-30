# 1.2.0

目标宿主：DeepSeek Harness **0.2.1-rc.2 / rc.3 / rc.5**（桌面 / Web）

补丁表：**82 条定义**（本版未增删补丁）

## 本版变更

- 判据：markers 命中不再等于 applied，还留一条非幂等 replacement 就如实报 pending。
- 网关：只有落在宿主 app 目录里的 pending 才挡重启，且报错点名是哪一条。
- 面判定：入参给了身份字段就按隔离判定算，不再拿本进程 resourcesPath/argv 顶包。
- 升级自愈：重打成功后若 asar 仍密封，自动走外部 PowerShell 换包。
- 升级标记搬到 `~/.dsh/dsh-purge/`：安装目录会被 NSIS 升级整棵清空，写在那儿等于没写。
- 文档对齐 rc.5；离线安装示例包名改 `dsh-purge-1.2.0.zip`。

## 验证

```sh
node scripts/assert-patches.mjs   # patches=82 unique_ids=ok changelog=82
node --test test/*.test.mjs       # 56 / 56 pass
```

真机（rc.5）：重解包 18,289 个文件、82 条重打至 applied 71 / na 6 / skipped 5 / pending 0。

## 尚未验证

- 升级自愈链没在真升级里跑过（这次升级发生在它上线之前）。

---

# 1.1.100-dsh

目标宿主：DeepSeek Harness **0.2.1-rc.2 / rc.3 / rc.5**（桌面 / Web）

补丁表：**82 条定义**（本版未增删补丁）

## 本版变更

- 升级标记从 `resources\` 搬到 `~/.dsh/dsh-purge/`：安装目录会被 NSIS 升级整棵清空，写在那儿等于没写。
- wscript 自己在脚本里算标记路径，不再依赖宿主填占位符。
- 保留对旧位置标记的读取与清理。
- 新增 4 条回归测试。

## 验证

```sh
node scripts/assert-patches.mjs   # patches=82
node --test test/*.test.mjs       # 56 / 56 pass
```

## 尚未验证

- 新标记位置要等下一次真升级才实战走一遍。

---

# 1.1.99-dsh

目标宿主：DeepSeek Harness **0.2.1-rc.2 / 0.2.1-rc.3**（桌面 / Web）

补丁表：**82 条定义**（本版未增删补丁）

## 本版变更

- **升级不再打回原型**：官方升级重打完，若 asar 仍密封，自动用 PowerShell 换包并重开。
- 新增配置 `autoSwapAfterUpgrade`（默认 true）；设 false 退回"只写盘不换包"。
- 新增 `shouldSwapAfterUpgrade()` 与 5 条回归测试。

## 验证

```sh
node scripts/assert-patches.mjs   # patches=82 unique_ids=ok changelog=82
node --test test/*.test.mjs       # 52 / 52 pass
```

## 尚未验证

- 真实官方升级没跑过（当前没有新版本），行为待下一次升级检验。

---

# 1.1.98-dsh

目标宿主：DeepSeek Harness **0.2.1-rc.2 / 0.2.1-rc.3**（桌面 / Web）

补丁表：**82 条定义**（本版未增删补丁，只改判据与诊断）

## 本版变更

- 修 #26 假绿：markers 命中不再等于 applied，还留一条非幂等 replacement 就如实报 pending。
- 修重启闸门：只有落在宿主 app 目录里的 pending 才挡重启，且报错点名是哪一条。
- 修 surface 判定：入参给了身份字段就按隔离判定算，不再拿本进程的 resourcesPath/argv 去顶。
- 新增 6 条回归测试。

## 验证

```sh
node scripts/assert-patches.mjs      # patches=82 unique_ids=ok changelog=82
node --test test/*.test.mjs          # 47 / 47 pass
```

## 尚未验证

- 宿主外 pending 放宽阻断之后，面板还没有展示项（后续版本补）。
- 桌面壳上重新 pack asar 的路径本版未触碰。

## 上游

- [YuJunZhiXue/dsh-purge](https://github.com/YuJunZhiXue/dsh-purge)
- 本分支基于上游 1.1.71 维护 0.2.1 兼容性
- 许可证：MIT
