import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// 2026-11-22（V15 收 · 代码审计 F2）：
// _tmp/patches.before.js + _tmp/patches-legacy.before.js（211 KB，含 1.4.x 补丁表全文）
// 被提交进了 1.5.0，还随 tar / zip 发出去。四条一起才修得住，这里逐条钉住其中三条
// （第四条 git rm --cached 是索引操作，只能在发布仓库里做，测试管不到）。
//   · .gitignore 挡住新增；
//   · .gitattributes 的 export-ignore 是 git archive（tar / zip）那条通道唯一的规则；
//   · release.yml 的 zip 内容断言是兜底：真漏了要红，不静默剔。

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");

function text(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

test(".gitignore 里有 _tmp/（挡住新增）", () => {
  const body = text(".gitignore");
  const lines = body.split(/\r?\n/).map((line) => line.trim());
  assert.ok(lines.includes("_tmp/"), ".gitignore 没有 _tmp/ 这一行");
});

test(".gitattributes 里 _tmp/** export-ignore（git archive 也只认这一条）", () => {
  const body = text(".gitattributes");
  assert.match(body, /^_tmp\/\*\* export-ignore$/m);
});

test("release.yml 的 zip 断言拦 _tmp/ 与带 %VAR% 的条目", () => {
  const body = text(path.join(".github", "workflows", "release.yml"));
  assert.match(body, /tmp_entries = \[n for n in names if "\/_tmp\/" in n/, "没有 _tmp 条目断言");
  assert.match(body, /包里出现了 _tmp\/ 开发期快照/, "断言没有对应的红理由");
  assert.match(body, /var_entries = \[n for n in names if re\.search\(r"%\[A-Za-z_\]/, "没有占位符路径断言");
  assert.match(body, /包里出现了带占位符的路径条目/, "断言没有对应的红理由");
  assert.match(body, /^\s*import re, sys, zipfile$/m, "assert-zip.py 忘了 import re");
});

test("package.json 的 files 白名单仍然明确排除 _tmp（npm 那条通道）", () => {
  const pkg = JSON.parse(text("package.json"));
  assert.ok(Array.isArray(pkg.files), "package.json 没有 files 白名单");
  // 白名单式（不是 .npmignore），所以只要没把 _tmp 列进去就够。
  assert.ok(!pkg.files.some((item) => String(item).startsWith("_tmp")), "files 里不该出现 _tmp");
});
