#!/usr/bin/env node
/**
 * dsh-purge offline installer.
 *
 * Installs a local dsh-purge package into a DSH profile without running pnpm.
 * It copies the package, updates the profile package.json, and links the
 * package into the profile's node_modules as a junction/symlink.
 *
 * This script does not apply patches and does not restart DSH.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

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
  const skip = new Set([".git", "node_modules", "test", ".github"]);
  fs.cpSync(source, target, {
    recursive: true,
    force: true,
    filter: (entry) => {
      const rel = path.relative(source, entry);
      if (!rel) return true;
      return !skip.has(rel.split(path.sep)[0]);
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
    const exe = desktop.findDesktopAppExecutable({ discover: true });
    return exe ? path.dirname(exe) : "";
  } catch {
    return "";
  }
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

async function main() {
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
    const desktopInstall = arg("--desktop-install") || await detectDesktopInstall();

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

main().catch((error) => {
  fail(error && error.stack ? error.stack : String(error));
});
