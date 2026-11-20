import test from "node:test";
import assert from "node:assert/strict";

import { shouldReprobeWshJs, WSH_JS_PROBE_TTL_MS } from "../lib/desktop.js";

// 2026-11-16 宿舍机升级复盘（缺陷 1）：探针结果原来无条件永久缓存，
// 开机时磁盘/杀软忙 → 4000ms 超时 → false 钉死整个进程生命周期，之后全走脆弱路线。

test("没探过 → 要探", () => {
  assert.equal(shouldReprobeWshJs({ cached: undefined }), true);
});

test("探成功 → 永不重探（环境不会变回去）", () => {
  assert.equal(shouldReprobeWshJs({ cached: true, probedAt: 0 }), false);
  assert.equal(shouldReprobeWshJs({ cached: true, probedAt: 0, now: 1e12 }), false);
});

test("探失败 → TTL 内沿用，过了 TTL 重新探", () => {
  const probedAt = 1_000_000;
  assert.equal(shouldReprobeWshJs({ cached: false, probedAt, now: probedAt + 1000 }), false);
  assert.equal(shouldReprobeWshJs({ cached: false, probedAt, now: probedAt + WSH_JS_PROBE_TTL_MS - 1 }), false);
  assert.equal(shouldReprobeWshJs({ cached: false, probedAt, now: probedAt + WSH_JS_PROBE_TTL_MS }), true);
});
