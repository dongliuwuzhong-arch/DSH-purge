import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { ALL_PATCHES } from "../lib/core.js";

// 2026-11-22（V15 工程 P1 / 文档审计 §9）：assert-docs 的六类断言，每一类都要有一条"能红"的用例。
// 只在真文档上跑一次是不够的：那样只能证明它现在红或绿，证不了它抓得住下一处写错。
// 所以这里造一棵最小文档树（六类全绿），再逐类改坏一处，断言只有那一类红。
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "..", "scripts", "assert-docs.mjs");
const NODE = process.execPath;
const PATCHES = ALL_PATCHES.length;
const TESTS = 42;

function writeFile(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, "utf8");
}

// 两版根 README 的版本位点是第 1 类的锚（1.5.3 起），所以夹具里也得有：
// 标题行 +「Plugin version / 当前插件版」表行。句式与真仓库一致，改坏任何一处都该红。
function readmeEn({ version = "1.2.3", table = "1.2.3", patches = PATCHES, tests = TESTS, ref = "lib/core.js:3" } = {}) {
  return [
    "# dsh-purge",
    "",
    "**Prompt and host-patch plugin for DeepSeek Harness · " + version + "**",
    "",
    "| Item | Value |",
    "| --- | --- |",
    "| Plugin version | " + table + " |",
    "| Patch table | " + patches + " patches, max id 105 (plus 4 archived entries outside the count) |",
    "| Tests | " + tests + " tests |",
    "",
    "看 \x60" + ref + "\x60 的 \x60ALL_PATCHES\x60。",
    "",
  ].join("\n");
}

function readmeZh({ version = "1.2.3", table = "1.2.3", patches = PATCHES, tests = TESTS } = {}) {
  return [
    "# 破甲",
    "",
    "**DeepSeek Harness 提示词与宿主补丁插件 · " + version + "**",
    "",
    "| 项 | 值 |",
    "| --- | --- |",
    "| 当前插件版 | " + table + " |",
    "| 补丁表 | " + patches + " 条，最大 id 105（另有 4 条在存档区，不参与计数） |",
    "| 测试 | " + tests + " 例 |",
    "",
    "宿主基线见 docs/zh/README.md。",
    "",
  ].join("\n");
}

/** 一棵六类全绿的最小文档树。 */
function fixtureRoot(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "purge-docs-"));
  writeFile(path.join(root, "package.json"), JSON.stringify({
    name: "dsh-purge", version: "1.2.3", dsh: { version: "1.2.3" }, dshTarget: "0.2.9-rc.1",
  }, null, 2));
  writeFile(path.join(root, "release-notes.md"), "# 1.2.3\n\n起手。\n");
  writeFile(path.join(root, "CHANGELOG.md"),
    "# 更新日志\n\n## 1.2.3 · 2026-01-01 · 起手\n\n" +
    "补丁表 " + PATCHES + " 条；测试 " + TESTS + " 例。\n\n" +
    "## 1.2.2 · 2025-12-31 · 旧节\n\n这一节是历史，含 upstream 这个词也不算违规？其实算——首节之外不看。\n");
  writeFile(path.join(root, "README.md"), readmeEn());
  writeFile(path.join(root, "README.zh-CN.md"), readmeZh());
  writeFile(path.join(root, "docs", "zh", "README.md"),
    "# 文档总览\n\n- 当前适配 **DSH 0.2.9-rc.1**\n- 当前插件版 **1.2.3**，测试 **" + TESTS + " 例**\n");
  writeFile(path.join(root, "docs", "zh", "00-maintenance.md"),
    "# 维护\n\n| 项 | 值 | 命令 |\n| --- | --- | --- |\n" +
    "| \x60package.json\x60 → \x60dshTarget\x60 | \x600.2.9-rc.1\x60（宿主版本） | \x60node -p\x60 |\n\n" +
    "补丁表 " + PATCHES + " 条；用例 " + TESTS + " 例。\n\n" +
    "出处：派生自 dsh-purge 1.1.71（MIT）。\n");
  writeFile(path.join(root, "docs", "zh", "01-install.md"), "# 安装\n\n测试 " + TESTS + " 例。\n");
  writeFile(path.join(root, "scripts", "preflight-upgrade.mjs"),
    "const pkg = { dshTarget: \"0.2.9-rc.1\" };\nexport const target = pkg.dshTarget;\n");
  writeFile(path.join(root, "lib", "core.js"),
    "// 1\nexport const ALL_PATCHES = [];\n// 3\n// 4\n// 5\n// 6\n");
  for (const [rel, body] of Object.entries(overrides)) writeFile(path.join(root, rel), body);
  return root;
}

function run(root, args = []) {
  const res = spawnSync(NODE, [SCRIPT, "--root", root, "--tests", String(TESTS), ...args], { encoding: "utf8" });
  return { code: res.status, out: (res.stdout || "") + (res.stderr || "") };
}

/** 断言：第 id 类红，其余各类仍绿。 */
function assertOnlyRed(res, id) {
  assert.equal(res.code, 1, res.out);
  assert.match(res.out, new RegExp("✗ \\[" + id + "\\]"), "第 " + id + " 类没有红：\n" + res.out);
  for (const other of [1, 2, 3, 4, 5, 6]) {
    if (other === id) continue;
    assert.match(res.out, new RegExp("✓ \\[" + other + "\\]"), "第 " + other + " 类被连带弄红了：\n" + res.out);
  }
}

test("六类全绿的文档树 → 退出码 0，且末行说明第 7 类跳过了几条", () => {
  const res = run(fixtureRoot());
  assert.equal(res.code, 0, res.out);
  // 夹具里三条冒烟命令都跑不了（没有 bin/scripts/宿主），第 7 类全跳过 —— 跳过不是通过。
  assert.match(res.out, /六类全绿；第 7 类命令冒烟跳过 \d+ 条（未核/, res.out);
  assert.doesNotMatch(res.out, /七类全绿/, res.out);
});

test("第 1 类：docs 里的「当前插件版」没跟上 → 只有它红", () => {
  assertOnlyRed(run(fixtureRoot({
    "docs/zh/README.md": "# 文档总览\n\n- 当前适配 **DSH 0.2.9-rc.1**\n- 当前插件版 **1.2.4**，测试 **" + TESTS + " 例**\n",
  })), 1);
});

test("第 2 类：docs 里的「当前适配」与 dshTarget 不一致 → 只有它红", () => {
  assertOnlyRed(run(fixtureRoot({
    "docs/zh/README.md": "# 文档总览\n\n- 当前适配 **DSH 0.2.8-rc.1**\n- 当前插件版 **1.2.3**，测试 **" + TESTS + " 例**\n",
  })), 2);
});

test("第 3 类：CHANGELOG 首节的「补丁表 N 条」写错 → 只有它红", () => {
  assertOnlyRed(run(fixtureRoot({
    "CHANGELOG.md": "# 更新日志\n\n## 1.2.3 · 2026-01-01 · 起手\n\n补丁表 " + (PATCHES - 1) + " 条；测试 " + TESTS + " 例。\n",
  })), 3);
});

test("第 4 类：文档里的用例数与实测不一致 → 只有它红", () => {
  assertOnlyRed(run(fixtureRoot({
    "docs/zh/01-install.md": "# 安装\n\n测试 " + (TESTS + 1) + " 例。\n",
  })), 4);
});

test("第 5 类：行号引用超出文件行数 → 只有它红", () => {
  assertOnlyRed(run(fixtureRoot({
    "README.md": readmeEn({ ref: "lib/core.js:9999" }),
  })), 5);
});

test("第 6 类：文档里出现跟随姿态的「上游」→ 只有它红", () => {
  assertOnlyRed(run(fixtureRoot({
    "docs/zh/01-install.md": "# 安装\n\n测试 " + TESTS + " 例。\n本仓库跟随上游节奏。\n",
  })), 6);
});

test("第 6 类：许可段里的出处陈述放行（别把版权行也一起打死）", () => {
  const res = run(fixtureRoot({
    "docs/zh/01-install.md": "# 安装\n\n测试 " + TESTS + " 例。\n\n## 上游与许可\n\n- 上游：YuJunZhiXue/dsh-purge\n- 许可证：MIT\n",
  }));
  assert.equal(res.code, 0, res.out);
});
