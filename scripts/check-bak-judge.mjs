#!/usr/bin/env node
// 只读预演：把 refreshStaleBaksForUpgrade 的判据在真宿主上跑一遍，一个字节都不写。
// 宿主升级前后各跑一次——升级前应当 0 条 would-refresh；升级后出现的那些，
// 就是"bak 已经过期、下一次 apply 会把它刷成新原件"的目标，先看清再放它动手。
import { findAiBase, inspectStaleBaks } from "../lib/core.js";

const aiBase = process.argv[2] || process.env.DSH_PURGE_AI_BASE || findAiBase();
if (!aiBase) {
  console.error("找不到 aiBase：请显式传路径（本插件根目录，形如 .../node_modules/@deepseek-ai）");
  process.exit(2);
}
const r = inspectStaleBaks(aiBase, { dryRun: true });
console.log("aiBase: " + aiBase);
console.log(
  `bak 总览 / baks: 会刷新 ${r.refreshed.length} · 判为已打补丁(跳过) ${r.skippedPatched} · 备份==现网 ${r.unchanged} · 用户 patch 层 ${r.skippedUser} · 读失败 ${r.errors.length}`,
);
for (const p of r.refreshed) console.log("  would-refresh  " + p);
for (const e of r.errors) console.log("  error  " + e);
process.exit(r.errors.length ? 1 : 0);
