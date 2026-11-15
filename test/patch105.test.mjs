import test from "node:test";
import assert from "node:assert/strict";

import { ALL_PATCHES, applyReplacementsToText, patchFileOutcome } from "../lib/core.js";

// 2026-11-15 实测：minimal 预设 + 子代理会话里，人格基线被每步重发一份
// （13 步 14 份；最长一场 2228 步 1150 份、重复 36 MB 字符）。
// 根因：compose() 只在「本步 claimed 消息」里找基线，而注入是 splice 进 decision.messages 的，
// 下一步 claimed 里没有它 → 判「没基线」→ 再渲染再 push。宿主自己的 syncInbox 有按 session.surface
// 去重的判据，splice 这条路没走它。#105 把那条判据接到 splice 前面。

const P105 = ALL_PATCHES.find((p) => p.id === 105);

const HOST = [
  "\t\tfor (const message of pending) agent.inbox.remove(message.id);",
  "\t\tif (desired === void 0 || decision.messages.some((message) => sameContextPayload(message, desired))) return decision;",
  "\t\tconst lastClaimedIndex = decision.messages.findLastIndex((message) => messages.includes(message));",
  "",
].join("\n");

test("#105 在 pre-step 的 splice 前插入 surface 去重判据", () => {
  const once = applyReplacementsToText(HOST, P105, "index.js");
  assert.equal(once.changed, true);
  assert.match(once.text, /const dshPurgeOnSurface = desired !== void 0 && agent\.session\.surface\.nodes\.some/);
  assert.match(once.text, /if \(desired === void 0 \|\| dshPurgeOnSurface \|\| decision\.messages\.some/);
  assert.equal(applyReplacementsToText(once.text, P105, "index.js").changed, false, "必须幂等");
  assert.equal(patchFileOutcome(once.text, P105, "index.js"), "applied");
});
