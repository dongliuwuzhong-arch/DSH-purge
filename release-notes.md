# 1.3.8

新增「永久排除某条补丁」：

```json
// <DSH_HOME>/dsh-purge/exclude-patches.json
{ "excludePatches": [19] }
```

`applyPatchesAllHosts` / `patchStatus` 都会过滤这些 id——既不贴，也不显示成待贴。
清单写坏了按"没排除"处理。

起因：#19（把剪枝改成 `return null`）和温和剪枝（`thresholdChars: 32768`）不能共存。
以前只能删补丁表条目，一删就跟上游分叉；现在用清单文件表达。

补丁表 88 条不变；测试 133 → 136。
