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

test("补丁 #57 两条 responses 通路都吃得住：变量名 role / instructionRole 各一遍", () => {
  // 回归：0.2.0-rc.2 起上游把 responses 通路的变量名从 role 改成了 instructionRole，
  // 而 #57 只写了 role 那一条 —— pattern 不匹配，替换静默不生效。整条补丁因为
  // completions 通路的 marker 命中而显示 applied，把漏清洗盖住了。
  const p57 = byId(57);
  assert.ok(p57, "找不到补丁 57");
  const marker = "[dsh-purge] developer role allowlist: openai/azure";
  const head = "export function convertResponsesRequest(model, compat) {\n";
  const tail = "\n}\n";
  const shapes = [
    'const role = model.reasoning && compat?.supportsDeveloperRole !== false ? "developer" : "system";',
    'const instructionRole = model.reasoning && compat?.supportsDeveloperRole !== false ? "developer" : "system";',
    // 老用户：已经被 deepseek 黑名单版清洗过的那两种写法，必须还能升级成白名单。
    'const role = model.reasoning && compat?.supportsDeveloperRole !== false && !String(model.baseUrl || "").toLowerCase().includes("deepseek.com") ? "developer" : "system"; // [dsh-purge] deepseek.com keeps system role',
    'const instructionRole = model.reasoning && compat?.supportsDeveloperRole !== false && !String(model.baseUrl || "").toLowerCase().includes("deepseek.com") ? "developer" : "system"; // [dsh-purge] deepseek.com keeps system role',
  ];
  for (const shape of shapes) {
    const r = applyReplacementsToText(head + shape + tail, p57, "openai-responses-shared.js");
    assert.equal(r.changed, true, "没吃到这条原文：\n" + shape);
    assert.ok(r.text.includes(marker), "替换后缺 marker：\n" + shape);
    assert.ok(r.text.includes("api.openai.com"), "替换后没有白名单：\n" + shape);
  }
});

test("补丁 #57 的 completions 通路照旧：useDeveloperRole 三态都吃得住", () => {
  const p57 = byId(57);
  const marker = "[dsh-purge] developer role allowlist: openai/azure";
  const shapes = [
    "const useDeveloperRole = model.reasoning && compat.supportsDeveloperRole;",
    'const useDeveloperRole = model.reasoning && compat.supportsDeveloperRole && !String(model.baseUrl || "").toLowerCase().includes("deepseek.com"); // [dsh-purge] deepseek.com keeps system role',
  ];
  for (const shape of shapes) {
    const r = applyReplacementsToText(shape + "\n", p57, "openai-completions.js");
    assert.equal(r.changed, true, "没吃到这条原文：\n" + shape);
    assert.ok(r.text.includes(marker), "替换后缺 marker：\n" + shape);
  }
});
