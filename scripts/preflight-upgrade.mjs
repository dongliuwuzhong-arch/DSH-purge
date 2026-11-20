#!/usr/bin/env node
/**
 * 升级前预检：拿一棵**候选宿主树**（新版本解包后的 resources\app），
 * 只读地告诉你会发生什么——哪些补丁贴得上、哪些因为文本变了贴不上、哪些对这个树不适用。
 *
 * 用法：
 *   node scripts/preflight-upgrade.mjs --host "C:\path\to\resources\app"
 *   node scripts/preflight-upgrade.mjs --ai   "C:\path\to\...\node_modules\@deepseek-ai"
 *
 * 退出码：0 = 全贴得上；2 = 有补丁对不上（要先补模式）；1 = 用法/环境错误。
 * 不写任何文件：判断用 patchStatus()，锚点提示用只读文本比对。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { ALL_PATCHES, patchFileOutcome, patchStatus, targetFiles } from "../lib/core.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.dirname(HERE);

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--host" || a === "--ai") out[a.slice(2)] = argv[++i];
    else if (a === "--json") out.json = true;
    else if (a === "--save-baseline") out.saveBaseline = true;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

/** 从 host 目录推出 aiBase：rc.3 桌面布局是 <app>/dsh/node_modules/@deepseek-ai。 */
function resolveAiBase(host) {
  const cands = [
    path.join(host, "dsh", "node_modules", "@deepseek-ai"),
    path.join(host, "node_modules", "@deepseek-ai"),
  ];
  for (const c of cands) if (fs.existsSync(c)) return c;
  return "";
}

function hostVersions(host) {
  const shell = readJson(path.join(host, "package.json"));
  const runtime = readJson(path.join(host, "dsh", "package.json"));
  return {
    shell: shell ? `${shell.name}@${shell.version}` : "",
    runtime: runtime ? `${runtime.name}@${runtime.version}` : "",
  };
}

/** 桌面壳补丁（file: "desktop-shell"）在纯 node 里解析不到：officialShellMain() 要求
 *  detectSurface() === "desktop"，子进程里恒为 false，于是全部报成 na（假阴性）。
 *  这里改成直接读候选树里的壳入口自己判。 */
export function resolveShellMain(host) {
  for (const rel of [["lib", "main.js"], ["main.js"]]) {
    const p = path.join(host, ...rel);
    if (fs.existsSync(p)) return p;
  }
  return "";
}
export function classifyShellPatches(shellText, patches) {
  const out = { applied: [], pending: [], skipped: [] };
  for (const p of patches) {
    const verdict = patchFileOutcome(shellText, p, "shell://main.js");
    (out[verdict] ?? out.pending).push(p);
  }
  return out;
}

/** 取一条补丁在某个文件上的锚点（第一条 replacement 的第一句有意义的行）。 */
function firstAnchor(patch) {
  const reps = patch.replacements ?? [];
  for (const r of reps) {
    const text = String(r.pattern ?? "");
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (t.length >= 12 && !/^[})\];,]+$/.test(t)) return t;
    }
  }
  return "";
}

/** 在目标文件里找跟锚点最像的一行（只读，给"要不要重锚"一个方向）。 */
function nearestLine(file, anchor) {
  if (!anchor) return "";
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch { return ""; }
  const probe = anchor.slice(0, 24);
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(probe)) return `第 ${i + 1} 行: ${lines[i].trim().slice(0, 110)}`;
  }
  const head = anchor.slice(0, 10);
  for (let i = 0; i < lines.length; i++) {
    if (head && lines[i].includes(head)) return `第 ${i + 1} 行(近似): ${lines[i].trim().slice(0, 110)}`;
  }
  return "";
}

const BASELINE = path.join(HERE, "preflight-baseline.json");

function loadBaseline() {
  try { return JSON.parse(fs.readFileSync(BASELINE, "utf8")); } catch { return null; }
}
function idsOf(list) { return list.map((p) => p.id).sort((a, b) => a - b); }

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log("用法: node scripts/preflight-upgrade.mjs --host <resources\\app> | --ai <node_modules/@deepseek-ai>");
    return 0;
  }
  const host = args.host ? path.resolve(args.host) : "";
  const aiBase = args.ai ? path.resolve(args.ai) : host ? resolveAiBase(host) : "";
  if (!aiBase || !fs.existsSync(aiBase)) {
    console.error("找不到 @deepseek-ai 目录。用 --host <resources\\app> 或 --ai <...node_modules/@deepseek-ai>");
    return 1;
  }
  const pkg = readJson(path.join(REPO, "package.json")) ?? {};
  const versions = host ? hostVersions(host) : { shell: "", runtime: "" };
  const status = await patchStatus(aiBase);
  const files = targetFiles(aiBase);
  // 桌面壳：从 na 里摘出来，按候选树里的壳入口自己判（否则 #83/#84/#45/#46/#91 全是假阴性）。
  const shellMain = host ? resolveShellMain(host) : "";
  let shell = null;
  if (shellMain) {
    const shellPatches = ALL_PATCHES.filter((p) => [].concat(p.file ?? []).includes("desktop-shell"));
    if (shellPatches.length) {
      shell = classifyShellPatches(fs.readFileSync(shellMain, "utf8"), shellPatches);
      for (const p of shell.applied) status[p.id] = "applied";
      for (const p of shell.pending) status[p.id] = "pending";
      for (const p of shell.skipped) status[p.id] = "skipped";
    }
  }

  const buckets = { applied: [], pending: [], skipped: [], na: [], missing: [] };
  for (const p of ALL_PATCHES) {
    const s = status[p.id] ?? "missing";
    (buckets[s] ?? buckets.missing).push(p);
  }

  // 差分：绝对"skipped 4 条"在已知good的树上也存在（可选/布局软补丁），所以真正要看的
  // 是"比基线多跳过了哪些"。这才是"新版本把模式弄坏了"的信号。
  const baseline = args.saveBaseline ? null : loadBaseline();
  const shellSkipped = shell ? shell.skipped.map((p) => p.id) : [];
  const shellApplied = shell ? shell.applied.map((p) => p.id) : [];
  const nowSkipped = [...new Set([...idsOf(buckets.skipped), ...shellSkipped])].sort((a, b) => a - b);
  const baseSkipped = baseline ? [...(baseline.skipped ?? []), ...(baseline.shellSkipped ?? [])] : [];
  const baseApplied = baseline ? [...(baseline.applied ?? []), ...(baseline.shellApplied ?? [])] : [];
  const brokeIds = baseline
    ? nowSkipped.filter((id) => !baseSkipped.includes(id) && baseApplied.includes(id))
    : [];
  const baselineNote = baseline
    ? `基线: ${baseline.version || "?"}（applied ${(baseline.applied ?? []).length} / skipped ${(baseline.skipped ?? []).length}）`
    : "基线: 未记录（用 --save-baseline 在一棵已贴满的树上存一份，之后就能看差分）";

  if (args.saveBaseline) {
    fs.writeFileSync(BASELINE, JSON.stringify({
      version: versions.runtime || versions.shell || "",
      savedAt: new Date().toISOString(),
      applied: idsOf(buckets.applied),
      skipped: idsOf(buckets.skipped),
      shellApplied,
      shellSkipped,
    }, null, 2) + "\n", "utf8");
    console.log("已记录基线 → " + BASELINE);
    return 0;
  }

  if (args.json) {
    console.log(JSON.stringify({
      aiBase,
      target: pkg.dshTarget ?? "",
      versions,
      counts: Object.fromEntries(Object.entries(buckets).map(([k, v]) => [k, v.length])),
      pending: buckets.pending.map((p) => ({ id: p.id, name: p.name })),
      skipped: buckets.skipped.map((p) => ({ id: p.id, name: p.name })),
      shell: shell ? { main: shellMain, applied: shell.applied.length, pending: shell.pending.map((p) => p.id), skipped: shellSkipped } : null,
      baseline: baseline ? { version: baseline.version, brokeIds } : null,
    }, null, 2));
    return (baseline ? brokeIds.length : buckets.skipped.length + (shell ? shell.skipped.length : 0)) + buckets.missing.length > 0 ? 2 : 0;
  }

  console.log("预检目标: " + aiBase);
  if (versions.runtime || versions.shell) {
    console.log("宿主版本: " + [versions.shell, versions.runtime].filter(Boolean).join("  /  "));
  }
  const target = pkg.dshTarget ?? "(未标注)";
  const same = versions.runtime && versions.runtime.endsWith("@" + target);
  console.log("破甲基准: " + target + (versions.runtime ? (same ? "  ✓ 一致" : "  ⚠ 不一致，模式可能要重锚") : ""));
  console.log("");
  console.log(`补丁 ${ALL_PATCHES.length} 条：applied ${buckets.applied.length} / pending ${buckets.pending.length} / skipped ${buckets.skipped.length} / na ${buckets.na.length}`);

  const reportList = baseline ? buckets.skipped.filter((p) => brokeIds.includes(p.id)) : buckets.skipped;
  if (reportList.length) {
    console.log("\n⚠ 模式对不上、要重锚（前 12 条）：");
    for (const p of reportList.slice(0, 12)) {
      const keys = Array.isArray(p.file) ? p.file : [p.file];
      const file = (files[keys[0]] ?? [])[0] ?? "";
      console.log(`  #${p.id} ${p.name}`);
      console.log("     锚点: " + (firstAnchor(p) || "(无 replacement，可能是 legacy patterns)"));
      const near = file ? nearestLine(file, firstAnchor(p)) : "";
      if (near) console.log("     最像的一处: " + near);
    }
    if (reportList.length > 12) console.log("  …其余 " + (reportList.length - 12) + " 条同理");
  }
  if (shell) {
    console.log("\n桌面壳（独立核查 " + shellMain + "）：applied " + shell.applied.length +
      " / 待贴 " + shell.pending.length + " / 模式不匹配 " + shell.skipped.length);
    if (shell.pending.length) console.log("  待贴（装的时候会打上）: " + shell.pending.map((p) => "#" + p.id).join(" "));
    if (shell.skipped.length) console.log("  ⚠ 模式不匹配（要重锚）: " + shell.skipped.map((p) => "#" + p.id).join(" "));
  }
  if (buckets.na.length) {
    console.log("\n这棵树里不适用（文件不存在）：" + buckets.na.map((p) => "#" + p.id).join(" "));
  }
  if (buckets.pending.length) {
    console.log("\n待贴（新版本刚解包时的正常状态，装的时候会打上）: " + buckets.pending.map((p) => "#" + p.id).join(" "));
  }
  const broken = baseline
    ? brokeIds.length + buckets.missing.length
    : buckets.skipped.length + buckets.missing.length + (shell ? shell.skipped.length : 0);
  if (baseline) console.log("\n" + baselineNote);
  if (brokeIds.length) {
    console.log("⚠ 比基线多出来的\"跳过\"（这些才是新版本弄坏的）: " + brokeIds.map((id) => "#" + id).join(" "));
  }
  console.log("\n" + (broken === 0
    ? "结论：模式全对得上，可以换包。"
    : "结论：有 " + broken + " 条模式对不上——先重锚再换包，否则它们会静默落空。"));
  return broken === 0 ? 0 : 2;
}

import { pathToFileURL } from "node:url";
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().then((code) => { process.exitCode = code; }).catch((err) => {
    console.error("预检失败: " + (err?.message || err));
    process.exitCode = 1;
  });
}
