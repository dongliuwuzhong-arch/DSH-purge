import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// V15（1.5）补丁表的账：删 10 条、冷存 4 条、修 3 处锚 / 账。
// 这份测试只钉"表的形状与边界"，逐条语义仍在各自的 patch*.test.mjs 里。

import {
  ALL_PATCHES,
  applyPatches,
  applyReplacementsToText,
  patchFileOutcome,
  patchStatus,
} from "../lib/core.js";
import {
  LEGACY_PATCHES,
  LEGACY_PATCH_IDS,
  REMOVED_V15_PATCHES,
  REMOVED_V15_PATCH_IDS,
} from "../lib/patches-legacy.js";

const V15_TOTAL = 77; // 88 − 7（删） − 4（冷存）；#47 / #49 / #57 于 2026-11-22 对账搬回主表
const LEGACY_SRC = new URL("../lib/patches-legacy.js", import.meta.url);
const byId = (id) => ALL_PATCHES.find((p) => p.id === id);

test("1.5 · 主表条数与 id 唯一性：88 − 7 − 4 = 77", () => {
  assert.equal(ALL_PATCHES.length, V15_TOTAL);
  const ids = ALL_PATCHES.map((p) => p.id);
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual(dupes, [], "id 重复：" + dupes.join(","));
});

test("1.5 · 存档区与主表 id 完全不相交，两份清单对得上审计", () => {
  const ids = new Set(ALL_PATCHES.map((p) => p.id));
  assert.deepEqual([...LEGACY_PATCH_IDS].sort((a, b) => a - b), [28, 40, 46, 76], "冷存清单必须是 #40 #46 #76 #28");
  assert.deepEqual([...REMOVED_V15_PATCH_IDS].sort((a, b) => a - b), [30, 31, 56, 64, 65, 77, 88], "移除清单必须是那 7 条（#47/#49/#57 已搬回主表）");
  for (const id of [47, 49, 57]) {
    assert.ok(ids.has(id), "#" + id + " 必须回到主表：实测现网 applied，删掉是审计把 desktop 树拒掉的假象");
  }
  for (const id of [...LEGACY_PATCH_IDS, ...REMOVED_V15_PATCH_IDS]) {
    assert.equal(ids.has(id), false, "#" + id + " 还在主表里");
  }
  assert.equal(LEGACY_PATCHES.length, 4);
  assert.equal(REMOVED_V15_PATCHES.length, 7);
  const all = [...LEGACY_PATCHES, ...REMOVED_V15_PATCHES];
  const bad = all.filter((p) => !p.name || !p.file);
  assert.deepEqual(bad, [], "存档条目丢了 name / file：" + bad.map((p) => p.id).join(","));
});

test("1.5 · 存档区够不着运行路径：core.js / patches.js 都不 import 它", () => {
  const coreSrc = fs.readFileSync(new URL("../lib/core.js", import.meta.url), "utf8");
  const tableSrc = fs.readFileSync(new URL("../lib/patches.js", import.meta.url), "utf8");
  const legacySrc = fs.readFileSync(LEGACY_SRC, "utf8");
  assert.match(legacySrc, /仅存档，不参与运行/, "文件头必须写明它是存档");
  // 判据收窄成「真的 import」：原先用 includes("patches-legacy")，连注释里提一句文件名
  // 也会红——那是误判，不是越界（core.js 现在只在注释里指路）。
  const importsLegacy = (src) => /^\s*import[^;]*["\']\.\/patches-legacy\.js["\']/m.test(src);
  assert.equal(importsLegacy(coreSrc), false, "core.js 不许 import 存档区");
  assert.equal(importsLegacy(tableSrc), false, "patches.js 不许把存档区并进主表");
});

test("1.5 · apply / status 都摸不到存档区：跑全表不写 #40 的痕迹，状态表里没有存档 id", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dshpurge-v15-legacy-"));
  const home = path.join(root, "home");
  fs.mkdirSync(home, { recursive: true });
  const aiBase = path.join(root, "node_modules", "@deepseek-ai");
  const file = path.join(aiBase, "dsh-system-prompt", "lib", "index.js");
  const p40 = LEGACY_PATCHES.find((p) => p.id === 40);
  // 用 #40 独有的 marker：[dsh-purge] complete prompt keeps inject 是共享常量
  // （COMPLETE_PROMPT_WATERFALL_INJECT）里的子串，主表里另有补丁会写出它，不合适做证据。
  const marker = "inject last after closer"; // #40 独有的产物 marker（主表里没人写它）
  const tableHasMarker = ALL_PATCHES.some((p) => (p.replacements || []).some((r) => String(r.replace || "").includes(marker)));
  assert.equal(tableHasMarker, false, "这条 marker 只存在于存档区，主表里不该有人写它");
  const rep = p40.replacements.find((r) => typeof r.pattern === "string" && typeof r.replace === "string");
  assert.ok(rep, "#40 的存档里必须留着字符串形态的锚");
  const seed = "// #40 fixture：宿主原文\n" + rep.pattern + "\n";
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, seed, "utf8");
  try {
    const report = await applyPatches(aiBase, ALL_PATCHES, { dshHome: home, log: () => {} });
    const legacyIds = [...LEGACY_PATCH_IDS, ...REMOVED_V15_PATCH_IDS].map(Number);
    const strayed = report.filter((r) => legacyIds.includes(Number(r.patch_id)));
    assert.deepEqual(strayed, [], "存档 id 出现在 apply 报告里：" + JSON.stringify(strayed));
    const after = fs.readFileSync(file, "utf8");
    assert.equal(after, seed, "存档区的 #40 被 apply 摸到了：" + JSON.stringify(after.slice(0, 80)));
    // 对照：同一条存档补丁直接打仍然有效（存档没被掏空，只是不参与运行）
    const direct = applyReplacementsToText(seed, p40, "index.js");
    assert.equal(direct.changed, true, "存档条目本身必须还能打");
    assert.notEqual(direct.text, seed);
    const status = await patchStatus(aiBase, ALL_PATCHES, { dshHome: home });
    for (const id of [...LEGACY_PATCH_IDS, ...REMOVED_V15_PATCH_IDS]) {
      assert.equal(id in status, false, "状态表里冒出了存档 id #" + id);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("1.5 · #101 标记归位：replace 写自己的号，旧号仍被认", () => {
  const p = byId(101);
  assert.ok(p, "#101 必须还在主表（它是 #87 的二段补丁）");
  const rep = p.replacements[0].replace;
  assert.ok(rep.includes("[dsh-purge-101]"), "replace 必须写出自己的号");
  assert.equal(rep.includes("[dsh-purge-89]"), false, "replace 里不该再有 #87 的号");
  assert.deepEqual(p.markersWritten, ["[dsh-purge-101]"], "markersWritten 必须跟着归位");
  assert.equal(p.markersAny, true);
  assert.ok(p.markers.includes("[dsh-purge-101]") && p.markers.includes("[dsh-purge-89]"),
    "旧宿主文件里留的是 -89，不认它就会把「已贴」判成「没贴」再叠一层");
  const once = applyReplacementsToText(p.replacements[0].pattern, p, "index.js");
  assert.equal(once.changed, true);
  assert.ok(once.text.includes("[dsh-purge-101]"));
  assert.equal(patchFileOutcome(once.text, p, "index.js"), "applied");
  assert.equal(patchFileOutcome("// [dsh-purge-89] hang after persona", p, "index.js"), "applied", "旧 tag 仍判 applied");
});

test("1.5 · #105 的兜底：surface.nodes 不是数组时不抛 TypeError", () => {
  const p = byId(105);
  const code = p.replacements[0].replace;
  assert.ok(code.includes("Array.isArray(agent?.session?.surface?.nodes)"), "必须走 Array.isArray 兜底");
  assert.equal(code.includes("agent.session.surface.nodes.some"), false, "不许留着裸解引用");
  // 真跑一遍插入的代码：nodes = null / string / 对象都要撑得住，且判据结果正确。
  const run = new Function("desired", "agent", "sameContextPayload", "decision", "messages", code + "\nreturn dshPurgeOnSurface;");
  const desired = { kind: "baseline" };
  const same = () => true;
  const decision = { messages: [] };
  for (const nodes of [null, undefined, "not-an-array", { length: 1 }]) {
    const got = run(desired, { session: { surface: { nodes }, eventAt: () => undefined } }, same, decision, []);
    // 没命中就走不到那句 return decision，函数落到底部返回 undefined
    assert.equal(got, false, "非数组 nodes 必须当成空集，不能抛：" + JSON.stringify(nodes));
  }
  // 正例：数组且命中同一条 payload → 早退，把 decision 原样还回去（去重判据生效）
  const hit = run(desired, { session: { surface: { nodes: [1] }, eventAt: () => ({ type: "user/message", data: desired }) } }, same, decision, []);
  assert.equal(hit, decision);
});

test("1.5 · 修账：#62 的死标记已删、#24 的上游原句已从 markers 摘掉", () => {
  const p62 = byId(62);
  assert.equal(p62.markers.includes("[dsh-purge] 0.2.2 tool ask failopen"), false);
  assert.ok(p62.replacements.some((r) => r.replace.includes("0.2.2 tool ask failopen")), "写出该 tag 的替换本身要留着（旧宿主用）");
  const p24 = byId(24);
  assert.deepEqual(p24.markers, ["[dsh-purge] preset fetch enabled"], "#24 的 markers 只留我们自己写的那条");
  assert.equal(p24.satisfiedBy.length, 1);
  assert.ok(p24.satisfiedBy[0].includes("- id: tool-web"), "satisfiedBy 必须锚 id + 结构，不是抄一句宿主原文");
  assert.ok(p24.satisfiedBy[0].includes("config:"), "satisfiedBy 必须锚 id + 结构，不是抄一句宿主原文");
});
