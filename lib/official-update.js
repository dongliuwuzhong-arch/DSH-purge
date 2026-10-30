// 官方客户端升级后的补丁回写标记。wscript 字面量给重启脚本用。
import os from "node:os";
import path from "node:path";
import { hostFs as fs } from "./extract-asar.js";

const MARKER_NAME = "dsh-purge-reapply-asar";

/**
 * [1.1.100] 升级标记不能再放在 resources\ 里。
 *
 * 2026-10-30 真升级实测：electron-builder 的 NSIS 升级会把整个安装目录清一遍
 * （连我放在安装目录里、安装包清单上根本没有的脚本和备份一起没了），
 * 于是标记刚写下就被同一场清空吞掉，下次启动看不到它，自愈链等于没跑。
 * 现在写到 ~/.dsh/dsh-purge/ 下——那里升级清不到。
 */
const MARKER_FILE = "reapply-asar.pending";

function dshHomeDir() {
  const home = String(process.env.DSH_HOME || "").trim();
  if (home) return home;
  try { return path.join(os.homedir(), ".dsh"); } catch { return ""; }
}

/** 新位置：~/.dsh/dsh-purge/reapply-asar.pending */
export function upgradeMarkerDir() {
  const home = dshHomeDir();
  return home ? path.join(home, "dsh-purge") : "";
}

function harnessExeName(exe) {
  const base = path.basename(String(exe || "")).toLowerCase();
  return base === "deepseek harness.exe" || base === "deepseek-harness.exe";
}

/** 旧位置（<install>\resources\dsh-purge-reapply-asar），只为兼容上一版留下的标记。 */
export function legacyUpgradeMarkerPath(exe) {
  if (!harnessExeName(exe)) return "";
  return path.join(path.dirname(exe), "resources", MARKER_NAME);
}

export function upgradeMarkerPath(exe) {
  if (!harnessExeName(exe)) return "";
  const dir = upgradeMarkerDir();
  if (!dir) return legacyUpgradeMarkerPath(exe);
  return path.join(dir, MARKER_FILE);
}

export function upgradeMarkerExists(exe) {
  const marker = upgradeMarkerPath(exe);
  if (marker && fs.existsSync(marker)) return true;
  // 老标记还留在安装目录里的（1.1.99 及更早写下的），也认。
  const legacy = legacyUpgradeMarkerPath(exe);
  return Boolean(legacy && fs.existsSync(legacy));
}

export function clearUpgradeMarker(exe) {
  for (const marker of [upgradeMarkerPath(exe), legacyUpgradeMarkerPath(exe)]) {
    if (!marker) continue;
    try { fs.rmSync(marker, { force: true }); } catch { /* 下次启动再试 */ }
  }
}

export function clearStaleExtractedApps(exe) {
  if (!harnessExeName(exe)) return;
  const resources = path.join(path.dirname(exe), "resources");
  let names = [];
  try { names = fs.readdirSync(resources); } catch { return; }
  for (const name of names) {
    if (!name.startsWith("app.dshpurge-prev")) continue;
    try { fs.rmSync(path.join(resources, name), { recursive: true, force: true }); } catch { /* 旧目录删不掉不影响新版本 */ }
  }
}

/** Windows Script Host 无 BOM 时按系统 ANSI 读文件。中文路径写成 \uXXXX，整份脚本保持 ASCII。 */
export function wshLiteral(value) {
  return JSON.stringify(String(value ?? "")).replace(/[\u007f-\uffff]/g, (ch) => {
    return "\\u" + ch.charCodeAt(0).toString(16).padStart(4, "0");
  });
}

export function isWshAscii(source) {
  const text = String(source || "");
  for (let i = 0; i < text.length; i += 1) {
    if (text.charCodeAt(i) > 0x7f) return false;
  }
  return true;
}
