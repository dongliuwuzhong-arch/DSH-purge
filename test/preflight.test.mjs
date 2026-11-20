import test from "node:test";
import assert from "node:assert/strict";

import { classifyShellPatches, resolveShellMain } from "../scripts/preflight-upgrade.mjs";
import { ALL_PATCHES } from "../lib/core.js";

// 2026-11-16：桌面壳补丁（file: ["desktop-shell"]）在纯 node 里恒报 na ——
// officialShellMain() 要求 detectSurface()==="desktop"，子进程里永远不成立。
// 预检改成直接读候选树的壳入口自己判，这两个函数就是那条路。

const shellPatches = ALL_PATCHES.filter((p) => [].concat(p.file ?? []).includes("desktop-shell"));

test("壳补丁有条目（防止 file key 改名后静默失效）", () => {
  assert.ok(shellPatches.length >= 5, "桌面壳补丁应当有 5 条以上，实际 " + shellPatches.length);
});

test("原文（未打补丁）→ 记为待贴，不是不匹配", () => {
  const original = "child.once(\"close\", (code) => {\n\t\t\t\tresolve();\n\t\t\t});";
  const out = classifyShellPatches(original, shellPatches);
  assert.equal(out.applied.length, 0);
  assert.ok(out.pending.length + out.skipped.length === shellPatches.length);
});

test("壳入口不存在时返回空串（不抛）", () => {
  assert.equal(resolveShellMain("C:\\__definitely_not_here__"), "");
});
