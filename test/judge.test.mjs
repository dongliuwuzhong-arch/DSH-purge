import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ALL_PATCHES, applyReplacementsToText, keyIsNoop, targetLooksPatched } from "../lib/core.js";
import { hashFile, normalizeText, runtimeSyncLines } from "../lib/runtime-sync.js";

const byId = (id) => ALL_PATCHES.find((p) => p.id === id);
const keyOf = (patch) => (Array.isArray(patch.file) ? patch.file[0] : patch.file);

test("补丁表 id 唯一，且每条都有 name", () => {
  const ids = ALL_PATCHES.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const p of ALL_PATCHES) assert.ok(p.name, "patch #" + p.id + " 没有 name");
});

test("干净原文判定为未打过：markers 恰好是改前原话时也不能误判", () => {
  const p1 = byId(1);
  const p2 = byId(2);
  const clean = "// header\n" + p1.replacements[0].pattern + "\n" + p2.markers[0] + "\n";
  assert.equal(targetLooksPatched(clean, keyOf(p1)), false);
});

test("打完补丁的文本判定为已打过，且第二遍 apply 不再改动", () => {
  const p1 = byId(1);
  const key = keyOf(p1);
  const clean = "// header\n" + p1.replacements[0].pattern + "\n";
  const first = applyReplacementsToText(clean, p1);
  assert.equal(first.changed, true);
  assert.equal(targetLooksPatched(first.text, key), true);
  assert.equal(applyReplacementsToText(first.text, p1).changed, false);
});

test("空操作识别：原文里没有 pattern 的文件判为 noop", () => {
  const p1 = byId(1);
  const key = keyOf(p1);
  assert.equal(keyIsNoop("// 完全无关的一段文本\n", key), true);
  assert.equal(keyIsNoop("// header\n" + p1.replacements[0].pattern + "\n", key), false);
});

test("行尾不是同步判据：CRLF 与 LF 的哈希相同", () => {
  assert.equal(normalizeText("a\r\nb\r\n"), "a\nb\n");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "purge-hash-"));
  const lf = path.join(dir, "lf.txt");
  const crlf = path.join(dir, "crlf.txt");
  fs.writeFileSync(lf, "a\nb\n");
  fs.writeFileSync(crlf, "a\r\nb\r\n");
  assert.equal(hashFile(lf).hash, hashFile(crlf).hash);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("状态行四种形态各说各的话", () => {
  const none = runtimeSyncLines({ copies: [], plugin_root: "X", version: "9" });
  assert.match(none.join("\n"), /没有 profile 安装/);
  const ok = runtimeSyncLines({ copies: [{ profiles: ["p"], profile: "p", version: "9", ok: true, self: false, real: "R", diffs: [], extra: [] }], version: "9" });
  assert.match(ok.join("\n"), /已同步/);
  const self = runtimeSyncLines({ copies: [{ profiles: ["p"], profile: "p", version: "9", ok: true, self: true, real: "R", diffs: [], extra: [] }], version: "9" });
  assert.match(self.join("\n"), /直连源码/);
  const bad = runtimeSyncLines({ copies: [{ profiles: ["p"], profile: "p", version: "8", ok: false, self: false, real: "R", diffs: [{ rel: "lib/a.js" }], extra: [] }], version: "9" });
  assert.match(bad.join("\n"), /与源码差 1 个文件/);
  assert.match(bad.join("\n"), /sync-runtime\.mjs --apply/);
});
