#!/usr/bin/env node
/**
 * dsh-purge offline installer.
 *
 * Installs a local dsh-purge package into a DSH profile without running pnpm.
 * It copies the package, updates the profile package.json, and links the
 * package into the profile's node_modules as a junction/symlink.
 *
 * This script does not apply patches and does not restart DSH.
 *
 * 沙箱护栏（2026-11-16，S4 指出的唯一能毁现网的开关）：
 *   不给 --desktop-install 时它会自己探测桌面安装目录，而探测结果往往是**现网正在用的那份**
 *   （实测 %INSTALL_DIR%），写进 <DSH_HOME>/dsh-purge/desktop-install.txt 之后
 *   core.js 会把那份安装当成"本插件认领的"并去改它。所以：
 *     · 探测到的目录 == 现网（或互相包含）→ 拒绝，打印该目录；
 *     · 现网目录解析不出来（unresolved）→ 拒绝；
 *     · 例外：本次 DSH_HOME 就是现网 DSH_HOME 时照常装（那不是沙箱，就是给现网装插件）；
 *     · 要装在别处：--desktop-install <目录>；确实要认领现网：--allow-live。
 *   退出码：0 = 成功/无需处理；1 = 失败或被护栏拒绝。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as desktop from "../lib/desktop.js";

const ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith("--")));

function arg(name, fallback = "") {
  const index = args.indexOf(name);
  return index >= 0 ? (args[index + 1] || fallback) : fallback;
}

function fail(message) {
  console.error(`[dsh-purge-install] ${message}`);
  process.exitCode = 1;
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function exists(file) {
  try {
    fs.lstatSync(file);
    return true;
  } catch {
    return false;
  }
}

function backup(file) {
  if (!exists(file)) return "";
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = `${file}.dsh-purge.${stamp}.bak`;
  fs.copyFileSync(file, target);
  return target;
}

function findPackageRoot(dir, depth = 0) {
  const packageFile = path.join(dir, "package.json");
  if (isFile(packageFile)) {
    try {
      if (readJson(packageFile).name === "dsh-purge") return dir;
    } catch {
      // Keep walking; a nested package may still be the real one.
    }
  }
  if (depth >= 2) return "";
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return "";
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "node_modules" || entry.name === ".git") continue;
    const hit = findPackageRoot(path.join(dir, entry.name), depth + 1);
    if (hit) return hit;
  }
  return "";
}

function extractZip(zipFile) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-purge-install-"));
  if (process.platform === "win32") {
    const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;
    const command = `Expand-Archive -LiteralPath ${quote(zipFile)} -DestinationPath ${quote(temp)} -Force`;
    const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], { stdio: "inherit" });
    if (result.status !== 0) {
      fs.rmSync(temp, { recursive: true, force: true });
      throw new Error("Expand-Archive failed");
    }
  } else {
    const result = spawnSync("unzip", ["-q", zipFile, "-d", temp], { stdio: "inherit" });
    if (result.status !== 0) {
      fs.rmSync(temp, { recursive: true, force: true });
      throw new Error("unzip failed");
    }
  }
  return temp;
}

function copyPackage(source, target) {
  if (path.resolve(source) === path.resolve(target)) return;
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  // 2026-11-22（V15 工程 P1-7）：preflight-baseline.json 是"我这台机器健康时"的贴点记录，
  // 跟着插件进别人的 home，对方的预检差分就变成拿我的基线比他的机器（台账第 4 条）。
  // 它是 scripts/ 下的单个文件、不是目录，所以按完整相对路径比，只比首段会漏。
  const SKIP_TOP_DIRS = new Set([".git", "node_modules", "test", ".github"]);
  const SKIP_RELATIVE_FILES = new Set(["scripts/preflight-baseline.json"]);
  fs.cpSync(source, target, {
    recursive: true,
    force: true,
    filter: (entry) => {
      const rel = path.relative(source, entry);
      if (!rel) return true;
      const parts = rel.split(path.sep);
      if (SKIP_TOP_DIRS.has(parts[0])) return false;
      return !SKIP_RELATIVE_FILES.has(parts.join("/"));
    },
  });
}

function ensureProfile(profileDir) {
  const packageFile = path.join(profileDir, "package.json");
  if (!isFile(packageFile)) throw new Error(`profile package.json not found: ${packageFile}`);
  const pkg = readJson(packageFile);
  pkg.dependencies = pkg.dependencies && typeof pkg.dependencies === "object" ? pkg.dependencies : {};
  pkg.dsh = pkg.dsh && typeof pkg.dsh === "object" ? pkg.dsh : {};
  pkg.dsh.profile = pkg.dsh.profile && typeof pkg.dsh.profile === "object" ? pkg.dsh.profile : {};
  pkg.dsh.profile.bundles = Array.isArray(pkg.dsh.profile.bundles) ? pkg.dsh.profile.bundles : [];

  const before = JSON.stringify(pkg);
  pkg.dependencies["dsh-purge"] = "file:../../plugins/dsh-purge";
  if (!pkg.dsh.profile.bundles.includes("dsh-purge")) pkg.dsh.profile.bundles.push("dsh-purge");
  return { packageFile, pkg, changed: JSON.stringify(pkg) !== before };
}

function linkPackage(profileDir, pluginDir, dryRun, force) {
  const nodeModules = path.join(profileDir, "node_modules");
  const linkPath = path.join(nodeModules, "dsh-purge");
  if (!exists(linkPath)) {
    if (!dryRun) {
      fs.mkdirSync(nodeModules, { recursive: true });
      fs.symlinkSync(pluginDir, linkPath, process.platform === "win32" ? "junction" : "dir");
    }
    return "created";
  }

  const stat = fs.lstatSync(linkPath);
  if (stat.isSymbolicLink()) {
    const current = fs.realpathSync.native(linkPath);
    const wanted = fs.realpathSync.native(pluginDir);
    if (current.toLowerCase() === wanted.toLowerCase()) return "already";
    if (!dryRun) fs.rmSync(linkPath, { force: true });
  } else if (stat.isDirectory()) {
    if (!force) {
      throw new Error(`${linkPath} is a real directory; rerun with --force to replace it`);
    }
    if (!dryRun) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      fs.renameSync(linkPath, `${linkPath}.dsh-purge.${stamp}.bak`);
    }
  } else {
    if (!dryRun) fs.rmSync(linkPath, { force: true });
  }

  if (!dryRun) fs.symlinkSync(pluginDir, linkPath, process.platform === "win32" ? "junction" : "dir");
  return "replaced";
}

async function detectDesktopInstall() {
  try {
    const desktop = await import(pathToFileURL(path.join(ROOT, "lib", "desktop.js")).href);
    // useCwd:false —— 这个脚本可能在用户任意一个目录里被跑起来，当前目录里若正好有
    // 一个同名 exe（空壳也算），探测会把它认成安装并写进 desktop-install.txt（V15 F-03）。
    const exe = desktop.findDesktopAppExecutable({ discover: true, useCwd: false });
    return exe ? path.dirname(exe) : "";
  } catch {
    return "";
  }
}

/** 归一化目录：末尾斜杠去掉、统一正斜杠；比较时再转小写。 */
export function normalizeDir(dir) {
  const n = path.normalize(String(dir || "").trim()).replace(/\\/g, "/").replace(/\/+$/, "");
  return n === "." ? "" : n;
}

/** 同一个安装树：相等、或一方在另一方里面（盘符根不算）。 */
export function sameOrNested(a, b) {
  const x = normalizeDir(a).toLowerCase();
  const y = normalizeDir(b).toLowerCase();
  if (!x || !y) return false;
  if (/^[a-z]:$/.test(x) || /^[a-z]:$/.test(y)) return false;
  return x === y || x.startsWith(y + "/") || y.startsWith(x + "/");
}

/** 现网（真的在用的那份）安装目录。只看"装在哪"的硬证据，不主动 discover 进程/快捷方式：
 *  DSH_DESKTOP_INSTALL、本机 dsh-home 里记过的 desktop-install.txt、当前进程就是宿主 exe、
 *  注册表登记的安装目录。 */
/**
 * 把 "一个或几个目录" 的字符串切成分量。
 * 2026-11-21 CI 红在这：Linux 上 path.delimiter 是 ":"，于是 "C:/Other/DSH" 被切成
 * ["C", "/Other/DSH"] 两个假目录（测试断言失败）。判据：值看起来是 Windows 路径
 * （盘符开头或含反斜杠）就用 ";" 切，否则用当前平台的 delimiter。
 */
export function splitDirList(value) {
  const raw = String(value || "");
  const looksWindows = /^[A-Za-z]:[\\/]/.test(raw) || raw.includes("\\");
  const sep = looksWindows ? ";" : path.delimiter;
  return raw.split(sep).map((s) => s.trim()).filter(Boolean);
}

export function liveDesktopDirs({ env = process.env, dshHome = "", execPath = process.execPath } = {}) {
  const out = [];
  const push = (dir) => {
    const n = normalizeDir(dir);
    if (n && !out.some((x) => x.toLowerCase() === n.toLowerCase())) out.push(n);
  };
  for (const item of splitDirList(env.DSH_DESKTOP_INSTALL)) push(item);
  if (dshHome) {
    try {
      const fp = path.join(dshHome, "dsh-purge", "desktop-install.txt");
      const line = fs.readFileSync(fp, "utf8").split(/\r?\n/).map((s) => s.trim()).find(Boolean);
      if (line) push(line);
    } catch {
      // 没记过就是没有
    }
  }
  try {
    if (desktop.isOfficialHarnessExecutable(execPath)) push(path.dirname(path.normalize(execPath)));
  } catch {
    // 非致命
  }
  try {
    for (const dir of desktop.registryInstallDirs()) push(dir);
  } catch {
    // 注册表读不到就当没有（会走 resolved/unresolved 判定）
  }
  return out;
}

/** 现网 DSH_HOME 的候选：环境里那份 + 默认 ~/.dsh。 */
export function liveDshHomes({ env = process.env } = {}) {
  const out = [];
  const push = (dir) => {
    const n = normalizeDir(dir);
    if (n && !out.some((x) => x.toLowerCase() === n.toLowerCase())) out.push(n);
  };
  push(env.DSH_HOME);
  push(path.join(os.homedir(), ".dsh"));
  return out;
}

/**
 * 沙箱护栏（S4：不传 --desktop-install 时 installer 会自动认领现网 exe）。
 * 判定顺序：
 *  1. 显式 --desktop-install → 放行（用户点名的那份）；
 *  2. --allow-live → 放行（明确要认领现网）；
 *  3. 本次 DSH_HOME 就是现网 DSH_HOME → 放行（给现网装插件，认领是对的）；
 *  4. 什么都没探测到 → 放行（不会写 desktop-install.txt）；
 *  5. 现网目录一个都解析不出来（unresolved）→ 拒绝；
 *  6. 探测到的目录落在现网里 → 拒绝。
 */
export function desktopInstallGuard({ detected = "", liveDirs = [], liveHomes = [], dshHome = "", explicit = "", allowLive = false } = {}) {
  if (explicit) return { ok: true, use: explicit, reason: "explicit", liveDir: "" };
  if (allowLive) return { ok: true, use: detected, reason: "allow-live", liveDir: "" };
  const hit = detected ? liveDirs.find((dir) => sameOrNested(detected, dir)) || "" : "";
  const liveHome = liveHomes.some((home) => sameOrNested(dshHome, home));
  if (detected && liveHome) return { ok: true, use: detected, reason: "live-home", liveDir: hit };
  if (!detected) return { ok: true, use: "", reason: "no-install", liveDir: "" };
  if (!liveDirs.length) return { ok: false, use: "", reason: "unresolved", liveDir: "" };
  if (hit) return { ok: false, use: "", reason: "live", liveDir: hit };
  return { ok: true, use: detected, reason: "other", liveDir: "" };
}

/** 被护栏拒绝时打印的几行（把目录原样打出来，别让人猜）。 */
export function guardRefusalLines({ detected = "", reason = "", liveDir = "", dshHome = "", stateFile = "" } = {}) {
  const why = reason === "unresolved"
    ? "现网安装目录解析不出来（没有注册表登记，也没有 desktop-install.txt）"
    : "自动探测到的桌面安装目录就是现网（正在用的那份）";
  const lines = [];
  lines.push("拒绝：" + why + "。");
  lines.push("  探测到的目录: " + (detected || "(空)"));
  if (liveDir) lines.push("  现网目录:     " + liveDir);
  lines.push("  目标 DSH_HOME: " + (dshHome || "(未指定)") + "（不是现网的 DSH_HOME）");
  if (stateFile) lines.push("  会写进: " + stateFile);
  lines.push("  core.js 会把这条记成\"本插件认领的安装\"，认错了就会去改现网那份。");
  lines.push("装在沙箱里：加 --desktop-install <那份安装的目录>；确实要认领现网：加 --allow-live。");
  return lines;
}

async function verify(profileDir, pluginDir) {
  const packageFile = path.join(profileDir, "package.json");
  const pkg = readJson(packageFile);
  const pluginPkgFile = path.join(pluginDir, "package.json");
  if (!isFile(pluginPkgFile)) throw new Error(`plugin package.json missing: ${pluginPkgFile}`);
  const pluginPkg = readJson(pluginPkgFile);
  if (pluginPkg.name !== "dsh-purge") throw new Error(`unexpected package name: ${pluginPkg.name}`);
  if (!isFile(path.join(pluginDir, "cordis.patch.yml"))) throw new Error("cordis.patch.yml missing");
  if (!isFile(path.join(pluginDir, "lib", "index.js"))) throw new Error("lib/index.js missing");
  if (!isFile(path.join(pluginDir, "client.js"))) throw new Error("client.js missing");
  if (pkg.dependencies?.["dsh-purge"] !== "file:../../plugins/dsh-purge") {
    throw new Error("profile package.json dependency is not file:../../plugins/dsh-purge");
  }
  if (!pkg.dsh?.profile?.bundles?.includes("dsh-purge")) {
    throw new Error("profile bundles does not include dsh-purge");
  }
  const linkPath = path.join(profileDir, "node_modules", "dsh-purge");
  const linkReal = fs.realpathSync.native(linkPath);
  const pluginReal = fs.realpathSync.native(pluginDir);
  if (linkReal.toLowerCase() !== pluginReal.toLowerCase()) {
    throw new Error(`node_modules link points elsewhere: ${linkReal}`);
  }
  await import(pathToFileURL(path.join(pluginDir, "lib", "index.js")).href);
  return pluginPkg.version;
}

const HELP_TEXT = [
  "用法: node scripts/install-offline.mjs [--dsh-home <dir>] [--profile <name>] [--source <dir>|--zip <zip>]",
  "       [--desktop-install <dir>] [--allow-live] [--dry-run] [--force] [--verify] [--uninstall [--purge]]",
  "",
  "--desktop-install <dir>  记下这次要认领的桌面安装目录（不传则自动探测，探测结果可能是现网）",
  "--allow-live             明确允许认领现网那份安装（护栏默认拒绝）",
  "--dry-run                只打印，不落盘",
  "--verify / --uninstall   校验 / 卸载（--uninstall 可加 --purge 连插件目录一起删）",
  "",
  "沙箱护栏：自动探测到的目录若等于现网（或现网目录解析不出来），而目标 DSH_HOME 又不是现网的，",
  "一律拒绝并打印该目录；退出码 1。这是为了防止沙箱安装把现网 exe 写进 desktop-install.txt。",
].join("\n");

async function main() {
  if (args.includes("--help") || args.includes("-h")) {
    console.log(HELP_TEXT);
    return;
  }
  const mode = flags.has("--verify") ? "verify" : flags.has("--uninstall") ? "uninstall" : "install";
  const dryRun = flags.has("--dry-run");
  const force = flags.has("--force");
  const profileName = arg("--profile", "desktop");
  const dshHome = path.resolve(arg("--dsh-home") || process.env.DSH_HOME || path.join(os.homedir(), ".dsh"));
  const profileDir = path.join(dshHome, "profiles", profileName);
  const pluginDir = path.join(dshHome, "plugins", "dsh-purge");

  if (mode === "verify") {
    const version = await verify(profileDir, pluginDir);
    console.log(`[dsh-purge-install] verified ${pluginDir} (${version})`);
    return;
  }

  if (mode === "uninstall") {
    const { packageFile, pkg, changed } = ensureProfile(profileDir);
    delete pkg.dependencies["dsh-purge"];
    pkg.dsh.profile.bundles = pkg.dsh.profile.bundles.filter((name) => name !== "dsh-purge");
    const linkPath = path.join(profileDir, "node_modules", "dsh-purge");
    if (dryRun) {
      console.log(`[dry-run] would update ${packageFile}`);
      console.log(`[dry-run] would remove ${linkPath}`);
      if (flags.has("--purge")) console.log(`[dry-run] would remove ${pluginDir}`);
      return;
    }
    if (changed) {
      backup(packageFile);
      writeJson(packageFile, pkg);
    }
    if (exists(linkPath)) fs.rmSync(linkPath, { recursive: true, force: true });
    if (flags.has("--purge")) fs.rmSync(pluginDir, { recursive: true, force: true });
    console.log(`[dsh-purge-install] uninstalled from ${profileDir}`);
    return;
  }

  const zipFile = arg("--zip");
  let source = path.resolve(arg("--source") || ROOT);
  let temp = "";
  try {
    if (zipFile) {
      temp = extractZip(path.resolve(zipFile));
      source = findPackageRoot(temp);
      if (!source) throw new Error("dsh-purge package not found in zip");
    } else {
      source = findPackageRoot(source);
      if (!source) throw new Error("dsh-purge package not found in --source");
    }

    const sourcePkg = readJson(path.join(source, "package.json"));
    const { packageFile, pkg, changed } = ensureProfile(profileDir);
    const explicitDesktop = normalizeDir(arg("--desktop-install"));
    let desktopInstall = explicitDesktop;
    if (!explicitDesktop) {
      // 自动探测会捞到"现网正在用的那份"（S4 实测返回 %INSTALL_DIR%\DeepSeek Harness.exe），
      // 写进 desktop-install.txt 之后 core.js 会去改它 —— 所以探测结果必须先过护栏。
      const detected = normalizeDir(await detectDesktopInstall());
      const verdict = desktopInstallGuard({
        detected,
        liveDirs: liveDesktopDirs({ dshHome }),
        liveHomes: liveDshHomes(),
        dshHome,
        allowLive: flags.has("--allow-live"),
      });
      if (!verdict.ok) {
        for (const line of guardRefusalLines({
          detected,
          reason: verdict.reason,
          liveDir: verdict.liveDir,
          dshHome,
          stateFile: path.join(dshHome, "dsh-purge", "desktop-install.txt").replace(/\\/g, "/"),
        })) console.error("[dsh-purge-install] " + line);
        process.exitCode = 1;
        return;
      }
      desktopInstall = verdict.use;
    }

    if (dryRun) {
      console.log(`[dry-run] source: ${source}`);
      console.log(`[dry-run] target: ${pluginDir}`);
      console.log(`[dry-run] profile: ${packageFile}`);
      console.log(`[dry-run] would copy package and link node_modules/dsh-purge`);
      if (changed) console.log(`[dry-run] would update package.json`);
      if (desktopInstall) console.log(`[dry-run] would write desktop-install.txt: ${desktopInstall}`);
      return;
    }

    copyPackage(source, pluginDir);
    const link = linkPackage(profileDir, pluginDir, false, force);
    if (changed) {
      const saved = backup(packageFile);
      if (saved) console.log(`[dsh-purge-install] profile backup: ${saved}`);
      writeJson(packageFile, pkg);
    }
    if (desktopInstall) {
      const stateDir = path.join(dshHome, "dsh-purge");
      fs.mkdirSync(stateDir, { recursive: true });
      fs.writeFileSync(path.join(stateDir, "desktop-install.txt"), `${desktopInstall.replace(/\\/g, "/")}\n`, "utf8");
    }

    console.log(`[dsh-purge-install] installed ${sourcePkg.name}@${sourcePkg.version}`);
    console.log(`[dsh-purge-install] plugin: ${pluginDir}`);
    console.log(`[dsh-purge-install] profile: ${profileDir}`);
    console.log(`[dsh-purge-install] node_modules link: ${link}`);
    console.log("[dsh-purge-install] not running pnpm; not applying patches; restart DSH then click Apply");
  } finally {
    if (temp) fs.rmSync(temp, { recursive: true, force: true });
  }
}

// 只有直接运行时才装：被 import（测试）时不该动任何人的 DSH_HOME。
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    fail(error && error.stack ? error.stack : String(error));
  });
}
