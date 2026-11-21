#!/usr/bin/env node
// 文档断言（六类）：让"文档写错了却没人红"这件事不再发生。
//
// 2026-11-22（V15 文档审计 §9）：病根不是笔误，是**没有任何东西会因为文档写错而变红**。
// 这份脚本要挡的六类（都能离线核，不联网）：
//   1 版本一致   package.json version / dsh.version / release-notes 首行 / CHANGELOG 首条 / docs 的"当前插件版"
//   2 宿主基线   package.json dshTarget = 文档里"当前适配 / dshTarget"字面值 = preflight 读的那个字段
//   3 补丁条数   lib/core.js 的 ALL_PATCHES.length = 所有"补丁表 N 条"
//   4 用例数     真实用例数（跑 test/*.test.mjs 数出来，或 --tests N 注入）= 所有"N 例 / tests N"
//   5 行号引用   正文里每个 lib|bin|scripts/xxx:NN 必须落在真实文件的行数内（±3 行内找不到标识符只 warn）
//   6 禁用词     "上游 / 跟随 / 跟踪 / 跟版 / 等上游 / 仍在维护" 在非历史段落出现即红
//
// 退出码：0 = 六类全绿；1 = 有红项（逐条打出来）。
// 用法：node scripts/assert-docs.mjs [--root <仓库根>] [--tests <N>] [--list]
//
// ⚠ 1.5 文档重写完成之前，第 5、6 类（以及第 1/2 类的旧数字）本来就是红的 —— 这是本脚本
//    存在的意义，不是它坏了。重写完再跑，六类要全绿。
import fs from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ALL_PATCHES } from "../lib/core.js";

const SELF_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// 走查的文档集：不含 docs/zh/audits/（历史归档，快照不改）与 docs/notice/（图片）。
const DOC_FILES = [
  "README.md",
  "README.zh-CN.md",
  "CHANGELOG.md",
  "release-notes.md",
  "COMPAT-0.2.1.md",
  "SOUL-GUARD.md",
  "docs/SEALED-ASAR.md",
];

// 语义锚点：这几句话是"值写在文档里"的唯一形态，重写文档时别改口，改了这里会红。
export const ANCHORS = {
  version: [
    { file: "docs/zh/README.md", pattern: /当前插件版\s*\*\*([0-9][0-9A-Za-z.\-]*)\*\*/, label: "当前插件版" },
  ],
  host: [
    { file: "docs/zh/README.md", pattern: /当前适配\s*\*\*DSH\s+([0-9][0-9A-Za-z.\-]*)\*\*/, label: "当前适配" },
    { files: ["docs/zh/handbook/00-总览与定位.md", "docs/zh/00-maintenance.md"], pattern: /\|\s*\x60package\.json\x60\s*→\s*\x60dshTarget\x60\s*\|\s*\x60([0-9][0-9A-Za-z.\-]*)\x60/, label: "dshTarget 表行" },
  ],
};

// 分两档：
//   soft = 只禁"姿态"，出处/版权段里允许出现（那是法律陈述，不是跟随）；
//   hard = 姿态词，任何段落都不许出现，许可段也不豁免。
const BANNED_WORDS = [
  { pattern: /跟随/, why: "跟随姿态", hard: true },
  { pattern: /跟踪/, why: "跟随姿态", hard: true },
  { pattern: /跟版/, why: "跟随姿态", hard: true },
  { pattern: /等上游/, why: "等上游", hard: true },
  { pattern: /仍在维护/, why: "「上游仍在维护」这类动态关系", hard: true },
  { pattern: /tracking|tracks\b/i, why: "跟随姿态（英文）", hard: true },
  { pattern: /上游/, why: "「上游」口径（1.5 起改用 宿主 / 宿主出厂原文 / 源码来源）" },
  { pattern: /upstream/i, why: "英文「上游」" },
];
// 允许出现"上游"的行：版权/来源陈述、函数名。别的都不许。
const BANNED_ALLOW = [
  /markerLooksUpstream/,
  /(派生|分叉|fork|来源|出处|版权|原作者|Source|contributors)/i,
];
// 允许整块出现的章节（许可与来源）：标题命中即整节豁免，直到下一个标题。
const BANNED_SECTION = /^#{1,6}\s+.*(上游|来源|许可|版权|upstream|license|source|credit)/i;

function read(root, rel) {
  try {
    return fs.readFileSync(path.join(root, rel), "utf8");
  } catch {
    return null;
  }
}

function listDocs(root) {
  const out = DOC_FILES.filter((rel) => fs.existsSync(path.join(root, rel))).map((rel) => ({ rel, text: read(root, rel) || "" }));
  const zh = path.join(root, "docs", "zh");
  if (fs.existsSync(zh)) {
    for (const name of fs.readdirSync(zh).sort()) {
      if (!name.endsWith(".md")) continue;
      const rel = path.join("docs", "zh", name).replace(/\\/g, "/");
      out.push({ rel, text: read(root, rel) || "" });
    }
  }
  return out;
}

/** CHANGELOG 只查首节：历史条目里出现"上游"是事实，不是姿态。 */
function firstSection(text) {
  const lines = String(text || "").split(/\r?\n/);
  const start = lines.findIndex((line) => /^##\s+/.test(line));
  if (start < 0) return "";
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i])) { end = i; break; }
  }
  return lines.slice(start, end).join("\n");
}

function linesOf(text) {
  return String(text || "").split(/\r?\n/);
}

function findAnchor(root, spec) {
  const text = read(root, spec.file);
  if (text === null) return { ok: false, line: 0, value: "", why: spec.file + " 不存在" };
  const lines = linesOf(text);
  for (let i = 0; i < lines.length; i += 1) {
    const hit = lines[i].match(spec.pattern);
    if (hit) return { ok: true, line: i + 1, value: hit[1] };
  }
  return { ok: false, line: 0, value: "", why: spec.file + " 里找不到「" + spec.label + "」那句话" };
}

function checkVersions(root) {
  const problems = [];
  const notes = [];
  const pkgRaw = read(root, "package.json");
  if (pkgRaw === null) return { problems: ["package.json 不存在"], notes };
  let pkg;
  try {
    pkg = JSON.parse(pkgRaw);
  } catch (error) {
    return { problems: ["package.json 不是合法 JSON: " + error.message], notes };
  }
  const version = String(pkg.version ?? "").trim();
  const vals = [{ label: "package.json version", value: version }];
  vals.push({ label: "package.json dsh.version", value: String(pkg.dsh?.version ?? "").trim() });
  const notesFirst = linesOf(read(root, "release-notes.md"))[0] || "";
  vals.push({ label: "release-notes.md 首行", value: (notesFirst.match(/^#\s*v?([0-9][0-9A-Za-z.\-]*)/) || [])[1] || "" });
  const changelog = read(root, "CHANGELOG.md") || "";
  const firstHeading = (linesOf(changelog).find((line) => /^##\s+/.test(line)) || "");
  vals.push({ label: "CHANGELOG.md 首条", value: (firstHeading.match(/^##\s+v?([0-9][0-9A-Za-z.\-]*)/) || [])[1] || "" });
  for (const spec of ANCHORS.version) {
    const hit = findAnchor(root, spec);
    if (!hit.ok) problems.push(hit.why);
    else vals.push({ label: spec.file + " 的" + spec.label, value: hit.value, where: spec.file + ":" + hit.line });
  }
  for (const item of vals) {
    if (!item.value) problems.push(item.label + " 读不到版本号");
    else if (item.value !== version) problems.push((item.where || item.label) + " 是 " + item.value + "，package.json version 是 " + version);
  }
  if (!problems.length) notes.push("五处一致：" + version);
  return { problems, notes };
}

function checkHost(root) {
  const problems = [];
  const notes = [];
  const pkgRaw = read(root, "package.json");
  let target = "";
  try {
    target = pkgRaw === null ? "" : String(JSON.parse(pkgRaw).dshTarget ?? "").trim();
  } catch (error) {
    return { problems: ["package.json 不是合法 JSON: " + error.message], notes };
  }
  if (!target) return { problems: ["package.json 缺 dshTarget（宿主基线没有单一来源）"], notes };
  for (const spec of ANCHORS.host) {
    // 锚点可能搬家（文档重写）：files 是可接受的候选路径，取第一个存在的。
    if (spec.files) spec.file = spec.files.find((f) => fs.existsSync(path.join(root, f))) || spec.files[0];
    const hit = findAnchor(root, spec);
    if (!hit.ok) problems.push(hit.why);
    else if (hit.value !== target) problems.push(spec.file + ":" + hit.line + " 写的是 " + hit.value + "，package.json dshTarget 是 " + target);
  }
  const preflight = read(root, path.join("scripts", "preflight-upgrade.mjs").replace(/\\/g, "/"));
  if (preflight === null) problems.push("scripts/preflight-upgrade.mjs 不存在");
  else if (!/pkg\.dshTarget/.test(preflight)) problems.push("scripts/preflight-upgrade.mjs 不再从 package.json 读 dshTarget（「破甲基准」的单一来源断了）");
  if (!problems.length) notes.push("宿主基线 " + target + "：文档、package.json、预检同一处来源");
  return { problems, notes };
}

function checkPatchCount(root, docs) {
  const problems = [];
  const notes = [];
  const count = ALL_PATCHES.length;
  let seen = 0;
  for (const doc of docs) {
    const text = doc.rel === "CHANGELOG.md" ? firstSection(doc.text) : doc.text;
    linesOf(text).forEach((line, i) => {
      // "补丁表 88 条"、"补丁表仍 88 条"、"补丁表共 88 条" 都算声明，别让一句副词把它绕过去。
      const re = /补丁表\s*(?:仍|共|还是|现)?\s*(\d+)\s*条/g;
      let hit;
      while ((hit = re.exec(line)) !== null) {
        seen += 1;
        if (Number(hit[1]) !== count) {
          problems.push(doc.rel + (doc.rel === "CHANGELOG.md" ? "（首节）" : "") + " 第 " + (i + 1) + " 行写「补丁表 " + hit[1] + " 条」，实际 " + count + " 条");
        }
      }
    });
  }
  if (!seen) problems.push("所有文档里都找不到「补丁表 N 条」—— 这句话是对表数的唯一声明，删掉等于没人核对");
  const changelogFirst = firstSection(read(root, "CHANGELOG.md") || "");
  if (!/补丁表\s*(?:仍|共|还是|现)?\s*\d+\s*条/.test(changelogFirst)) problems.push("CHANGELOG.md 首节里没有「补丁表 N 条」（assert-patches 也依赖它）");
  if (!problems.length) notes.push("补丁表 " + count + " 条：文档 " + seen + " 处声明全对");
  return { problems, notes };
}

function countTests(root, injected) {
  if (Number.isFinite(injected)) return { count: injected, how: "--tests 注入" };
  const dir = path.join(root, "test");
  if (!fs.existsSync(dir)) return { count: null, how: "根目录下没有 test/（用 --tests N）" };
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".test.mjs")).map((f) => path.join(dir, f));
  if (!files.length) return { count: null, how: "test/ 里没有 *.test.mjs（用 --tests N）" };
  const res = spawnSync(process.execPath, ["--test", ...files], { cwd: root, encoding: "utf8", timeout: 600000 });
  const text = (res.stdout || "") + (res.stderr || "");
  const hit = text.match(/(?:ℹ|#)\s*tests\s+(\d+)/);
  if (!hit) return { count: null, how: "跑 node --test 没拿到用例数（输出里没有 tests N）" };
  return { count: Number(hit[1]), how: "node --test 实测" };
}

function checkCaseCount(root, docs, injected) {
  const problems = [];
  const notes = [];
  const { count, how } = countTests(root, injected);
  if (count === null) return { problems: [how], notes };
  for (const doc of docs) {
    const text = doc.rel === "CHANGELOG.md" ? firstSection(doc.text) : doc.text;
    linesOf(text).forEach((line, i) => {
      for (const re of [/(\d{2,4})\s*例/g, /tests\s+(\d{1,4})/g, /(\d{2,4})\s+tests/g]) {
        let hit;
        while ((hit = re.exec(line)) !== null) {
          const value = Number(hit[1]);
          if (value < 30) continue;
          if (value !== count) {
            problems.push(doc.rel + (doc.rel === "CHANGELOG.md" ? "（首节）" : "") + " 第 " + (i + 1) + " 行写「" + hit[0] + "」，实际用例数 " + count + "（" + how + "）");
          }
        }
      }
    });
  }
  if (!problems.length) notes.push("用例数 " + count + "（" + how + "）：文档里没有对不上的数");
  return { problems, notes };
}

function checkLineRefs(root, docs) {
  const problems = [];
  const notes = [];
  const cache = new Map();
  const loadLines = (rel) => {
    if (cache.has(rel)) return cache.get(rel);
    const text = read(root, rel);
    const lines = text === null ? null : linesOf(text);
    cache.set(rel, lines);
    return lines;
  };
  const warns = [];
  let total = 0;
  for (const doc of docs) {
    if (doc.rel === "CHANGELOG.md") continue; // 历史条目的行号是当时的快照，不是当下引用
    linesOf(doc.text).forEach((line, i) => {
      const re = /(lib|bin|scripts)\/[\w.\-]+\.(?:js|mjs|cjs|json|yml|md):(\d+)/g;
      let hit;
      while ((hit = re.exec(line)) !== null) {
        total += 1;
        const rel = hit[0].slice(0, hit[0].lastIndexOf(":")).replace(/\\/g, "/");
        const want = Number(hit[2]);
        const lines = loadLines(rel);
        if (lines === null) {
          problems.push(doc.rel + " 第 " + (i + 1) + " 行引用 " + rel + ":" + want + "，但仓库里没有这个文件");
          continue;
        }
        if (want < 1 || want > lines.length) {
          problems.push(doc.rel + " 第 " + (i + 1) + " 行引用 " + rel + ":" + want + "，该文件只有 " + lines.length + " 行");
          continue;
        }
        // 行号在范围内不等于指对了：文档里那行提到的标识符，±3 行内得真的出现。
        // 这条只 warn 不计退出码 —— 它抓漏不抓错，别让它变成改一句话就红的噪音源。
        const tokens = [...line.matchAll(/`([A-Za-z_$][\w$]{2,})`/g)].map((m) => m[1]);
        if (!tokens.length) continue;
        const from = Math.max(0, want - 4);
        const window = lines.slice(from, want + 3).join("\n");
        if (!tokens.some((token) => window.includes(token))) {
          warns.push(doc.rel + ":" + (i + 1) + " → " + rel + ":" + want + " 附近找不到 " + tokens.join("/") + "（行号可能漂了）");
        }
      }
    });
  }
  if (!total) notes.push("正文里没有 file:line 引用");
  else if (!problems.length) {
    notes.push("行号引用 " + total + " 处，全部落在真实文件的行数内" + (warns.length ? "；另有 " + warns.length + " 处疑似漂移（warn，不计入退出码）" : ""));
  }
  return { problems, notes, warns };
}

function checkBannedWords(docs) {
  const problems = [];
  const notes = [];
  let hits = 0;
  for (const doc of docs) {
    if (doc.rel === "SOUL-GUARD.md") continue; // 历史声明原件，不动
    const text = doc.rel === "CHANGELOG.md" ? firstSection(doc.text) : doc.text;
    let inAllowedSection = false;
    linesOf(text).forEach((line, i) => {
      if (/^#{1,6}\s+/.test(line)) inAllowedSection = BANNED_SECTION.test(line);
      for (const word of BANNED_WORDS) {
        if (!word.pattern.test(line)) continue;
        hits += 1;
        if (!word.hard && inAllowedSection) continue;
        if (BANNED_ALLOW.some((re) => re.test(line))) continue;
        problems.push(doc.rel + (doc.rel === "CHANGELOG.md" ? "（首节）" : "") + " 第 " + (i + 1) + " 行用了「" + word.pattern.source + "」（" + word.why + "）：" + line.trim().slice(0, 90));
      }
    });
  }
  if (!problems.length) notes.push("禁用词：扫到 " + hits + " 处命中，全部落在白名单形态里");
  return { problems, notes };
}

export const CLASS_TITLES = [
  { id: 1, title: "版本五处一致" },
  { id: 2, title: "宿主基线字符串" },
  { id: 3, title: "补丁条数" },
  { id: 4, title: "用例数" },
  { id: 5, title: "行号引用可解析" },
  { id: 6, title: "禁用词（含「上游」）" },
];

export function runChecks(root, { tests } = {}) {
  const docs = listDocs(root);
  const results = [
    { ...CLASS_TITLES[0], ...checkVersions(root) },
    { ...CLASS_TITLES[1], ...checkHost(root) },
    { ...CLASS_TITLES[2], ...checkPatchCount(root, docs) },
    { ...CLASS_TITLES[3], ...checkCaseCount(root, docs, tests) },
    { ...CLASS_TITLES[4], ...checkLineRefs(root, docs) },
    { ...CLASS_TITLES[5], ...checkBannedWords(docs) },
  ];
  for (const r of results) r.ok = r.problems.length === 0;
  return results;
}

function argValue(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] || "") : "";
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log([
      "用法: node scripts/assert-docs.mjs [--root <仓库根>] [--tests <N>] [--list]",
      "",
      "六类文档断言（版本 / 宿主基线 / 补丁条数 / 用例数 / 行号引用 / 禁用词）。退出码 0 = 全绿。",
      "--root  只换被检查的仓库根；补丁表条数永远取本仓库的 lib/core.js，不随 --root 变。",
      "--tests 直接给用例数（默认跑 node --test test/*.test.mjs 数出来）。",
      "--list  只打印六类的名字，不检查。",
    ].join("\n"));
    return 0;
  }
  if (args.includes("--list")) {
    for (const item of CLASS_TITLES) console.log("[" + item.id + "] " + item.title);
    return 0;
  }
  const root = path.resolve(argValue(args, "--root") || SELF_ROOT);
  const injected = Number(argValue(args, "--tests"));
  const results = runChecks(root, { tests: Number.isFinite(injected) && injected > 0 ? injected : undefined });
  let redClasses = 0;
  let redItems = 0;
  for (const r of results) {
    const head = (r.ok ? "✓ [" : "✗ [") + r.id + "] " + r.title;
    if (r.ok) {
      console.log(head + "  " + (r.notes[0] || "ok"));
      for (const line of r.warns || []) console.log("    warn " + line);
    } else {
      redClasses += 1;
      redItems += r.problems.length;
      console.error(head + "  " + r.problems.length + " 处不符");
      for (const line of r.problems.slice(0, 40)) console.error("    " + line);
      if (r.problems.length > 40) console.error("    ……还有 " + (r.problems.length - 40) + " 处");
    }
  }
  console.log("");
  console.log("root=" + root);
  if (!redClasses) {
    console.log("六类全绿。");
    return 0;
  }
  console.log("六类里 " + redClasses + " 类红，共 " + redItems + " 处。");
  return 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = main();
}
