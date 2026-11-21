#!/usr/bin/env node
/**
 * 升级前预检：拿一棵**候选宿主树**（新版本解包后的 resources\app），
 * 只读地告诉你会发生什么——哪些补丁贴得上、哪些因为文本变了贴不上、哪些对这个树不适用。
 *
 * 用法：
 *   node scripts/preflight-upgrade.mjs --host "C:\path\to\resources\app"
 *   node scripts/preflight-upgrade.mjs --ai   "C:\path\to\...\node_modules\@deepseek-ai"
 *
 * 退出码契约（2026-11-16 按 S3 审计严重 5 重写，与 docs/zh/07-upgrade-playbook.md 对齐）：
 *   0 = 没有需要处理的失配，可以换包。
 *   2 = 有失配，分两种情形：
 *       · 无基线：只看"非 optional 的 skipped"（+ 桌面壳里非 optional 的 skipped；
 *         + 显式给 --strict-missing 时的 missing）。
 *         **optional skipped 和 na 一律不进退出码**——现网这棵健康的树本来就有 4 条
 *         optional 跳过、9 条 na，健康树不该因此退 2（S3 审计实测旧版就退 2）。
 *       · 有基线：只看漂移，即"基线里贴得上、这棵树贴不上"。
 *   1 = 用法/环境错误（找不到 @deepseek-ai 目录）。
 * 不写任何文件（--save-baseline 除外）：判断用 patchStatus()，锚点提示用只读文本比对。
 *
 * 链式判定（2026-11-16 C1）：判完之后还会在**内存里**按 ALL_PATCHES 顺序干跑一遍
 * （chainDryRun），再对每条补丁修正一次结论，因为有两类补丁会被逐条独立判定误报：
 *   ①二段补丁——锚点由前序补丁插入（#46←#45、#84←#83、#91←#83、#101←#87）。
 *     pristine 树上必然 skipped，装的时候却一定打得进去。链上判得出 → 记 pending + 单列。
 *   ②profile 专属目标——目标文件在 profile（.dsh/profiles、.agent-presets）里，
 *     候选树（新版本解包的 resources/app）根本不含它们。#24/#71 就是这种。
 *     记 missing 并单列"profile 提供"，不算坏。
 *   链上仍 skipped 且不是 profile 专属的，照旧算"要重锚"——真坏不会被吞。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ALL_PATCHES, applyReplacementsToText, patchFileOutcome, patchStatus, readExcludePatches, targetFiles,
} from "../lib/core.js";

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
    else if (a === "--strict-missing") out.strictMissing = true;
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

/** 候选树里每条补丁实际落在哪些文件上。桌面壳要单独塞进去：targetFiles() 在子进程里
 *  解析不到它（officialShellMain() 要求 detectSurface()==="desktop"，恒为 false）。 */
export function chainTargetFiles(files, shellMain = "") {
  const out = { ...(files ?? {}) };
  if (shellMain) out["desktop-shell"] = shellMain;
  return out;
}

/**
 * 链式干跑（C1 · 2026-11-16）：把候选树的目标文件读进内存，按 ALL_PATCHES 的顺序逐条判、
 * 逐条贴，再对每条记录 applied / pending / skipped。
 *
 * 为什么要有这一步：rc.5 上 #46 的锚点由 #45 插入、#84 由 #83 插入、#91 由 #83 插入、
 * #101 由 #87 插入。pristine 树上这四条**必然** skipped——旧版逐条独立判定，于是把它们
 * 当成"模式对不上"报进漂移（实测 rc.5 的 6 条 drift 里 4 条是这么来的）。
 *
 * 只在内存里改文本，不写任何文件。判据不复刻 core.js：每条都走同一个
 * patchFileOutcome / applyReplacementsToText，避免预检和应用两侧语义漂移。
 *
 * 返回 Map<id, rec>：
 *   rec.verdict   applied（链上贴得上）| pending（待贴）| skipped（贴不上）| profile（不在树里）
 *   rec.absentKeys  候选树里根本没有的 file key（profile 专属目标）
 *   rec.skippedKeys 贴不上的 key
 *   rec.deps     这条是"二段补丁"时，前序究竟是谁把锚点插进来的
 */
/**
 * 二段补丁的依赖是"实证"出来的，不是记 last-writer：把每个前序补丁单独贴到原始文本上，
 * 看哪一条一贴就能让这条从 skipped 变成可贴。返回最早的那一条。
 * （#91 就是例子：#83 插锚点、#84/#82 又改写同一块，记 last-writer 会指到 #82 上。）
 */
export function firstDependency(patches, patch, paths, pristine) {
  const at = patches.indexOf(patch);
  if (at <= 0) return [];
  for (let i = 0; i < at; i += 1) {
    const q = patches[i];
    const shares = paths.some((fp) => {
      const base = pristine.get(fp);
      if (typeof base !== "string") return false;
      const applied = applyReplacementsToText(base, q, fp);
      if (!applied.changed) return false;
      return patchFileOutcome(applied.text, patch, fp) !== "skipped";
    });
    if (shares) return [q.id];
  }
  return [];
}

export function chainDryRun(patches, files) {
  const pristine = new Map();
  const working = new Map();
  const load = (fp) => {
    if (pristine.has(fp)) return pristine.get(fp);
    let text = null;
    try { text = fs.readFileSync(fp, "utf8"); } catch { text = null; }
    pristine.set(fp, text);
    working.set(fp, text);
    return text;
  };
  const lastMutator = new Map();
  const out = new Map();
  for (const p of patches) {
    const keys = Array.isArray(p.file) ? p.file : [p.file];
    const absentKeys = [];
    const paths = [];
    for (const key of keys) {
      const list = [].concat(files?.[key] ?? []).filter(Boolean);
      if (!list.length) { absentKeys.push(key); continue; }
      for (const fp of list) { load(fp); if (!paths.includes(fp)) paths.push(fp); }
    }
    const rec = {
      id: p.id, absentKeys, paths, applied: 0, chained: 0, pending: 0, skipped: 0,
      skippedKeys: [], deps: [], name: p.name,
    };
    for (const fp of paths) {
      const baseText = pristine.get(fp);
      const nowText = working.get(fp);
      const baseVerdict = typeof baseText === "string" ? patchFileOutcome(baseText, p, fp) : "pending";
      const nowVerdict = typeof nowText === "string" ? patchFileOutcome(nowText, p, fp) : "pending";
      if (nowVerdict === "pending") {
        // 原始文本上贴不上、链上前序插入之后才贴得上 → 这条也是二段补丁，记下是谁给的锚点。
        if (baseVerdict === "skipped") {
          for (const id of lastMutator.get(fp) ?? []) if (!rec.deps.includes(id)) rec.deps.push(id);
        }
        if (typeof nowText === "string") {
          const next = applyReplacementsToText(nowText, p, fp);
          if (next.changed) { working.set(fp, next.text); lastMutator.set(fp, [p.id]); }
        }
        rec.pending += 1;
        continue;
      }
      if (nowVerdict === "applied") {
        if (baseVerdict === "applied") rec.applied += 1;
        else {
          rec.chained += 1;
          for (const id of lastMutator.get(fp) ?? []) if (!rec.deps.includes(id)) rec.deps.push(id);
        }
        continue;
      }
      rec.skipped += 1;
      const key = keys.find((k) => [].concat(files?.[k] ?? []).includes(fp)) ?? keys[0];
      if (!rec.skippedKeys.includes(key)) rec.skippedKeys.push(key);
    }
    rec.verdict = rec.pending > 0 ? "pending"
      : rec.applied + rec.chained > 0 ? "applied"
        : rec.skipped > 0 ? "skipped"
          : "profile";
    // 二段补丁 = 原始文本上一条都贴不上、靠链上前序插入才成立。
    rec.chainOnly = rec.verdict !== "skipped" && paths.length > 0
      && paths.every((fp) => {
        const t = pristine.get(fp);
        return typeof t !== "string" || patchFileOutcome(t, p, fp) === "skipped";
      });
    if (rec.chainOnly) rec.deps = firstDependency(patches, p, paths, pristine);
    out.set(p.id, rec);
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

/**
 * 把链式干跑的结论写回 status（就地改；shell 的 skipped 也一并搬走）。
 * 只做两件事，第三件（真坏）故意不做：
 *   ①链上能贴、孤立判定贴不上的 → pending（装的时候会按顺序打上），并记进 chainRescued；
 *   ②profile 专属目标（没有任何候选树内的文件，或链上仍贴不上但还有 key 不在这棵树里）
 *     → missing + 记进 profileProvided。'na'（这套 surface 本来不适用）不参与改写。
 *   链上仍 skipped、又没有 profile key 的，原样留在 skipped 里继续当"要重锚"。
 */
export function applyChainStatus({ status, chain, excluded = new Set(), shell = null, patches = ALL_PATCHES }) {
  const chainRescued = [];
  const profileProvided = [];
  for (const p of patches) {
    if (excluded.has(Number(p.id))) continue;
    const rec = chain.get(p.id);
    if (!rec) continue;
    const before = status[p.id];
    if (rec.verdict === "applied" || rec.verdict === "pending") {
      if (before !== undefined && before !== "applied" && before !== "pending") {
        status[p.id] = "pending";
        chainRescued.push({ id: p.id, name: p.name, verdict: rec.verdict, deps: rec.deps });
        if (shell) {
          const at = shell.skipped.findIndex((q) => q.id === p.id);
          if (at >= 0) shell.pending.push(shell.skipped.splice(at, 1)[0]);
        }
      }
      continue;
    }
    const profileLike = rec.verdict === "profile"
      || (rec.verdict === "skipped" && rec.absentKeys.length > 0);
    const reclassifiable = before === "skipped" || before === "missing_file" || before === undefined;
    if (profileLike && reclassifiable) {
      status[p.id] = "missing";
      profileProvided.push(rec);
    }
  }
  return { chainRescued, profileProvided };
}

/** 把补丁分进五个桶（applied/pending/skipped/na/missing）+ 排除桶。
 *  被 exclude-patches.json 排掉的 id 不在 patchStatus 里，必须先扣掉，否则会掉进 missing
 *  （S3 审计 S6；S4 实测 #19 就是这么被算成"缺文件"的）。 */
export function bucketPatches(patches, status, excluded = new Set()) {
  const buckets = { applied: [], pending: [], skipped: [], na: [], missing: [], excluded: [] };
  for (const p of patches) {
    if (excluded.has(Number(p.id))) { buckets.excluded.push(p); continue; }
    const verdict = status[p.id] ?? "missing";
    (buckets[verdict] ?? buckets.missing).push(p);
  }
  return buckets;
}

/** 摘要行的算术：五桶之和 + excluded 必须等于补丁总数。分母永远是 ALL_PATCHES.length（1.5 起 77），
 *  这里不写死任何数字；S4 当年那张表是 88 条，实测 73+1+4+9=87≠88 才暴露出「少打一个桶」。 */
export function summarizeCounts(buckets, patchCount = ALL_PATCHES.length) {
  const sums = {};
  for (const k of ["applied", "pending", "skipped", "na", "missing", "excluded"]) {
    sums[k] = (buckets?.[k] ?? []).length;
  }
  const counted = sums.applied + sums.pending + sums.skipped + sums.na + sums.missing;
  return { ...sums, counted, total: patchCount, balanced: counted + sums.excluded === patchCount };
}

/** 漂移 = 基线里贴得上、这棵树贴不上（skipped / na / missing / 壳 skipped）。
 *  只看 skipped 会漏掉"文件被删/改名"和"变成 na"这两种更常见的升级后果。 */
export function computeDrift(buckets, shellSkippedIds = [], baseline = null, profileIds = []) {
  if (!baseline) return [];
  const exempt = new Set(profileIds.map((id) => Number(id)));
  const nowNotApplied = [...new Set([
    ...idsOf(buckets.skipped), ...idsOf(buckets.na), ...idsOf(buckets.missing), ...shellSkippedIds,
  ])].sort((a, b) => a - b);
  const baseApplied = [...(baseline.applied ?? []), ...(baseline.shellApplied ?? [])];
  const baseSkipped = [...(baseline.skipped ?? []), ...(baseline.shellSkipped ?? [])];
  // profile 提供的那几条不算漂移：它们的贴点在 profile 里（.dsh/profiles 或 .agent-presets），
  // 候选树（新版本解包的 resources/app）本来就不含这些文件，换包不会碰到它们。
  return nowNotApplied.filter((id) => !exempt.has(Number(id)) && baseApplied.includes(id) && !baseSkipped.includes(id));
}

/** 退出码判定。契约见文件头：无基线只看非 optional 失配，有基线只看漂移。
 *  optional skipped / na 永不进退出码。 */
export function exitVerdict({ buckets, shell = null, baseline = null, strictMissing = false, profileIds = [] }) {
  const shellSkippedIds = shell ? idsOf(shell.skipped) : [];
  const drift = computeDrift(buckets, shellSkippedIds, baseline, profileIds);
  // 被 profile 豁免掉的那部分单独留一份：不计漂移，但必须看得见（装作没看见才是真吞）。
  const profileSet = new Set(profileIds.map((id) => Number(id)));
  const profileDrift = baseline
    ? computeDrift(buckets, shellSkippedIds, baseline, []).filter((id) => profileSet.has(Number(id)))
    : [];
  const hard = baseline ? [] : [
    ...buckets.skipped.filter((p) => !p.optional).map((p) => p.id),
    ...(shell ? shell.skipped.filter((p) => !p.optional).map((p) => p.id) : []),
  ];
  const missing = strictMissing ? idsOf(buckets.missing) : [];
  const blocking = (baseline ? drift.length : hard.length) + missing.length;
  return {
    code: blocking > 0 ? 2 : 0, mode: baseline ? "baseline" : "no-baseline",
    drift, profileDrift, hard, missing, blocking,
  };
}

/** 报告正文。除了 nearestLine 那个只读锚点提示，全是纯函数 —— 测试直接喂桶。 */
export function renderReport(ctx) {
  const {
    aiBase = "",
    versions = {},
    target = "(未标注)",
    buckets,
    shell = null,
    shellMain = "",
    baseline = null,
    strictMissing = false,
    files = {},
    patchCount = ALL_PATCHES.length,
    chainRescued = [],
    profileProvided = [],
  } = ctx;
  const lines = [];
  const sum = summarizeCounts(buckets, patchCount);
  const profileIds = profileProvided.map((p) => p.id);
  const verdict = exitVerdict({ buckets, shell, baseline, strictMissing, profileIds });
  const softSkipped = buckets.skipped.filter((p) => p.optional);
  const brokenSkipped = buckets.skipped.filter((p) => !p.optional);

  lines.push("预检目标: " + aiBase);
  if (versions.runtime || versions.shell) {
    lines.push("宿主版本: " + [versions.shell, versions.runtime].filter(Boolean).join("  /  "));
  }
  const same = versions.runtime && versions.runtime.endsWith("@" + target);
  lines.push("破甲基准: " + target + (versions.runtime ? (same ? "  ✓ 一致" : "  ⚠ 不一致，模式可能要重锚") : ""));
  lines.push("");

  // 五个桶全打出来，并当场对账（S4 实测：旧版只打四个桶，87≠88 那种差额看不出来）。
  const bucketText = `applied ${sum.applied} / pending ${sum.pending} / skipped ${sum.skipped}（可选 ${softSkipped.length}、要重锚 ${brokenSkipped.length}）`
    + ` / na ${sum.na} / missing ${sum.missing}`
    + (sum.excluded ? ` / excluded ${sum.excluded}` : "");
  const account = sum.balanced
    ? `合计 ${sum.counted}${sum.excluded ? ` + 排除 ${sum.excluded}` : ""} = ${sum.total} ✓`
    : `合计 ${sum.counted}${sum.excluded ? ` + 排除 ${sum.excluded}` : ""} ≠ ${sum.total}（分桶算错了，按 bug 处理）`;
  lines.push(`补丁 ${patchCount} 条：${bucketText}  ——  ${account}`);

  // 二段补丁（C1）：锚点由前序补丁插入，pristine 树上必然贴不上。
  // 逐条独立判定会把它们报成"要重锚"——rc.5 实测 6 条 drift 里有 4 条就是这么来的。
  if (chainRescued.length) {
    lines.push("");
    lines.push("链上可贴（锚点由前序补丁插入，孤立判定必然贴不上；装的时候会按顺序打上）:");
    for (const r of chainRescued) {
      const deps = r.deps && r.deps.length ? r.deps.map((id) => "#" + id).join(" + ") : "?";
      lines.push("  #" + r.id + " ← " + deps + (r.name ? "  " + r.name : ""));
    }
  }

  if (brokenSkipped.length) {
    lines.push("");
    lines.push("⚠ 模式对不上、要重锚（前 12 条）：");
    for (const p of brokenSkipped.slice(0, 12)) {
      const keys = Array.isArray(p.file) ? p.file : [p.file];
      const file = (files[keys[0]] ?? [])[0] ?? "";
      lines.push(`  #${p.id} ${p.name}`);
      lines.push("     锚点: " + (firstAnchor(p) || "(无 replacement，可能是 legacy patterns)"));
      const near = file ? nearestLine(file, firstAnchor(p)) : "";
      if (near) lines.push("     最像的一处: " + near);
    }
    if (brokenSkipped.length > 12) lines.push("  …其余 " + (brokenSkipped.length - 12) + " 条同理");
  }

  if (shell) {
    lines.push("");
    lines.push("桌面壳（独立核查 " + shellMain + "）：applied " + shell.applied.length +
      " / 待贴 " + shell.pending.length + " / 模式不匹配 " + shell.skipped.length);
    if (shell.pending.length) lines.push("  待贴（装的时候会打上）: " + shell.pending.map((p) => "#" + p.id).join(" "));
    const shellBroken = shell.skipped.filter((p) => !p.optional);
    if (shell.skipped.length) {
      const soft = shell.skipped.filter((p) => p.optional).map((p) => "#" + p.id).join(" ");
      lines.push("  跳过（可选，正常）: " + soft +
        (shellBroken.length ? "\n  ⚠ 模式不匹配（要重锚）: " + shellBroken.map((p) => "#" + p.id).join(" ") : ""));
    }
  }

  const plainMissing = buckets.missing.filter((p) => !profileIds.includes(p.id));
  if (plainMissing.length) {
    lines.push("");
    lines.push("目标文件不在这棵树里（通常是 profile 插件，换包后由 profile 提供）: " +
      plainMissing.map((p) => "#" + p.id + "(" + [].concat(p.file).join("/") + ")").join(" "));
  }
  if (profileProvided.length) {
    lines.push("");
    lines.push("profile 提供（贴点在 profile 里、候选树里没有这些文件，换包不动它，不算坏）:");
    for (const rec of profileProvided) {
      const where = rec.absentKeys.join("/") || "?";
      const inTree = rec.skippedKeys.length
        ? "  ⚠ 候选树内另有 " + rec.skippedKeys.length + " 个 key 贴不上（" + rec.skippedKeys.join("/") +
          "）——这条在候选树里判不了，换包前对照现网"
        : "";
      lines.push("  #" + rec.id + " profile: " + where + inTree);
    }
  }
  if (buckets.na.length) {
    lines.push("");
    lines.push("这棵树里不适用（文件不存在）：" + buckets.na.map((p) => "#" + p.id).join(" "));
  }
  if (buckets.pending.length) {
    lines.push("");
    lines.push("待贴（新版本刚解包时的正常状态，装的时候会打上）: " + buckets.pending.map((p) => "#" + p.id).join(" "));
  }
  if (buckets.excluded.length) {
    lines.push("");
    lines.push("已排除（exclude-patches.json，不计入任何判定）: " + buckets.excluded.map((p) => "#" + p.id).join(" "));
  }

  // 漂移段只此一处：无基线不打；有基线也只打一遍（S4 实测 rc.5 上同一批 id 打了两遍）。
  if (baseline) {
    lines.push("");
    lines.push(`基线: ${baseline.version || "?"}（applied ${(baseline.applied ?? []).length} / skipped ${(baseline.skipped ?? []).length}）`);
    lines.push(verdict.drift.length
      ? "⚠ 相对基线漂移（基线里贴得上、这棵树贴不上）: " + verdict.drift.map((id) => "#" + id).join(" ")
      : "相对基线无漂移。");
    if (verdict.profileDrift.length) {
      lines.push("profile 提供（基线里贴得上、候选树里没有这些文件；不计漂移）: " +
        verdict.profileDrift.map((id) => "#" + id).join(" "));
    }
  }

  lines.push("");
  lines.push(verdict.code === 0
    ? "结论：模式全对得上，可以换包。"
    : "结论：有 " + verdict.blocking + " 条要处理（" +
      (baseline ? "漂移 " + verdict.drift.length + " 条" : "模式对不上 " + verdict.hard.length + " 条") +
      (strictMissing && verdict.missing.length ? "，显式 --strict-missing 的缺文件 " + verdict.missing.length + " 条" : "") +
      "）——先重锚再换包，否则它们会静默落空。");

  return { lines, verdict, sum };
}

const HELP = [
  "用法: node scripts/preflight-upgrade.mjs --host <resources\\app> | --ai <node_modules/@deepseek-ai>",
  "",
  "选项:",
  "  --json            机器可读输出（含五个桶的计数、漂移 id、退出码）",
  "  --save-baseline   把这棵树的 applied/skipped 记进 scripts/preflight-baseline.json，然后退 0",
  "  --strict-missing  让 missing（目标文件不在这棵树里）也参与判定",
  "",
  "链式判定:",
  "  先在内存里按补丁顺序干跑一遍再出结论。二段补丁（锚点由前序补丁插入）记「链上可贴」，",
  "  profile 专属目标（文件在 profile 里、候选树没有）记「profile 提供」，都不算漂移；",
  "  链上仍贴不上又不在 profile 里的，照旧报「要重锚」。",
  "",
  "退出码:",
  "  0  没有要处理的失配，可以换包",
  "  2  有失配：无基线时=非 optional 的 skipped（含桌面壳）；有基线时=相对基线漂移",
  "     optional skipped / na 永不进退出码——健康的现网树本来就有 4 条可选跳过、9 条 na",
  "  1  用法/环境错误",
].join("\n");

async function main() {
  const args = parseArgs(process.argv);
  if (args.help) {
    console.log(HELP);
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

  const excluded = readExcludePatches();
  // 链式判定（C1）：先在内存里按 ALL_PATCHES 顺序干跑一遍，再据此修 status。
  // 只修两种：①二段补丁（孤立判定 skipped、链上能贴）→ 记 pending；
  //           ②profile 专属目标（key 在候选树里不存在、链上也贴不上）→ 记 missing 并单列。
  // 其余原样不动：链上仍 skipped 且不是 profile 专属的，照旧算"要重锚"。
  const chain = chainDryRun(
    ALL_PATCHES.filter((p) => !excluded.has(Number(p.id))),
    chainTargetFiles(files, shellMain),
  );
  const { chainRescued, profileProvided } = applyChainStatus({ status, chain, excluded, shell });
  const buckets = bucketPatches(ALL_PATCHES, status, excluded);

  if (args.saveBaseline) {
    fs.writeFileSync(BASELINE, JSON.stringify({
      version: versions.runtime || versions.shell || "",
      savedAt: new Date().toISOString(),
      applied: idsOf(buckets.applied),
      skipped: idsOf(buckets.skipped),
      shellApplied: shell ? shell.applied.map((p) => p.id) : [],
      shellSkipped: shell ? shell.skipped.map((p) => p.id) : [],
    }, null, 2) + "\n", "utf8");
    console.log("已记录基线 → " + BASELINE);
    return 0;
  }

  const baseline = loadBaseline();
  const target = pkg.dshTarget ?? "(未标注)";
  const report = renderReport({
    aiBase, versions, target, buckets, shell, shellMain, baseline,
    strictMissing: args.strictMissing === true, files, chainRescued, profileProvided,
  });

  if (args.json) {
    console.log(JSON.stringify({
      aiBase,
      target,
      versions,
      counts: report.sum,
      pending: buckets.pending.map((p) => ({ id: p.id, name: p.name })),
      skipped: buckets.skipped.filter((p) => p.optional).map((p) => ({ id: p.id, name: p.name })),
      broken: buckets.skipped.filter((p) => !p.optional).map((p) => ({ id: p.id, name: p.name })),
      missing: buckets.missing.map((p) => ({ id: p.id, name: p.name })),
      excluded: buckets.excluded.map((p) => p.id),
      shell: shell ? {
        main: shellMain,
        applied: shell.applied.length,
        pending: shell.pending.map((p) => p.id),
        skipped: shell.skipped.map((p) => p.id),
      } : null,
      chain: {
        rescued: chainRescued.map((r) => ({ id: r.id, deps: r.deps, verdict: r.verdict })),
        profile: profileProvided.map((r) => ({
          id: r.id, absentKeys: r.absentKeys, inTreeSkipped: r.skippedKeys,
        })),
      },
      baseline: baseline ? {
        version: baseline.version, drift: report.verdict.drift, profileDrift: report.verdict.profileDrift,
      } : null,
      exit: report.verdict,
    }, null, 2));
    return report.verdict.code;
  }

  for (const line of report.lines) console.log(line);
  return report.verdict.code;
}

import { pathToFileURL } from "node:url";
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().then((code) => { process.exitCode = code; }).catch((err) => {
    console.error("预检失败: " + (err?.message || err));
    process.exitCode = 1;
  });
}
