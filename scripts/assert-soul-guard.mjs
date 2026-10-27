#!/usr/bin/env node
// SOUL-GUARD 闸门：灵魂层（注入正文 + 破甲相关补丁）指纹比对。
// 语义一句话：这些对象只许原样搬运；真要改，得显式 --allow-soul-change 并重写基线 soul-guard.lock。
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_PATCHES } from "../lib/core.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCK = path.join(ROOT, "soul-guard.lock");

// 注入正文本身。
const SOUL_FILES = ["lib/default-prompt-inject.md"];
// 决定「身份是谁、注入在哪、还在不在」的补丁：改一个字符就是改灵魂。
const SOUL_PATCH_IDS = new Set([1, 2, 3, 4, 25, 26, 32, 40, 43, 55, 66, 71, 73, 76, 87, 89]);

const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");

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

function fingerprint() {
  const files = {};
  for (const rel of SOUL_FILES) {
    const fp = path.join(ROOT, rel);
    files[rel] = fs.existsSync(fp) ? sha(fs.readFileSync(fp)) : null;
  }
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
  const payload = { version: 1, files, patches, presetPatches };
  return { ...payload, digest: sha(JSON.stringify(payload)) };
}

function diff(lock, now) {
  const out = [];
  for (const rel of SOUL_FILES) {
    if (lock.files?.[rel] !== now.files[rel]) {
      out.push(`-${rel}：注入正文变了（基线 ${String(lock.files?.[rel]).slice(0, 12)} → 现在 ${String(now.files[rel]).slice(0, 12)}）`);
    }
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

const args = process.argv.slice(2);
const allow = args.includes("--allow-soul-change");
const update = args.includes("--update");
const now = fingerprint();

if (update) {
  fs.writeFileSync(LOCK, JSON.stringify(now, null, 2) + "\n");
  console.log(`soul-guard.lock 已重写：${Object.keys(now.patches).length} 条补丁 + ${SOUL_FILES.length} 个文件，digest ${now.digest.slice(0, 12)}`);
  process.exit(0);
}

if (!fs.existsSync(LOCK)) {
  console.error("soul-guard.lock 不存在：先跑 node scripts/assert-soul-guard.mjs --update");
  process.exit(1);
}

const lock = JSON.parse(fs.readFileSync(LOCK, "utf8"));
const payloadLock = { version: lock.version, files: lock.files, patches: lock.patches, presetPatches: lock.presetPatches };
const lockDigest = lock.digest || sha(JSON.stringify(payloadLock));

if (lockDigest === now.digest) {
  console.log(
    `soul-guard ok：${SOUL_FILES.length} 个注入文件 + ${Object.keys(now.patches).length} 条破甲补丁与基线一致（digest ${now.digest.slice(0, 12)}）`,
  );
  process.exit(0);
}

const items = diff(lock, now);
console.error("SOUL-GUARD 越界：灵魂层被改动");
for (const line of items) console.error("  " + line);
if (!items.length) console.error("  （指纹不一致但逐项没差异：基线文件格式问题，重跑 --update）");
if (allow) {
  console.error("已显式放行（--allow-soul-change）：提交信息里必须写清为什么改灵魂。");
  process.exit(0);
}
console.error("要么回退，要么在提交信息里写明理由后重写基线：node scripts/assert-soul-guard.mjs --update");
process.exit(1);
