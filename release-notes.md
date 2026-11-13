# 1.3.2

把审计 A2 的 6 条修订草案落进补丁表，并修掉 `targetFiles()` 里两个恒为 `undefined` 的 file 键。
补丁表仍是 87 条，一条没增没删。

## 六条重新打上

0.2.2-rc.3 把目标对象搬了家，#32 #40 #53 #54 #60 #62 在宿主上一致报 `skipped`。
新 pattern 全部追加，老 pattern 一条没删：

- **#32** Web 面身份句 → 搬到 `dsh-harness-dev-context`，加 file 键 + 3 条 replacement。
- **#40** complete 人设：rc.3 改成「先 `return { ...transformed, tools }` 再走 sections 整段替换」，
  于是 `dsh-purge:rules/identity/post` 会被静默丢掉、不报错。新 pattern 在 waterfall 结果里捞回 `dsh-purge*` 段。
- **#53** 禁止另开 server 那句 → 搬进 `dsh-harness-dev-context`。**老的裸句 r1 撤掉了**：
  它在 `LEGACY_WEB_SURFACE.suffix`（line 42）里还有一份，裸句会连 legacy 一起删（实测 256 字节），
  换成带反引号锚的版本（实测 129 字节，legacy 一个字节没动）。
- **#54** 交付物提示词 → 搬到 `dsh-deliverable-file-references`，pattern 一字未改，只加 file 键。
- **#60** run_code → 搬到 `dsh-tool-executor-ptc`，四句一字未改，只加 file 键。
- **#62** 拒绝理由从裸对象换成 `approvalDenial(reason, CODE)`，加 2 条替换，老 5 条原样。

## targetFiles()

`system-prompt` / `preset-sdk-minimal` 用 `firstExisting` + 裸 `path.join(aiBase, ...)`，在
「`app/dsh/node_modules/@deepseek-ai`」这套布局下恒为 `undefined`。改成 `nestedPkg`（两种布局都认）。
新增 `harness-dev-context` / `deliverable-refs` / `run-code` 三个键，同样走 nestedPkg。

## 三条退休（只加注释）

- **#56 / #77**：rc.3 官方已用 `surfaceOp: { op: "replace", startSeq, endSeq }` 做回退裁剪，
  `conversation-client` 是 27 行压缩 bundle，旧锚点全树 0 命中。留作记录，别再去修。
- **#80**：`minimal.patch.yml` 的 `tool-fs` 是官方自带（带 `config`），purge 追加过的那两个 id 本机从未存在。

## 判据

- 内存回放：6 条 × 每个目标文件 `changed=true`、幂等、原文残留 0、marker 命中，`pending → applied`。
- 宿主 `patchStatus`：applied 62/87 不变（**这轮没往宿主落盘**），skipped 10 → 4，pending 2 → 6。
- 三道门：`assert-patches` patches=87 ✓、`assert-soul-guard` 重写基线（#32 #40 属灵魂层）、
  `node --test` 115 → 123 条全过。
