#!/usr/bin/env node
// 补丁表自检：条目数 / id 唯一性 / 与 CHANGELOG 里写死的「补丁表 N 条」对不对得上。
// 起因：1.1.87 的记账里有一句「补丁表 83 条一条没动」，那句话是人写的，改表忘改文档没人拦。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const CHANGELOG = path.join(ROOT, "CHANGELOG.md");

function fail(msg) {
  console.error("✗ " + msg);
  process.exitCode = 1;
}

const core = await import(pathToFileURL(path.join(ROOT, "lib/core.js")).href);
const patches = Array.isArray(core.ALL_PATCHES) ? core.ALL_PATCHES : [];
const ids = patches.map((p) => p.id);
const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
const nameless = patches.filter((p) => !p.name || !String(p.name).trim());
const fileless = patches.filter((p) => !p.file || (Array.isArray(p.file) && p.file.length === 0));

let declared = null;
try {
  const text = fs.readFileSync(CHANGELOG, "utf8");
  const hit = text.match(/补丁表\s*(\d+)\s*条/);
  if (hit) declared = Number(hit[1]);
} catch (error) {
  fail("读不到 CHANGELOG.md: " + (error && error.message ? error.message : error));
}

const parts = ["patches=" + patches.length];
parts.push(dupes.length ? "duplicate_ids=" + dupes.join(",") : "unique_ids=ok");
if (nameless.length) parts.push("nameless=" + nameless.length);
if (fileless.length) parts.push("fileless=" + fileless.length);
parts.push(declared === null ? "changelog=(未声明)" : "changelog=" + declared);
console.log(parts.join(" "));

if (dupes.length) fail("补丁 id 重复：" + dupes.join(", "));
if (nameless.length) fail("有 " + nameless.length + " 条补丁没有 name");
if (fileless.length) fail("有 " + fileless.length + " 条补丁没有 file");
if (declared === null) {
  // 找不到声明时不许静默放行：这条断言的全部意义就是「文档和表对得上」，
  // 文档里没那句话，断言等于没写。
  fail("CHANGELOG.md 里找不到「补丁表 N 条」这句话；它是对表数的唯一声明，被删掉就等于没人核对");
} else if (declared !== patches.length) {
  fail("CHANGELOG 写的是 " + declared + " 条，实际 " + patches.length + " 条 —— 改表之后忘了改文档，或反过来");
}
if (!process.exitCode) console.log("✓ 补丁表自检通过");
