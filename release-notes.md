# 1.3.0

适配 0.2.2-rc.3。补丁表仍是 86 条，只给三条非可选补丁加了 rc.3 形态的 pattern。

## 为什么是这三条

rc.3 把裸 `throw new Error(...)` 换成了带错误码的 `SandboxEscalationError(..., "SANDBOX_ESCALATION_*")`，
于是 #13（升级阶梯豁免）、#35（被拒仍授信）、#18（重复调用守卫）三条的 pattern 全部失配——
这三条一失效，沙箱升级到更宽模式会真的抛错、工具调用被打断。

## 怎么验的

从官方 night 源下 rc.3 安装包，解出 `resources\app.asar`（209 MB），把 86 条补丁引用的
57 个目标文件全部抽出来，用 `patchFileOutcome()` 逐条量：**目标文件一个都没少**，
能落地 63 条（6 条上游已含），新增失配 9 条（其中 3 条非可选，就是本次修的）。

## 测试

新增 `test/patch13-rc3.test.mjs`：三段 rc.3 原文各验命中 + 幂等 + marker 自洽，
外加一条「三条都必须保留旧的 rc.1 pattern」。

## 升级提醒

**这次升级会把你重新封回 asar。** rc.3 的安装包里 `resources\app.asar` 是单个 209 MB 文件，
装上之后宿主读 asar，解包目录里的那 70 多条补丁全部空转且不报错。顺序是：
先升破甲 → 再升 DSH → 用面板解封（注意别拿旧的 rc.1 树顶着）→ 重打 → `check-paths` 全绿再收工。
