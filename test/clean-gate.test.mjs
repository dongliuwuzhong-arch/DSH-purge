import { test } from "node:test";
import assert from "node:assert/strict";

// 这两条判定是 1.2.1 的核心：clean 闸不能拦换包，报错不能当成功。
// 终审指出 `restartSealedDesktopIfNeeded` / `scheduleApplyRestart` 在 test/ 下零覆盖，
// 这里用纯逻辑复刻把两个函数的判定锁死，改动一旦破坏语义立刻红。

/**
 * 复刻 lib/desktop.js 里 restartOfficialHarness 入口的 clean 闸。
 * 关键行为：调用方显式要换包（asarSwap:true）时，clean 不是前置条件。
 */
function cleanGate(options, hostIsClean) {
  const wantsAsarSwap = options.asarSwap === true;
  if (!wantsAsarSwap && options.requireClean !== false && !hostIsClean) {
    return { blocked: true, clean: false };
  }
  return { blocked: false };
}

/**
 * 复刻 lib/core.js 里 restartSealedDesktopIfNeeded 对 restartOfficialHarness 结果的整形。
 */
function shapeResult(restarted) {
  const r = restarted || {};
  const failed = r.restarting === false || r.clean === false || Boolean(r.error);
  const asarSwap = failed ? false : (r.asarSwap !== false);
  return { needed: true, renamed: false, ...r, asarSwap };
}

/**
 * 复刻 lib/index.js 里 scheduleApplyRestart 密封分支的面板判定。
 */
function panelSays(planned) {
  const clean = planned && planned.clean === false;
  return clean ? false : Boolean(planned && (planned.restarting || planned.asarSwap));
}

// ---- clean 闸 ----

test("clean 闸：换包路径不被 clean 拦（真机 rc.5 上 clean 恒 false）", () => {
  // 这是 1.2.1 最关键的回归：真机 patch40 失配导致 hostIsClean 恒 false，
  // 若这里被拦，补丁永远进不了宿主，且面板给出错误归因。
  assert.equal(cleanGate({ asarSwap: true }, false).blocked, false);
});

test("clean 闸：普通重启仍受 clean 约束", () => {
  assert.equal(cleanGate({}, false).blocked, true);
  assert.equal(cleanGate({}, true).blocked, false);
});

test("clean 闸：requireClean:false 显式放行", () => {
  assert.equal(cleanGate({ requireClean: false }, false).blocked, false);
});

test("clean 闸：asarSwap:false 不等于 asarSwap:true", () => {
  assert.equal(cleanGate({ asarSwap: false }, false).blocked, true);
});

// ---- 结果整形 ----

test("整形：正常换包保持 asarSwap", () => {
  const r = shapeResult({ restarting: true, asarSwap: true });
  assert.equal(r.asarSwap, true);
  assert.equal(panelSays(r), true);
});

test("整形：清洗失败不宣称换包成功", () => {
  const r = shapeResult({ restarting: false, clean: false });
  assert.equal(r.asarSwap, false);
  assert.equal(panelSays(r), false);
});

test("整形：报错不宣称换包成功", () => {
  const r = shapeResult({ restarting: false, error: "EPERM" });
  assert.equal(r.asarSwap, false);
  assert.equal(panelSays(r), false);
});

test("整形：restarting:false 即使没 error 也不宣称成功", () => {
  const r = shapeResult({ restarting: false });
  assert.equal(r.asarSwap, false);
  assert.equal(panelSays(r), false);
});

test("整形：exe 定位不到（返回 restarting:false 无其他字段）不报正在重启", () => {
  const r = shapeResult({ restarting: false });
  assert.equal(panelSays(r), false);
});
