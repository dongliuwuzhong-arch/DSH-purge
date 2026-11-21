import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { ALL_PATCHES } from "../lib/core.js";
import { greenSummary, patchClaims } from "../scripts/assert-docs.mjs";

// 2026-11-22（终审 A §6 实摸到的三个「改坏也不红」的盲区，1.5.3 收）：
//   ① 版本锚只有 docs/zh/README 一处 —— 两版根 README 写着 1.5.0 也全绿；
//   ② 补丁条数只认中文「补丁表 N 条」—— 英文 README 的「77 patches」改成 78 全绿；
//   ③ handbook/00 表格里「真源。当前 77 条」不在任何句式里 —— 改坏也全绿。
// 这里给每个新锚点配一条「改坏即红」用例，再钉三条不许误红的边界（4 条存档 / 7 条物理删 / 算式）。
// 只在真文档上跑一次不算数：那只能证明它现在绿，证不了它抓得住下一处写错。
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "..", "scripts", "assert-docs.mjs");
const NODE = process.execPath;
const PATCHES = ALL_PATCHES.length;
const TESTS = 42;

function writeFile(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, "utf8");
}

const BT = "\x60";

/** 英文根 README：标题行 + 「Plugin version」表行都是第 1 类的锚。 */
function readmeEn({ version = "1.2.3", table = "1.2.3", patches = PATCHES, tests = TESTS, keepTable = true } = {}) {
  const rows = [
    "# dsh-purge",
    "",
    "**Prompt and host-patch plugin for DeepSeek Harness · " + version + "**",
    "",
    "| Item | Value |",
    "| --- | --- |",
  ];
  if (keepTable) rows.push("| Plugin version | " + table + " |");
  rows.push("| Patch table | " + patches + " patches, max id 105 (plus 4 archived entries outside the count) |");
  rows.push("| Tests | " + tests + " tests |");
  rows.push("", "看 " + BT + "lib/core.js:3" + BT + " 的 " + BT + "ALL_PATCHES" + BT + "。", "");
  return rows.join("\n");
}

/** 中文根 README：标题行 + 「当前插件版」表行都是第 1 类的锚。 */
function readmeZh({ version = "1.2.3", table = "1.2.3", patches = PATCHES, tests = TESTS, keepTable = true } = {}) {
  const rows = [
    "# 破甲（dsh-purge）",
    "",
    "**DeepSeek Harness 提示词与宿主补丁插件 · " + version + "**",
    "",
    "| 项 | 值 |",
    "| --- | --- |",
  ];
  if (keepTable) rows.push("| 当前插件版 | " + table + " |");
  rows.push("| 补丁表 | " + patches + " 条，最大 id 105（另有 4 条在存档区，不参与计数） |");
  rows.push("| 测试 | " + tests + " 例 |");
  rows.push("", "宿主基线见 docs/zh/README.md。", "");
  return rows.join("\n");
}

function fixtureRoot(overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "purge-anchors-"));
  writeFile(path.join(root, "package.json"), JSON.stringify({
    name: "dsh-purge", version: "1.2.3", dsh: { version: "1.2.3" }, dshTarget: "0.2.9-rc.1",
  }, null, 2));
  writeFile(path.join(root, "release-notes.md"), "# 1.2.3\n\n起手。\n");
  writeFile(path.join(root, "CHANGELOG.md"),
    "# 更新日志\n\n## 1.2.3 · 2026-01-01 · 起手\n\n" +
    "补丁表 " + PATCHES + " 条；测试 " + TESTS + " 例。\n\n" +
    "## 1.2.2 · 2025-12-31 · 旧节\n\n历史节不核。\n");
  writeFile(path.join(root, "README.md"), readmeEn());
  writeFile(path.join(root, "README.zh-CN.md"), readmeZh());
  writeFile(path.join(root, "docs", "zh", "README.md"),
    "# 文档总览\n\n- 当前适配 **DSH 0.2.9-rc.1**\n- 当前插件版 **1.2.3**，测试 **" + TESTS + " 例**\n");
  writeFile(path.join(root, "docs", "zh", "00-maintenance.md"),
    "# 维护\n\n| 项 | 值 | 命令 |\n| --- | --- | --- |\n" +
    "| " + BT + "package.json" + BT + " → " + BT + "dshTarget" + BT + " | " + BT + "0.2.9-rc.1" + BT + "（宿主版本） | " + BT + "node -p" + BT + " |\n\n" +
    "补丁表 " + PATCHES + " 条；用例 " + TESTS + " 例。\n\n" +
    "出处：派生自 dsh-purge 1.1.71（MIT）。\n");
  writeFile(path.join(root, "docs", "zh", "01-install.md"), "# 安装\n\n测试 " + TESTS + " 例。\n");
  writeFile(path.join(root, "scripts", "preflight-upgrade.mjs"),
    "const pkg = { dshTarget: \"0.2.9-rc.1\" };\nexport const target = pkg.dshTarget;\n");
  writeFile(path.join(root, "lib", "core.js"), "// 1\nexport const ALL_PATCHES = [];\n// 3\n// 4\n// 5\n// 6\n");
  for (const [rel, body] of Object.entries(overrides)) writeFile(path.join(root, rel), body);
  return root;
}

function run(root) {
  const res = spawnSync(NODE, [SCRIPT, "--root", root, "--tests", String(TESTS)], { encoding: "utf8" });
  return { code: res.status, out: (res.stdout || "") + (res.stderr || "") };
}

function assertOnlyRed(res, id) {
  assert.equal(res.code, 1, res.out);
  assert.match(res.out, new RegExp("✗ \\[" + id + "\\]"), "第 " + id + " 类没有红：\n" + res.out);
  for (const other of [1, 2, 3, 4, 5, 6, 7]) {
    if (other === id) continue;
    assert.match(res.out, new RegExp("✓ \\[" + other + "\\]"), "第 " + other + " 类被连带弄红了：\n" + res.out);
  }
}

test("夹具本身：六个位点都写对 → 退出码 0", () => {
  const res = run(fixtureRoot());
  assert.equal(res.code, 0, res.out);
});

// ---- 盲区 ① 版本锚只有一处：两版根 README 的标题行与表格版本行各来一条 ----

test("第 1 类：README.md 标题行的版本没跟上 → 只有它红", () => {
  assertOnlyRed(run(fixtureRoot({ "README.md": readmeEn({ version: "9.9.9" }) })), 1);
});

test("第 1 类：README.md 表里的 Plugin version 没跟上 → 只有它红", () => {
  assertOnlyRed(run(fixtureRoot({ "README.md": readmeEn({ table: "9.9.9" }) })), 1);
});

test("第 1 类：README.zh-CN.md 标题行的版本没跟上 → 只有它红", () => {
  assertOnlyRed(run(fixtureRoot({ "README.zh-CN.md": readmeZh({ version: "9.9.9" }) })), 1);
});

test("第 1 类：README.zh-CN.md 表里的当前插件版没跟上 → 只有它红", () => {
  assertOnlyRed(run(fixtureRoot({ "README.zh-CN.md": readmeZh({ table: "9.9.9" }) })), 1);
});

test("第 1 类：release-notes 首行没跟上 → 只有它红", () => {
  assertOnlyRed(run(fixtureRoot({ "release-notes.md": "# 9.9.9\n\n起手。\n" })), 1);
});

test("第 1 类：锚点被删（表格版本行没了）→ 红，不是静默放过", () => {
  const res = run(fixtureRoot({ "README.md": readmeEn({ keepTable: false }) }));
  assertOnlyRed(res, 1);
  assert.match(res.out, /Plugin version 表行/, res.out);
});

// ---- 盲区 ②③ 补丁条数：英文 N patches / 表格里的「当前 77 条」 ----

test("第 3 类：英文 README 的「78 patches」→ 只有它红", () => {
  assertOnlyRed(run(fixtureRoot({ "README.md": readmeEn({ patches: PATCHES + 1 }) })), 3);
});

test("第 3 类：中文 README 表里的「78 条」→ 只有它红", () => {
  assertOnlyRed(run(fixtureRoot({ "README.zh-CN.md": readmeZh({ patches: PATCHES + 1 }) })), 3);
});

/** handbook/00 那种表行（第一格是补丁表，数字不在「补丁表 N 条」句式里）。 */
function maint(extraRow) {
  return "# 维护\n\n| 项 | 值 | 命令 |\n| --- | --- | --- |\n" +
    "| " + BT + "package.json" + BT + " → " + BT + "dshTarget" + BT + " | " + BT + "0.2.9-rc.1" + BT + "（宿主版本） | " + BT + "node -p" + BT + " |\n" +
    extraRow + "\n出处：派生自 dsh-purge 1.1.71（MIT）。\n";
}

test("第 3 类：handbook/00 表格里的「真源。当前 78 条」→ 只有它红", () => {
  const row = "| 补丁表 | " + BT + "lib/patches.js" + BT + " | 真源。当前 " + (PATCHES + 1) + " 条，最大 id 105 |\n";
  assertOnlyRed(run(fixtureRoot({ "docs/zh/00-maintenance.md": maint(row) })), 3);
});

test("第 3 类：算式与小数目不算声明（88 − 7 删 − 4 冷存 不误红）", () => {
  const row = "| 补丁表 | " + PATCHES + " 条（88 − 7 删 − 4 冷存） |\n\n" +
    "其余 63 条不在这道门里；现网 31 条重复贴会叠层。\n";
  const res = run(fixtureRoot({ "docs/zh/00-maintenance.md": maint(row) }));
  assert.equal(res.code, 0, res.out);
});

test("第 4 类：英文 README 的「341 tests」→ 只有它红", () => {
  assertOnlyRed(run(fixtureRoot({ "README.md": readmeEn({ tests: TESTS + 1 }) })), 4);
});

// ---- 句式解析本身 ----

test("patchClaims：三种句式都认，同一处数字不重复报", () => {
  const line = "| 补丁表 | 77 条（88 − 7 删 − 4 冷存） | 77 patches |";
  const values = patchClaims(line).map((c) => c.value);
  assert.deepEqual(values, [77, 77], JSON.stringify(values));
  // handbook/00 的那种表行：数字不挨着「补丁表」两个字，靠「第一格是补丁表」认出来。
  assert.deepEqual(
    patchClaims("| 补丁表 | " + BT + "lib/patches.js" + BT + " | 真源。当前 77 条，最大 id 105 |").map((c) => c.value),
    [77],
  );
  // 描述句里的数字不是声明：绑成"提过补丁就算"会把这两句读成表数。
  assert.deepEqual(patchClaims("其余 63 条被改了它不报").map((c) => c.value), [], "描述句不该被绑成声明");
  assert.deepEqual(patchClaims("现网 31 条重复贴会叠层").map((c) => c.value), [], "描述句不该被绑成声明");
});

// ---- 末行汇总：跳过不是通过 ----

function fakeResults(skipped = []) {
  const out = [];
  for (let i = 0; i < 7; i += 1) out.push({ id: i + 1, ok: true, problems: [], notes: [], warns: [] });
  out[6].notes = ["命令冒烟：跑到 " + (3 - skipped.length) + " 条" + (skipped.length ? "；跳过 " + skipped.length + " 条：" + skipped.join("；") : "")];
  out[6].skipped = skipped;
  return out;
}

test("greenSummary：第 7 类三条都真跑了 → 七类全绿", () => {
  const lines = greenSummary(fakeResults([]));
  assert.match(lines[lines.length - 1], /^七类全绿。$/);
});

test("greenSummary：第 7 类有跳过 → 六类全绿 + 跳过 N 条（未核），不许说七类全绿", () => {
  const lines = greenSummary(fakeResults(["preflight（没有宿主可递 --host）"]));
  const last = lines[lines.length - 1];
  assert.equal(last, "六类全绿；第 7 类命令冒烟跳过 1 条（未核）。");
});

test("greenSummary：有红项 → 不给汇总（null）", () => {
  const results = fakeResults([]);
  results[2].ok = false;
  assert.equal(greenSummary(results), null);
});
