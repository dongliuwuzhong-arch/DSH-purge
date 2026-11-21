import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { readVersionFacts } from "../scripts/assert-versions.mjs";

// 2026-11-22（V15 工程 P1-6）：版本四处双写的门。五条判据：
// ① 四处一致 → 绿；②..⑤ 任意一处改漏 → 红（逐个位置各来一条，缺一个位置就等于没锁）。
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "..", "scripts", "assert-versions.mjs");
const NODE = process.execPath;

function fixtureRoot({ pkg = "1.0.0", dsh = "1.0.0", notes = "# 1.0.0", changelog = "## 1.0.0 · 2026-01-01 · 起手" } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "purge-ver-"));
  fs.writeFileSync(path.join(root, "package.json"),
    JSON.stringify({ name: "dsh-purge", version: pkg, dsh: { version: dsh } }), "utf8");
  fs.writeFileSync(path.join(root, "release-notes.md"), notes + "\n\n正文\n", "utf8");
  fs.writeFileSync(path.join(root, "CHANGELOG.md"), "# 更新日志\n\n" + changelog + "\n\n正文\n", "utf8");
  return root;
}

test("四处一致 → 没有 problems", () => {
  const facts = readVersionFacts(fixtureRoot());
  assert.deepEqual(facts.problems, [], JSON.stringify(facts.problems));
  assert.equal(facts.ok.length, 1);
});

test("dsh.version 改漏 → 红", () => {
  const facts = readVersionFacts(fixtureRoot({ dsh: "0.9.9" }));
  assert.equal(facts.problems.length, 1, JSON.stringify(facts.problems));
  assert.match(facts.problems[0], /dsh\.version/);
});

test("release-notes 首行没跟上 → 红", () => {
  const facts = readVersionFacts(fixtureRoot({ notes: "# 0.9.9" }));
  assert.equal(facts.problems.length, 1, JSON.stringify(facts.problems));
  assert.match(facts.problems[0], /release-notes/);
});

test("CHANGELOG 首条没跟上 → 红", () => {
  const facts = readVersionFacts(fixtureRoot({ changelog: "## 0.9.9 · 2026-01-01 · 旧" }));
  assert.equal(facts.problems.length, 1, JSON.stringify(facts.problems));
  assert.match(facts.problems[0], /CHANGELOG/);
});

test("package.json version 本身不像版本号 → 红", () => {
  const facts = readVersionFacts(fixtureRoot({ pkg: "next", dsh: "next", notes: "# next", changelog: "## next · 2026-01-01" }));
  assert.ok(facts.problems.some((p) => /不像版本号/.test(p)), JSON.stringify(facts.problems));
});

test("进程级：不一致时退出码 1，且逐条打出来", () => {
  const root = fixtureRoot({ changelog: "## 0.9.9 · 2026-01-01 · 旧" });
  const res = spawnSync(NODE, [SCRIPT, "--root", root], { encoding: "utf8" });
  assert.equal(res.status, 1, res.stdout + res.stderr);
  assert.match(res.stderr, /CHANGELOG/);
});

test("进程级：真仓库四处一致，退出码 0", () => {
  const res = spawnSync(NODE, [SCRIPT], { encoding: "utf8", cwd: HERE });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /四处一致/);
});
