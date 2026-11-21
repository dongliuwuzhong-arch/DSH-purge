#!/usr/bin/env node
// 文档断言（六类）：让"文档写错了却没人红"这件事不再发生。
//
// 2026-11-22（V15 文档审计 §9）：病根不是笔误，是**没有任何东西会因为文档写错而变红**。
// 这份脚本要挡的六类（都能离线核，不联网）：
//   1 版本一致   package.json version / dsh.version / release-notes 首行 / CHANGELOG 首条 /
//                两版根 README 的标题行 + 表格版本行 / docs 的"当前插件版"（共 9 个位点，缺一个也红）
//   2 宿主基线   package.json dshTarget = 文档里"当前适配 / dshTarget"字面值 = preflight 读的那个字段
//   3 补丁条数   lib/core.js 的 ALL_PATCHES.length = 所有"补丁表 N 条" / "N patches"，
//                以及任何"这一行提到补丁、又出现 N 条"的写法（表格、"当前 77 条"那种）
//   4 用例数     真实用例数（跑 test/*.test.mjs 数出来，或 --tests N 注入）= 所有"N 例 / tests N"
//   5 行号引用   正文里每个 lib|bin|scripts/xxx:NN 必须落在真实文件的行数内（±3 行内找不到标识符只 warn）
//   6 禁用词     "上游 / 跟随 / 跟踪 / 跟版 / 等上游 / 仍在维护" 在非历史段落出现即红
//   7 命令冒烟   真跑 --status / install-offline --check-deps / preflight --dry-run，
//                断言"看到什么算对"里那句字面串确实出现在输出里（没有宿主时跳过并计数）
//
// 2026-11-22（审计 §5.1 H1/H5/H6/H9）：上面六类原先只扫根 7 篇 + docs/zh 顶层，
// handbook(1619 行) / deep-dive(615 行) / history 全在盲区，本次查出的 S1 级判据错误
// 没有一条能让它变红。现在的扫描集递归到 docs/zh/{handbook,deep-dive,history}；
// history 按它自己 README 的声明（"数字不再维护"）豁免数字与行号两类，但**计入覆盖数**并打出来，
// 免得"豁免"变成"没扫"。
//
// 退出码：0 = 全绿；1 = 有红项（逐条打出来）。
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
import { installAnchor } from "../lib/surface.js";

const SELF_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// 走查的文档集。
// 2026-11-22（审计 H8）：清单里原本还写着 COMPAT-0.2.1.md 与 docs/SEALED-ASAR.md，
// 这两个文件 1.5 之前就搬进 docs/zh/history/ 了 —— 清单腐烂看不出来，是因为 listDocs 静默过滤。
// 现在清单只留真在根上的，历史区靠下面的递归扫描带进来；清单里写了但磁盘上没有的，打 warn。
const DOC_FILES = [
  "README.md",
  "README.zh-CN.md",
  "CHANGELOG.md",
  "release-notes.md",
  "SOUL-GUARD.md",
];

/** docs/zh 下每一层的分类。history 是快照区：数字/行号按它自己 README 的声明豁免。 */
function docKind(rel) {
  const n = String(rel).replace(/\\/g, "/");
  if (n.startsWith("docs/zh/history/")) return "history";
  if (n.startsWith("docs/zh/handbook/")) return "handbook";
  if (n.startsWith("docs/zh/deep-dive/")) return "deep-dive";
  if (n.startsWith("docs/zh/")) return "zh";
  return "root";
}

/** 快照文档：docs/zh/history 整区（含 audits）。数字与行号都不核。 */
function isSnapshotDoc(doc) {
  return doc.kind === "history";
}

function walkMarkdown(root, relDir, out, depth = 0) {
  const dir = path.join(root, relDir);
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    const rel = path.join(relDir, entry.name).replace(/\\/g, "/");
    if (entry.isDirectory()) {
      // docs/zh/audits 是 V15 期间的审计留档，与 history 同级待遇：不进数字类。
      if (depth < 3) walkMarkdown(root, rel, out, depth + 1);
      continue;
    }
    if (!entry.name.endsWith(".md")) continue;
    out.push({ rel, text: read(root, rel) || "", kind: docKind(rel) });
  }
}

// 语义锚点：这几句话是"值写在文档里"的唯一形态，重写文档时别改口，改了这里会红。
export const ANCHORS = {
  // 2026-11-22（终审 A §6 的盲区 3）：1.5.2 里两版根 README 的标题与表格一直写着旧版本，
  // 而第 1 类当时只认 docs/zh/README 那一句 —— 于是「首页写 1.5.0、包里是 1.5.2」四道门全绿放行。
  // 现在四处全锁：两版 README 的标题行 + 表格版本行、docs/zh/README 的「当前插件版」、release-notes 首行。
  // 标题行锚用「Harness」+「·」两件特征，不抄整句原文：改副标题不该误红，改版本必须红。
  version: [
    { file: "README.md", pattern: /Harness[^*\n]*·\s*v?([0-9][0-9A-Za-z.\-]*)/, label: "标题行版本" },
    { file: "README.md", pattern: /^\|\s*Plugin version\s*\|\s*v?([0-9][0-9A-Za-z.\-]*)\s*\|/, label: "Plugin version 表行" },
    { file: "README.zh-CN.md", pattern: /Harness[^*\n]*·\s*v?([0-9][0-9A-Za-z.\-]*)/, label: "标题行版本" },
    { file: "README.zh-CN.md", pattern: /^\|\s*当前插件版\s*\|\s*v?([0-9][0-9A-Za-z.\-]*)\s*\|/, label: "当前插件版 表行" },
    { file: "docs/zh/README.md", pattern: /当前插件版\s*\*\*([0-9][0-9A-Za-z.\-]*)\*\*/, label: "当前插件版" },
    { file: "release-notes.md", pattern: /^#\s*v?([0-9][0-9A-Za-z.\-]*)\s*$/, label: "首行版本" },
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
//
// 2026-11-22（审计 H6）：这张表原先对 hard 词也生效，于是**任何一行只要带上「（出处：X）」**，
// 写「仍跟随上游发版」也不会红 —— 白名单比禁用词还宽，等于禁用词没用。
// 现在分两层：
//   · soft 词（上游 / upstream）：来源、出处、fork、函数名都放行（那是法律陈述与代码标识）；
//   · hard 词（跟随 / 跟踪 / 跟版 / 等上游 / 仍在维护 / tracking）：白名单**不放行**，
//     只在两个地方放过 —— ①整节是「上游与许可」这类章节；②这一行明确**否定**了跟随姿态
//     （"不再跟随任何外部发行节奏"是这套文档的定位句，必须留）。
const BANNED_ALLOW = [
  /markerLooksUpstream/,
  /(派生|分叉|fork|来源|出处|版权|原作者|Source|contributors)/i,
];
// 否定跟随的那几种写法。只在 hard 词上用；不写成宽泛的 /不.*跟随/ 是怕把
// "虽不完美仍在跟随"这种也放过去。
const BANNED_NEGATION = /(不再|不|无须|无需|没有必要|不去|拒绝|停止)\s*(再)?\s*(跟随|跟踪|跟版|等上游)/;
// 允许整块出现的章节（许可与来源）：标题命中即整节豁免，直到下一个标题。
const BANNED_SECTION = /^#{1,6}\s+.*(上游|来源|许可|版权|upstream|license|source|credit)/i;

function read(root, rel) {
  try {
    return fs.readFileSync(path.join(root, rel), "utf8");
  } catch {
    return null;
  }
}

/** 扫描集 + 覆盖统计。missing 是"清单里写了但磁盘上没有"的那些（warn，不红）。 */
function listDocsDetailed(root) {
  const out = [];
  const missing = [];
  for (const rel of DOC_FILES) {
    if (!fs.existsSync(path.join(root, rel))) {
      missing.push(rel);
      continue;
    }
    out.push({ rel, text: read(root, rel) || "", kind: "root" });
  }
  walkMarkdown(root, path.join("docs", "zh"), out);
  const byKind = {};
  for (const doc of out) byKind[doc.kind] = (byKind[doc.kind] || 0) + 1;
  return { docs: out, missing, byKind };
}

function listDocs(root) {
  return listDocsDetailed(root).docs;
}

/** 覆盖统计的一句话（每类输出都带上，别让"扫了 0 篇"和"全绿"长得一样）。 */
function coverageText(byKind = {}) {
  const order = ["root", "zh", "handbook", "deep-dive", "history"];
  return order.filter((k) => byKind[k]).map((k) => k + " " + byKind[k]).join(" / ");
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
  const changelog = read(root, "CHANGELOG.md") || "";
  const firstHeading = (linesOf(changelog).find((line) => /^##\s+/.test(line)) || "");
  vals.push({ label: "CHANGELOG.md 首条", value: (firstHeading.match(/^##\s+v?([0-9][0-9A-Za-z.\-]*)/) || [])[1] || "" });
  // release-notes 首行以前是这里单独读的，现在它是一条正式锚点（上面 ANCHORS.version 的最后一条），
  // 这样它的位置、缺点时的报错都跟其他锚点同一种形态。
  let anchors = 0;
  for (const spec of ANCHORS.version) {
    const hit = findAnchor(root, spec);
    if (!hit.ok) problems.push(hit.why);
    else {
      anchors += 1;
      vals.push({ label: spec.file + " 的" + spec.label, value: hit.value, where: spec.file + ":" + hit.line });
    }
  }
  for (const item of vals) {
    if (!item.value) problems.push(item.label + " 读不到版本号");
    else if (item.value !== version) problems.push((item.where || item.label) + " 是 " + item.value + "，package.json version 是 " + version);
  }
  if (!problems.length) {
    notes.push(vals.length + " 个位点全一致：" + version +
      "（文档锚 " + anchors + " 处：两版根 README 的标题行 + 表格版本行、docs/zh/README 的当前插件版、release-notes 首行；" +
      "另 package.json version / dsh.version 与 CHANGELOG 首条）");
  }
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

/**
 * 一行里的补丁条数声明，三种句式都认；重复报同一处会让人以为有好几个错，所以按数字位置去重。
 *
 * 2026-11-22（终审 A §6 的盲区 1、2）：1.5.2 的门只认「补丁表 N 条」一句中文，
 * 于是 README.md 的「77 patches」和 handbook/00 表格里的「当前 77 条」改成 78 都全绿。
 */
export function patchClaims(line) {
  const claims = [];
  const add = (idx, value, form) => claims.push({ idx, value: Number(value), form });
  // ① 句式声明：「补丁表 88 条」/「补丁表仍 88 条」/「补丁表（77 条）」/「补丁 77 条：applied 76」。
  //    数字必须紧贴「补丁(表)」——不然「补丁是一次性改写…（现网 31 条）」那种描述会被误绑成声明。
  for (const m of line.matchAll(/补丁表?\s*(?:仍|共|还是|现|是)?\s*[（(]?\s*(\d+)\s*条/g)) {
    add(m.index + m[0].lastIndexOf(m[1]), m[1], "补丁表 N 条");
  }
  // ② 英文句式：77 patches（两版英文 README 的表格就是这一句）。
  for (const m of line.matchAll(/(\d+)\s+patches\b/g)) add(m.index, m[1], "N patches");
  // ③ 表格兜底：第一格是「补丁表」的那种表行，值是 77 但句式是「真源。当前 77 条」（handbook/00）。
  //    只放行这一种形态，其它行里随便一个「N 条」都不算声明 —— 松到「整行提过补丁」就会把
  //    「其余 63 条被改了它不报」读成表数。30 以下是小数目（4 条冷存 / 7 条物理删），不是表总数。
  if (/^\s*\|\s*补丁表\s*\|/.test(line)) {
    for (const m of line.matchAll(/(\d+)\s*条/g)) {
      if (Number(m[1]) < 30) continue;
      add(m.index, m[1], "补丁表行的 N 条");
    }
  }
  const seenAt = new Set();
  return claims.filter((c) => {
    const key = c.idx + ":" + c.value;
    if (seenAt.has(key)) return false;
    seenAt.add(key);
    return true;
  });
}

function checkPatchCount(root, docs, byKind) {
  const problems = [];
  const notes = [];
  const count = ALL_PATCHES.length;
  let seen = 0;
  let snapshot = 0;
  for (const doc of docs) {
    if (isSnapshotDoc(doc)) {
      snapshot += 1;
      continue;
    }
    const text = doc.rel === "CHANGELOG.md" ? firstSection(doc.text) : doc.text;
    linesOf(text).forEach((line, i) => {
      for (const claim of patchClaims(line)) {
        seen += 1;
        if (claim.value !== count) {
          problems.push(doc.rel + (doc.rel === "CHANGELOG.md" ? "（首节）" : "") + " 第 " + (i + 1) +
            " 行写「" + claim.form.replace("N", claim.value) + "」，实际 " + count + " 条");
        }
      }
    });
  }
  if (!seen) problems.push("所有文档里都找不到「补丁表 N 条」—— 这句话是对表数的唯一声明，删掉等于没人核对");
  const changelogFirst = firstSection(read(root, "CHANGELOG.md") || "");
  if (!/补丁表\s*(?:仍|共|还是|现)?\s*\d+\s*条/.test(changelogFirst)) problems.push("CHANGELOG.md 首节里没有「补丁表 N 条」（assert-patches 也依赖它）");
  if (!problems.length) {
    notes.push("补丁表 " + count + " 条：文档 " + seen + " 处声明全对（句式：补丁表 N 条 / N patches / 提到补丁的 N 条；扫了 " +
      coverageText(byKind) + (snapshot ? "；history " + snapshot + " 篇按快照豁免" : "") + "）");
  }
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

function checkCaseCount(root, docs, injected, byKind) {
  const problems = [];
  const notes = [];
  const { count, how } = countTests(root, injected);
  if (count === null) return { problems: [how], notes };
  let snapshot = 0;
  for (const doc of docs) {
    if (isSnapshotDoc(doc)) {
      snapshot += 1;
      continue;
    }
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
  if (!problems.length) {
    notes.push("用例数 " + count + "（" + how + "）：文档里没有对不上的数（扫了 " + coverageText(byKind) +
      (snapshot ? "；history " + snapshot + " 篇按快照豁免" : "") + "）");
  }
  return { problems, notes };
}

function checkLineRefs(root, docs, byKind) {
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
  let scanned = 0;
  let snapshot = 0;
  for (const doc of docs) {
    if (doc.rel === "CHANGELOG.md") continue; // 历史条目的行号是当时的快照，不是当下引用
    if (isSnapshotDoc(doc)) {
      snapshot += 1;
      continue;
    }
    scanned += 1;
    linesOf(doc.text).forEach((line, i) => {
      // 两种写法都核：`lib/x.js:123` 和 `lib/x.js` 第 123 行。
      // 第二种以前根本没人管 —— 换一种写法就绕过整类（审计 H5 的另一半）。
      const refRe = /(lib|bin|scripts)\/[\w.\-]+\.(?:js|mjs|cjs|json|yml|md):(\d+)/g;
      const lineRe = /`((?:lib|bin|scripts)\/[\w.\-]+\.(?:js|mjs|cjs|json|yml|md))`\s*第\s*(\d+)\s*行/g;
      for (const match of line.matchAll(lineRe)) {
        total += 1;
        const ref = { rel: match[1], want: Number(match[2]), text: match[0] };
        const linesLocal = loadLines(ref.rel);
        if (linesLocal === null) {
          problems.push(doc.rel + " 第 " + (i + 1) + " 行引用 " + ref.rel + "（第 " + ref.want + " 行），但仓库里没有这个文件");
          continue;
        }
        if (ref.want < 1 || ref.want > linesLocal.length) {
          problems.push(doc.rel + " 第 " + (i + 1) + " 行说 " + ref.rel + " 第 " + ref.want + " 行，该文件只有 " + linesLocal.length + " 行");
        }
      }
      const re = refRe;
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
  const scope = "（扫了 " + scanned + " 篇：" + coverageText(byKind) +
    (snapshot ? "；history " + snapshot + " 篇按快照豁免" : "") + "）";
  if (!total) {
    // 以前这里直接写"正文里没有 file:line 引用"并算通过 —— 整类事实上空转，永远绿。
    // 现在必须说清"扫了几篇、为什么 0 处也算过"，并把它记成 warn：数量归零本身是可疑信号。
    notes.push("0 处 file:line 引用" + scope + "；通过理由是「这套文档不给行号」——数量归零会被记成 warn");
    warns.push("行号引用 0 处" + scope + "：确认全册确实不给行号，否则说明引用被删光了");
  } else if (!problems.length) {
    notes.push("行号引用 " + total + " 处，全部落在真实文件的行数内" + scope +
      (warns.length ? "；另有 " + warns.length + " 处疑似漂移（warn，不计入退出码）" : ""));
  }
  return { problems, notes, warns };
}

function checkBannedWords(docs, byKind) {
  const problems = [];
  const notes = [];
  let hits = 0;
  let scanned = 0;
  let snapshot = 0;
  for (const doc of docs) {
    if (doc.rel === "SOUL-GUARD.md") continue; // 历史声明原件，不动
    // history 按它自己 README:39 的声明原文保留当年的「上游」字样（"改了就把证据也改了"），
    // 这是有意的例外；但仍然计入覆盖数，别让"豁免"看起来像"没扫"。
    if (isSnapshotDoc(doc)) {
      snapshot += 1;
      continue;
    }
    scanned += 1;
    const text = doc.rel === "CHANGELOG.md" ? firstSection(doc.text) : doc.text;
    let inAllowedSection = false;
    linesOf(text).forEach((line, i) => {
      if (/^#{1,6}\s+/.test(line)) inAllowedSection = BANNED_SECTION.test(line);
      for (const word of BANNED_WORDS) {
        if (!word.pattern.test(line)) continue;
        hits += 1;
        // 整节是"上游与许可"：soft 与 hard 都放过（那是法律陈述区）。
        if (inAllowedSection) continue;
        if (word.hard) {
          // hard 词只认"明确否定跟随"这一种行内豁免；出处/版权字样不放行。
          if (BANNED_NEGATION.test(line)) continue;
        } else if (BANNED_ALLOW.some((re) => re.test(line))) {
          continue;
        }
        problems.push(doc.rel + (doc.rel === "CHANGELOG.md" ? "（首节）" : "") + " 第 " + (i + 1) + " 行用了「" + word.pattern.source + "」（" + word.why + "）：" + line.trim().slice(0, 90));
      }
    });
  }
  const scope = "（扫了 " + scanned + " 篇：" + coverageText(byKind) + (snapshot ? "；history " + snapshot + " 篇按快照豁免" : "") + "）";
  if (!problems.length) notes.push("禁用词：扫到 " + hits + " 处命中，全部落在白名单 / 整节豁免 / 否定跟随的形态里" + scope);
  return { problems, notes };
}

/**
 * 第 7 类 · 命令冒烟（V15 收 · 审计 H9 "没有任何一类核文档里的命令能不能跑"）。
 *
 * 六类全是字符串比对与文件存在性，所以「判据串根本不存在于任何输出里」这类事它一概看不见：
 * 本次 S1 级的 A（--status 在 CLI 下打不出逐条状态）、D（check-bak-judge 的字段根本不存在）、
 * C8（四行 vs 五行）没有一条能让门变红。
 *
 * 这一类的做法：真跑三条只读命令，断言"看到什么算对"里那句字面串确实出现。
 * 需要宿主的那条在没有宿主时**跳过并计数**，不静默通过；脚本不在库里（比如测试用的
 * 最小文档树）同样跳过并计数 —— "跳过"必须能被读出来。
 */
const SMOKE_COMMANDS = [
  {
    id: "status",
    rel: "bin/dsh-purge.js",
    signature: /dsh-purge 状态 \/ Status/,
    argv: ["--status"],
    // 文档 02:18 / 99:25 承诺：不带 DSH_SURFACE 也要能拿到逐条状态。
    // 本机有宿主时必须是「补丁 N/M 已清洗」；没有宿主时至少要把**有效**的出路写在提示里
    // （以前写的是 DSH_BASE，而桌面宿主上 DSH_BASE 被 findAiBaseWeb 明确排除，等于指路到死路）。
    check(out) {
      const problems = [];
      for (const want of ["dsh-purge 状态 / Status", "宿主 / surface", "DSH_HOME"]) {
        if (!out.includes(want)) problems.push("输出里没有「" + want + "」");
      }
      if (/补丁 \d+\/\d+ 已清洗/.test(out)) return problems;
      if (!/未定位宿主插件根/.test(out)) problems.push("既没有「补丁 N/M 已清洗」，也没有「未定位宿主插件根」——判据形态变了");
      if (!/--surface desktop/.test(out)) {
        problems.push("没定位到宿主时，提示里必须有 --surface desktop（S1-1：只说设 DSH_BASE 是无效指路）");
      }
      return problems;
    },
  },
  {
    id: "check-deps",
    rel: "scripts/install-offline.mjs",
    signature: /--check-deps/,
    argv: ["--check-deps"],
    check(out) {
      const problems = [];
      for (const want of ["check-deps", "files   ok", "result  ok"]) {
        if (!out.includes(want)) problems.push("输出里没有「" + want + "」");
      }
      return problems;
    },
  },
  {
    id: "preflight",
    rel: "scripts/preflight-upgrade.mjs",
    signature: /破甲基准/,
    argv: ["--dry-run"],
    needsHost: true,
    check(out) {
      const problems = [];
      if (!/破甲基准: *[0-9][0-9A-Za-z.\-]* *✓ *一致/.test(out)) problems.push("输出里没有「破甲基准: … ✓ 一致」");
      if (!/补丁 \d+ 条：/.test(out)) problems.push("输出里没有「补丁 N 条：」这行汇总");
      if (!/桌面壳/.test(out)) problems.push("输出里没有「桌面壳」独立核查那行");
      return problems;
    },
  },
];

/** 宿主安装目录（只用来给 preflight 递 --host；没有就跳过那条并计数）。 */
function smokeHostDir() {
  try {
    const anchor = installAnchor();
    if (anchor.desktop) {
      const app = path.join(anchor.anchor, "resources", "app");
      if (fs.existsSync(path.join(app, "dsh", "node_modules", "@deepseek-ai"))) return app;
      if (fs.existsSync(path.join(app, "node_modules", "@deepseek-ai"))) return app;
    }
  } catch {
    /* ignore */
  }
  return "";
}

function checkCommandSmoke(root) {
  const problems = [];
  const notes = [];
  const ran = [];
  const skipped = [];
  const hostApp = smokeHostDir();
  for (const cmd of SMOKE_COMMANDS) {
    const scriptPath = path.join(root, cmd.rel);
    if (!fs.existsSync(scriptPath)) {
      skipped.push(cmd.id + "（脚本不在库里：" + cmd.rel + "）");
      continue;
    }
    // 有同名文件不等于有这个命令：测试用的最小文档树里也放着 scripts/preflight-upgrade.mjs
    // （那是给 dshTarget 锚点用的桩）。缺签名串就当"这个库里没有这条命令"，跳过并计数。
    const scriptText = fs.readFileSync(scriptPath, "utf8");
    if (cmd.signature && !cmd.signature.test(scriptText)) {
      skipped.push(cmd.id + "（" + cmd.rel + " 缺签名串，不是本仓库的脚本）");
      continue;
    }
    let argv = [...cmd.argv];
    if (cmd.needsHost) {
      if (!hostApp) {
        skipped.push(cmd.id + "（没有宿主可递 --host）");
        continue;
      }
      argv = [...argv, "--host", hostApp];
    }
    const env = { ...process.env };
    // 冒烟要证明"不带 DSH_SURFACE 也认得出来"，所以显式清掉它（别让跑门禁的人的环境替它作答）。
    delete env.DSH_SURFACE;
    const res = spawnSync(process.execPath, [scriptPath, ...argv], {
      cwd: root, encoding: "utf8", timeout: 300000, env,
    });
    const out = String(res.stdout || "") + String(res.stderr || "");
    const code = res.status;
    if (code !== 0 && !(cmd.id === "preflight" && code === 2)) {
      problems.push(cmd.id + " 退出码 " + code + "（预期 0" + (cmd.id === "preflight" ? " 或 2（有失配）" : "") + "）：" + out.trim().split(/\r?\n/).slice(-3).join(" / "));
      continue;
    }
    for (const line of cmd.check(out)) problems.push(cmd.id + ": " + line);
    ran.push(cmd.id);
  }
  const scope = "跑到 " + ran.length + " 条" + (ran.length ? "（" + ran.join(" / ") + "）" : "") +
    (skipped.length ? "；跳过 " + skipped.length + " 条：" + skipped.join("；") : "");
  if (!problems.length) notes.push("命令冒烟：" + scope);
  for (const id of skipped) notes.push("跳过 " + id);
  return { problems, notes, skipped };
}

export const CLASS_TITLES = [
  { id: 1, title: "版本一致（package.json / 两版 README 标题+表 / docs/zh/README / release-notes 首行 / CHANGELOG 首条）" },
  { id: 2, title: "宿主基线字符串" },
  { id: 3, title: "补丁条数" },
  { id: 4, title: "用例数" },
  { id: 5, title: "行号引用可解析" },
  { id: 6, title: "禁用词（含「上游」）" },
  { id: 7, title: "命令冒烟（--status / --check-deps / --dry-run）" },
];

export function runChecks(root, { tests } = {}) {
  const { docs, missing, byKind } = listDocsDetailed(root);
  const coverage = [];
  for (const rel of missing) coverage.push("清单里有但磁盘上没有（warn）：" + rel);
  const results = [
    { ...CLASS_TITLES[0], ...checkVersions(root), warns: [] },
    { ...CLASS_TITLES[1], ...checkHost(root), warns: [] },
    { ...CLASS_TITLES[2], ...checkPatchCount(root, docs, byKind) },
    { ...CLASS_TITLES[3], ...checkCaseCount(root, docs, tests, byKind) },
    { ...CLASS_TITLES[4], ...checkLineRefs(root, docs, byKind) },
    { ...CLASS_TITLES[5], ...checkBannedWords(docs, byKind) },
    { ...CLASS_TITLES[6], ...checkCommandSmoke(root) },
  ];
  for (const r of results) r.ok = r.problems.length === 0;
  if (coverage.length) results[0].warns = (results[0].warns || []).concat(coverage);
  results.coverage = { byKind, missing };
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
      "六类文档断言（版本 / 宿主基线 / 补丁条数 / 用例数 / 行号引用 / 禁用词）+ 第 7 类命令冒烟。退出码 0 = 全绿。",
      "第 7 类没有宿主时会跳过并计数，末行写「跳过 N 条（未核）」，不写「七类全绿」。",
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
  const cov = results.coverage || { byKind: {} };
  console.log("扫描集=" + (coverageText(cov.byKind) || "(空)"));
  const summary = greenSummary(results);
  if (summary) {
    for (const line of summary) console.log(line);
    return 0;
  }
  console.log("七类里 " + redClasses + " 类红，共 " + redItems + " 处。");
  return 1;
}

/**
 * 末行汇总（全绿时的最后两行：先明细，再结论 —— 结论在最后一行，tail 读到的就是结论）。
 *
 * 2026-11-22（终审 A §B1 + §6 盲区）：1.5.2 不管第 7 类跑没跑，末两行都是「六类全绿。」
 * 加一句「第 7 类…同样通过」。于是「没有宿主、三条命令全跳过」和「三条都真跑了」打印得一模一样，
 * 只读最后一行的人还会以为门没跑完。现在：
 *   · 第 7 类一条都没跳过 → 「七类全绿。」（真跑过才敢这么写）；
 *   · 有跳过 → 「六类全绿；第 7 类命令冒烟跳过 N 条（未核）」——跳过不是通过，措辞得分开。
 * 判断放这里而不是 main() 里，测试才能直接喂假的 results 验这两种形态。
 */
export function greenSummary(results) {
  if (!Array.isArray(results) || !results.length) return null;
  if (results.some((r) => !r || !r.ok)) return null;
  const smoke = results[6] || {};
  const scope = (smoke.notes || []).find((n) => n.startsWith("命令冒烟")) || "第 7 类无输出";
  const skipped = (smoke.skipped || []).length;
  const head = skipped === 0
    ? "七类全绿。"
    : "六类全绿；第 7 类命令冒烟跳过 " + skipped + " 条（未核）。";
  return ["（第 7 类：" + scope + "）", head];
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = main();
}
