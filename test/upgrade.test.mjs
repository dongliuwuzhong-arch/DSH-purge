import test from "node:test";
import assert from "node:assert/strict";
import { shouldSwapAfterUpgrade } from "../lib/reapply.js";

// 1.1.99 · 升级后必须真换包
// 桌面壳上 settleMayRestart() 恒 false，升级自愈只写盘不换包 → 补丁全废，又打回原型。

test("升级重打成功且 asar 还密封 → 必须换包", () => {
  assert.equal(shouldSwapAfterUpgrade({ sealed: true, ok: true }), true);
});

test("已经不在 asar 上（早就换过了）→ 不再折腾", () => {
  assert.equal(shouldSwapAfterUpgrade({ sealed: false, ok: true }), false);
});

test("重打失败 → 不换包，交给上一版继续跑", () => {
  assert.equal(shouldSwapAfterUpgrade({ sealed: true, ok: false }), false);
});

test("配置关掉 autoSwapAfterUpgrade → 一律不换", () => {
  assert.equal(shouldSwapAfterUpgrade({ sealed: true, ok: true, disabled: true }), false);
});

test("参数缺失按不换处理，不影响启动", () => {
  assert.equal(shouldSwapAfterUpgrade(), false);
  assert.equal(shouldSwapAfterUpgrade({}), false);
});
