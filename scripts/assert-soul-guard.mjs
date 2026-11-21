#!/usr/bin/env node
// SOUL-GUARD 闸门：灵魂层（注入正文 + 破甲相关补丁）指纹比对。
// 语义一句话：这些对象只许原样搬运；真要改，得显式 --allow-soul-change 并重写基线 soul-guard.lock。
//
// 2026-11-22（V15 工程 P0-1 / F-01）：以前只哈希 lib/default-prompt-inject.md，
// 而**运行时真正注入的是 lib/asset-table.js 里的密封槽**（core.js defaultOverrideText() → openSlot()）。
// 两者早已不同步（实测 md 8151B / 槽 8251B，差 100 个 \r），门禁却照样全绿 —— 门守的不是生效对象。
// 现在的口径：
//   source   = 归一化后的 md 正文（**源**，人改的就是它）
//   injected = 归一化后的槽正文（**生成物**，运行时注入的就是它）
//   两者必须相等：不等就是"改了 md 忘了 embed"或"槽被单独动过"，红。
//   槽与 md 的**逐字节**差异只允许是行尾（CRLF vs LF），且这个差值记在 lock 的 eolDelta 里；
//   差的不只是行尾、或行尾数变了，一样红。
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ALL_PATCHES } from "../lib/core.js";
import { openSlot } from "../lib/table-read.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCK = path.join(ROOT, "soul-guard.lock");

// 注入正文本身：这是源，人改它，槽是它的生成物。
const SOUL_FILES = ["lib/default-prompt-inject.md"];
const SOURCE_REL = SOUL_FILES[0];
// 决定「身份是谁、注入在哪、还在不在」的补丁：改一个字符就是改灵魂。
const SOUL_PATCH_IDS = new Set([1, 2, 3, 4, 25, 26, 32, 40, 43, 55, 66, 71, 73, 76, 87, 101]);

const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
const short = (hex) => String(hex ?? "").slice(0, 12);
const crlf = (text) => (String(text ?? "").match(/\r\n/g) || []).length;
/** 归一化：与 core.js 的 normalizeOverride 同口径（CRLF → LF、去首尾空白）。 */
export function normalizeEol(text) {
  return String(text ?? "").replace(/\r\n/g, "\n").trim();
}

/** 槽（生成物）与 md（源）的比对。纯函数，测试直接喂两段文本。 */
export function compareSlot(mdRaw, slotRaw) {
  const md = normalizeEol(mdRaw);
  const slot = normalizeEol(slotRaw);
  let firstDiff = -1;
  const limit = Math.min(String(mdRaw).length, String(slotRaw).length);
  for (let i = 0; i < limit; i += 1) {
    if (mdRaw[i] !== slotRaw[i]) { firstDiff = i; break; }
  }
  if (firstDiff < 0 && String(mdRaw).length !== String(slotRaw).length) {
    firstDiff = Math.min(String(mdRaw).length, String(slotRaw).length);
  }
  return {
    identical: String(mdRaw ?? "") === String(slotRaw ?? ""),
    contentEqual: Boolean(md) && md === slot,
    eolDelta: crlf(mdRaw) - crlf(slotRaw),
    mdBytes: Buffer.byteLength(String(mdRaw ?? "")),
    slotBytes: Buffer.byteLength(String(slotRaw ?? "")),
    firstDiff,
  };
}

// 稳定序列化：patch 条目里有 RegExp，直接 JSON.stringify 会变成 {}。
function stable(value) {
  if (value instanceof RegExp) return { $regex: value.source, flags: value.flags };
  if (typeof value === "function") return { $fn: String(value) };
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = stable(value[k]);
    return out;
  }
  return value;
}

function patchHashes() {
  const patches = {};
  for (const p of ALL_PATCHES) {
    if (!SOUL_PATCH_IDS.has(Number(p.id))) continue;
    patches[String(p.id)] = sha(
      JSON.stringify(
        stable({
          id: p.id,
          name: p.name,
          file: p.file,
          rel: p.rel,
          optional: p.optional === true,
          skipIfMarked: p.skipIfMarked === true,
          markersAny: p.markersAny === true,
          markers: p.markers || null,
          replacements: p.replacements || null,
        }),
      ),
    );
  }
  const presetPatches = ALL_PATCHES.filter((p) => Array.isArray(p.rel) && p.rel[0] === ".agent-presets")
    .map((p) => String(p.id))
    .sort();
  return { patches, presetPatches };
}

function mdPath() {
  return path.join(ROOT, SOURCE_REL);
}

function readSource() {
  const fp = mdPath();
  return fs.existsSync(fp) ? fs.readFileSync(fp, "utf8") : null;
}

function fingerprint(mdRaw, slotRaw) {
  const files = {};
  for (const rel of SOUL_FILES) {
    files[rel] = mdRaw === null ? null : sha(Buffer.from(mdRaw, "utf8"));
  }
  const { patches, presetPatches } = patchHashes();
  const sync = compareSlot(mdRaw ?? "", slotRaw);
  const payload = {
    version: 2,
    files,
    source: mdRaw === null ? null : sha(Buffer.from(normalizeEol(mdRaw), "utf8")),
    injected: sha(Buffer.from(normalizeEol(slotRaw), "utf8")),
    slotRaw: sha(Buffer.from(String(slotRaw ?? ""), "utf8")),
    eolDelta: sync.eolDelta,
    patches,
    presetPatches,
  };
  return { ...payload, digest: sha(JSON.stringify(payload)) };
}

/** 同步检查：源与生成物必须一致。返回 { problems, notices }。 */
export function syncProblems(mdRaw, slotRaw, expectedEolDelta) {
  const problems = [];
  const notices = [];
  const sync = compareSlot(mdRaw ?? "", slotRaw ?? "");
  const tail = `md ${sync.mdBytes}B / 槽 ${sync.slotBytes}B，首差字符偏移 ${sync.firstDiff}`;
  if (mdRaw === null) {
    problems.push(`-${SOURCE_REL} 不在仓库里：注入正文的源没了`);
  } else if (!String(slotRaw ?? "").trim()) {
    problems.push("-lib/asset-table.js 的密封槽解不出来（空/损坏/表密钥不匹配）——运行时注入的是空正文");
  } else if (!sync.contentEqual) {
    problems.push(
      `-注入的字节与源不同步：归一行尾后仍不同（${tail}）。源是 ${SOURCE_REL}，生成物是 lib/asset-table.js 的槽` +
        "，改完源忘了重跑 npm run embed-prompt，或者槽被单独改过",
    );
  } else if (!sync.identical) {
    const expected = Number(expectedEolDelta);
    if (!Number.isFinite(expected) || expected !== sync.eolDelta) {
      problems.push(
        `-槽与源的逐字节差异不再是"已知的行尾差"（${tail}，CRLF 差 ${sync.eolDelta}，基线记的是 ${String(expectedEolDelta)}）` +
          "——除了行尾还有别的改动，或行尾数变了",
      );
    } else {
      notices.push(
        `槽与 ${SOURCE_REL} 只差行尾（${tail}，CRLF 差 ${sync.eolDelta}）：源是 md，槽是生成物。` +
          "重跑 npm run embed-prompt 会把槽的行尾改成 LF，届时用 --update 重写基线。",
      );
    }
  }
  return { problems, notices, sync };
}

function diff(lock, now) {
  const out = [];
  for (const rel of SOUL_FILES) {
    if (lock.files?.[rel] !== now.files[rel]) {
      out.push(`-${rel}：注入正文的字节变了（基线 ${short(lock.files?.[rel])} → 现在 ${short(now.files[rel])}）`);
    }
  }
  if (lock.source !== now.source) {
    out.push(`-注入源的归一化内容变了（${short(lock.source)} → ${short(now.source)}）`);
  }
  if (lock.injected !== now.injected) {
    out.push(`-密封槽注入的归一化内容变了，运行时注入的就是它（${short(lock.injected)} → ${short(now.injected)}）`);
  }
  const ids = new Set([...Object.keys(lock.patches || {}), ...Object.keys(now.patches)]);
  for (const id of [...ids].sort((a, b) => Number(a) - Number(b))) {
    const before = lock.patches?.[id];
    const after = now.patches[id];
    if (before === after) continue;
    if (!after) out.push(`-补丁 #${id}：不在灵魂层清单里了`);
    else if (!before) out.push(`-补丁 #${id}：新进入灵魂层清单`);
    else out.push(`-补丁 #${id}：内容变了`);
  }
  if (JSON.stringify(lock.presetPatches || []) !== JSON.stringify(now.presetPatches)) {
    out.push(`-破甲预设补丁集合：[${(lock.presetPatches || []).join(",")}] → [${now.presetPatches.join(",")}]`);
  }
  return out;
}

function main() {
  const args = process.argv.slice(2);
  const allow = args.includes("--allow-soul-change");
  const update = args.includes("--update");
  const mdRaw = readSource();
  const slotRaw = openSlot();
  const now = fingerprint(mdRaw, slotRaw);

  if (update) {
    fs.writeFileSync(LOCK, JSON.stringify(now, null, 2) + "\n");
    console.log(
      `soul-guard.lock 已重写：${Object.keys(now.patches).length} 条补丁 + ${SOUL_FILES.length} 个文件，` +
        `注入源 ${short(now.source)} / 槽 ${short(now.injected)}，digest ${short(now.digest)}`,
    );
    const { notices } = syncProblems(mdRaw, slotRaw, now.eolDelta);
    for (const line of notices) console.log("  " + line);
    process.exit(0);
  }

  if (!fs.existsSync(LOCK)) {
    console.error("soul-guard.lock 不存在：先跑 node scripts/assert-soul-guard.mjs --update");
    process.exit(1);
  }

  const lock = JSON.parse(fs.readFileSync(LOCK, "utf8"));
  const payloadLock = {
    version: lock.version,
    files: lock.files,
    source: lock.source,
    injected: lock.injected,
    slotRaw: lock.slotRaw,
    eolDelta: lock.eolDelta,
    patches: lock.patches,
    presetPatches: lock.presetPatches,
  };
  const lockDigest = lock.digest || sha(JSON.stringify(payloadLock));
  const { problems: syncBad, notices } = syncProblems(mdRaw, slotRaw, lock.eolDelta);

  if (lockDigest === now.digest && !syncBad.length) {
    console.log(
      `soul-guard ok：${SOUL_FILES.length} 个注入文件 + ${Object.keys(now.patches).length} 条破甲补丁与基线一致` +
        `（注入源 ${short(now.source)} / 槽 ${short(now.injected)}，digest ${short(now.digest)}）`,
    );
    for (const line of notices) console.log("  " + line);
    process.exit(0);
  }

  const items = syncBad.concat(diff(lock, now));
  console.error("SOUL-GUARD 越界：灵魂层被改动");
  for (const line of items) console.error("  " + line);
  if (!items.length) {
    console.error("  （指纹不一致但逐项没差异：基线文件格式问题，重跑 --update）");
  }
  if (allow) {
    console.error("已显式放行（--allow-soul-change）：提交信息里必须写清为什么改灵魂。");
    for (const line of notices) console.error("  " + line);
    process.exit(0);
  }
  console.error("要么回退，要么在提交信息里写明理由后重写基线：node scripts/assert-soul-guard.mjs --update");
  process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
