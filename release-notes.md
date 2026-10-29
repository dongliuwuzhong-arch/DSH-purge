# 1.1.97-dsh

目标宿主：DeepSeek Harness **0.2.1-rc.2 / 0.2.1-rc.3**（桌面 / Web）

补丁表：**82 条定义**

## 本版变更

- 修复同一文件挂两个 key 时回滚误报“没有备份”的问题。现在按规范化路径归并，避免第二次处理同一文件时把已被消耗的备份当成缺失。
- 修复 `dsh.cmd.dsh-purge.bak` 孤儿备份清理不掉的问题。清理范围包含桌面 shim 目录，并识别 `.dsh-purge.bak`；只删除，不用于还原。
- 补丁表保持 82 条，新增两条回归测试。
- 更新中文 / 英文 README、包描述和兼容说明，明确本仓库相对上游的维护范围。

## 验证

```sh
node scripts/assert-patches.mjs
# patches=82 unique_ids=ok changelog=82

node scripts/assert-soul-guard.mjs
node --test "test/**/*.test.mjs"
# 41 / 41 pass
```

本机只读预演结果：`targetFilePairs()` 从 61 条降到 60 条，唯一的多 key 项是 preset 文件；桌面 shim 目录清理测试能删除 `dsh.cmd.dsh-purge.bak`，且不改动 `dsh.cmd`。

## 安装

这个包不在 npm 上，使用仓库压缩包、本地目录或手动安装。完整步骤见 [README.zh-CN.md](README.zh-CN.md) / [README.md](README.md)。

## 尚未验证

- 桌面壳 `resources/app/lib/main.js` 的补丁只能在真实安装上验证。
- 宿主升级时备份判据和 `app.asar` 交接仍需在对应版本实测。
- 部分可选包未安装时，对应补丁只会显示跳过或 `missing_file`。

## 上游

- [YuJunZhiXue/dsh-purge](https://github.com/YuJunZhiXue/dsh-purge)
- 本分支基于上游 1.1.71 维护 0.2.1 兼容性
- 许可证：MIT
