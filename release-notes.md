# 1.4.4

台账"仍开放"四条收口：

1. ptc 档补回 `tool-executor-ptc`（此前 ptc 会话没有 run_code，退回整张工具表）；`tool-office` 故意不补（首载风险）。
2. 三处 preset `maxBytes` 65536 → 98304；全局那条自相矛盾的注释压成 4 行。
3. `applyPatches` 默认吃 exclude 清单，逃生门 `{ includeExcluded: true }`。
4. `preflight-baseline.json` 不再进任何分发物（npm files + .gitattributes export-ignore + release.yml 断言）。

补丁表 88 条；测试 227 → 233。
