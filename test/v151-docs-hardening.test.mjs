import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { ALL_PATCHES } from "../lib/core.js";

// 2026-11-22（V15 收 · 文档审计 §5.1 H1 / H5 / H6）：
// assert-docs 的扫描集只覆盖根 7 篇 + docs/zh 顶层，handbook(1619 行) / deep-dive(615 行) /
// history 全在盲区；行号类在"没有 file:line"时恒绿；禁用词白名单宽到「同行带出处」就放行
// hard 词。这三条各自都是一个"写错了也不会红"的洞，这里逐条造反例。

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "..", "scripts", "assert-docs.mjs");
const NODE = process.execPath;
const PATCHES = ALL_PATCHES.length;
const TESTS = 42;

function write(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, "utf8");
}

/** 一棵六类全绿的文档树（比 test/assert-docs.test.mjs 那棵更小，够用就行）。 */
function tree(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "purge-docshard-"));
  write(path.join(root, "package.json"), JSON.stringify({
    name: "dsh-purge", version: "1.2.3", dsh: { version: "1.2.3" }, dshTarget: "0.2.9-rc.1",
  }, null, 2));
  write(path.join(root, "release-notes.md"), "# 1.2.3\n\n起手。\n");
  write(path.join(root, "CHANGELOG.md"),
    "# 更新日志\n\n## 1.2.3 · 2026-01-01\n\n补丁表 " + PATCHES + " 条；测试 " + TESTS + " 例。\n");
  write(path.join(root, "README.md"), "# dsh-purge\n\n看 \x60lib/core.js:2\x60 的 \x60ALL_PATCHES\x60。\n");
  write(path.join(root, "README.zh-CN.md"), "# 破甲\n");
  write(path.join(root, "docs", "zh", "README.md"),
    "# 文档总览\n\n- 当前适配 **DSH 0.2.9-rc.1**\n- 当前插件版 **1.2.3**\n");
  write(path.join(root, "docs", "zh", "00-maintenance.md"),
    "# 维护\n\n| 项 | 值 |\n| --- | --- |\n| \x60package.json\x60 → \x60dshTarget\x60 | \x600.2.9-rc.1\x60 |\n");
  write(path.join(root, "scripts", "preflight-upgrade.mjs"),
    "const pkg = { dshTarget: \"0.2.9-rc.1\" };\nexport const target = pkg.dshTarget;\n");
  write(path.join(root, "lib", "core.js"),
    "// 1\nexport const ALL_PATCHES = [];\n// 3\n// 4\n// 5\n// 6\n");
  for (const [rel, body] of Object.entries(overrides)) write(path.join(root, rel), body);
  return root;
}

function run(root) {
  const res = spawnSync(NODE, [SCRIPT, "--root", root, "--tests", String(TESTS)], { encoding: "utf8", timeout: 300000 });
  return { code: res.status, out: String(res.stdout || "") + String(res.stderr || "") };
}

const HANDBOOK = "docs/zh/handbook/99-判据.md";
const HISTORY = "docs/zh/history/02-patches.md";

test("基线：这棵最小树七类全绿（含第 7 类在缺脚本时跳过并计数）", () => {
  const res = run(tree());
  assert.equal(res.code, 0, res.out);
  assert.match(res.out, /六类全绿/);
  assert.match(res.out, /命令冒烟/, "第 7 类必须出现在输出里，跳过也要写出来");
});

test("H1 递归覆盖：handbook 里的「补丁表 N 条」写错 → 第 3 类红", () => {
  const res = run(tree({ [HANDBOOK]: "# 判据\n\n补丁表 " + (PATCHES - 1) + " 条。\n" }));
  assert.equal(res.code, 1, res.out);
  assert.match(res.out, /✗ \[3\]/);
  assert.match(res.out, /handbook/);
});

test("H1 递归覆盖：handbook 里的「N 例」写错 → 第 4 类红", () => {
  const res = run(tree({ [HANDBOOK]: "# 判据\n\n测试 " + (TESTS + 7) + " 例。\n" }));
  assert.equal(res.code, 1, res.out);
  assert.match(res.out, /✗ \[4\]/);
});

test("H6 禁用词：hard 词不能因为同行带「出处」就放行 → 第 6 类红", () => {
  const res = run(tree({ [HANDBOOK]: "# 判据\n\n本仓库仍跟随上游发版（出处：某 fork）。\n" }));
  assert.equal(res.code, 1, res.out);
  assert.match(res.out, /✗ \[6\]/);
  assert.match(res.out, /跟随/);
});

test("H6 反向：定位句里「不再跟随…（出处：…）」仍然放行（别把正确的口径一起打死）", () => {
  const res = run(tree({
    [HANDBOOK]: "# 判据\n\n只服务这一棵树，不再跟随任何外部发行节奏（出处：YuJunZhiXue/dsh-purge 1.1.71，MIT）。\n",
  }));
  assert.equal(res.code, 0, res.out);
});

test("H5 行号：「`lib/core.js` 第 N 行」这种写法也要核（换写法不能绕过整类）", () => {
  const res = run(tree({ [HANDBOOK]: "# 判据\n\n见 \x60lib/core.js\x60 第 9999 行。\n" }));
  assert.equal(res.code, 1, res.out);
  assert.match(res.out, /✗ \[5\]/);
});

test("H5 覆盖口径：0 处引用不再静默通过 —— 输出里必须写明「扫了几篇」，并记成 warn", () => {
  const root = tree();
  write(path.join(root, "README.md"), "# dsh-purge\n\n没有行号引用的一篇。\n");
  const res = run(root);
  assert.equal(res.code, 0, res.out);
  assert.match(res.out, /0 处 file:line 引用/);
  assert.match(res.out, /扫了 \d+ 篇/);
  assert.match(res.out, /warn .*行号引用 0 处/);
});

test("history 快照豁免：旧数字出现在 docs/zh/history 里不算红（但必须写进覆盖统计）", () => {
  const res = run(tree({
    [HISTORY]: "# 旧口径快照\n\n补丁表 88 条 / 测试 233 例。本文件数字不再维护。\n",
  }));
  assert.equal(res.code, 0, res.out);
  assert.match(res.out, /history 1 篇按快照豁免/);
});
