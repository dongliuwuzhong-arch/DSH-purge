# 1.4.2

审计 A9（CI 根因）/ A10（状态一致性）之后按批准的 1-4 项做完。补丁表 88 条；测试 217 → 226。

1. **CI 出不了包**：钉 node 22、门禁命令去引号（`node --test test/*.test.mjs`）、upload 独立步骤 + 断言资产存在（空壳 release 直接失败）。
   实测纠正：`node --test test/` 在 v24 上是红的，不能那么写。
2. **文书收口**：版本、测试数、CHANGELOG 重复节、applied/satisfied 语义与行号全部对齐。
3. **判定收窄**：`satisfiedBy` 不再绕过 marker 落地（两个反例钉成测试）；新增 `satisfied` 档与落地率明细，字符串口径保持兼容；
   `scope:"none"` fail-loud；删零调用方的 `restoreMissingOriginalsAllHosts`。
4. **配置收口**：根作用域 pruner 补 32768；`check-pruner.mjs` 能看见默认档声明并分层汇总。
