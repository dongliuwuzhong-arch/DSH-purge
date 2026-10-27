import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

// 源码（~/.dsh/plugins/dsh-purge）与 profile 里真正被 require 的那份
// （<profile>/node_modules/dsh-purge）是两份独立文件：profile 的依赖声明是
// "dsh-purge": "file:../../plugins/dsh-purge"，但 pnpm 复制的是当时的快照，
// 之后改源码不会自动跟过去 —— 于是「改了没生效」看起来像缓存，其实是两份文件。
//
// 这里只做两件事：算两边的指纹、把源码盖到运行副本上。
//
// 为什么单独一个模块：lib/update.js 已经 import 了 lib/core.js，core.js 再
// 反过来 import update.js 就成 ESM 环。本文件只依赖 node 内置，谁都能安全引用。
//
// 指纹口径：文本文件先 CRLF->LF、再丢孤立 CR，然后 sha256。原因是本机
// core.autocrlf=true：仓库 blob 是 LF、工作区检出是 CRLF、运行副本是 LF，
// 同一个文件三种字节长度。不做归一会天天假报不同步。

/** 本文件所在的那份代码（可能是源码，也可能是 profile 里的运行副本）。 */
const PLUGIN_ROOT = realOrSelf(path.resolve(fileURLToPath(new URL(".", import.meta.url)), ".."));
const RUNTIME_SUFFIX = (path.sep + "node_modules" + path.sep + "dsh-purge").toLowerCase();

/**
 * 源码根。从运行副本里被 import 时 PLUGIN_ROOT 指向副本自己，
 * 拿它跟副本比对永远是「已同步」——那是自欺。所以顺着 profile 的
 * "dsh-purge": "file:../../plugins/dsh-purge" 反查真正的源码目录。
 */
function resolveSourceRoot(pluginRoot) {
  const root = realOrSelf(pluginRoot);
  if (!root.toLowerCase().endsWith(RUNTIME_SUFFIX)) return root;
  const profileDir = path.dirname(path.dirname(root));
  let spec = "";
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(profileDir, "package.json"), "utf8"));
    spec =
      (pkg.dependencies && pkg.dependencies["dsh-purge"]) ||
      (pkg.devDependencies && pkg.devDependencies["dsh-purge"]) ||
      "";
  } catch {
    return root;
  }
  const clean = String(spec).replace(/^(file|link):/i, "").trim();
  if (!clean) return root;
  const cand = realOrSelf(path.resolve(profileDir, clean));
  if (cand === root) return root;
  try {
    // 光有 package.json 不够："dsh-purge": "." 这类写法会解析回 profile 自己，
    // 拿 profile 当源码根，比对结果就全是噪声。必须确认它真是一份 dsh-purge。
    const pkg = JSON.parse(fs.readFileSync(path.join(cand, "package.json"), "utf8"));
    if (String((pkg && pkg.name) || "") !== "dsh-purge") return root;
    if (realOrSelf(cand) === realOrSelf(profileDir)) return root;
  } catch {
    return root;
  }
  return cand;
}

/** 源码根。状态面板与 CLI 都拿它当「应该是什么样」的基准。 */
export const SOURCE_ROOT = resolveSourceRoot(PLUGIN_ROOT);

/** 当前这份代码是从源码跑的，还是从运行副本跑的。 */
export const RUNNING_FROM = SOURCE_ROOT === PLUGIN_ROOT ? "source" : "runtime";

/** 受管清单：与 lib/update.js 的 COPY_NAMES 一致，另加 scripts（package.json 的 files 里有它）。 */
export const SYNC_NAMES = [
  "lib",
  "bin",
  "docs",
  "scripts",
  "client.js",
  "cordis.patch.yml",
  "screenshots.json",
  "package.json",
  "README.md",
  "README.zh-CN.md",
  "CHANGELOG.md",
  "COMPAT-0.2.1.md",
  "LICENSE",
];

export const SYNC_HINT = "node scripts/sync-runtime.mjs --apply";

const BINARY_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".bmp",
  ".zip", ".tgz", ".gz", ".asar", ".node", ".exe", ".dll", ".so", ".dylib",
  ".woff", ".woff2", ".ttf", ".otf", ".pdf",
]);

function isDir(fp) {
  try {
    return fs.statSync(fp).isDirectory();
  } catch {
    return false;
  }
}

function isFile(fp) {
  try {
    return fs.statSync(fp).isFile();
  } catch {
    return false;
  }
}

function realOrSelf(fp) {
  try {
    return fs.realpathSync(fp);
  } catch {
    return path.resolve(fp);
  }
}

export function isBinaryRel(rel) {
  return BINARY_EXT.has(path.extname(String(rel || "")).toLowerCase());
}

/** CRLF -> LF，再丢掉剩余孤立 CR。只在行尾不同的两份文件判为同一份。 */
export function normalizeText(text) {
  return String(text ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "");
}

export function hashFile(fp) {
  let buf;
  try {
    buf = fs.readFileSync(fp);
  } catch {
    return null;
  }
  if (isBinaryRel(fp)) {
    return { hash: createHash("sha256").update(buf).digest("hex"), bytes: buf.length, text: false };
  }
  const norm = Buffer.from(normalizeText(buf.toString("utf8")), "utf8");
  return { hash: createHash("sha256").update(norm).digest("hex"), bytes: buf.length, text: true };
}

function walkTree(root, rel, out) {
  const abs = path.join(root, rel);
  if (isDir(abs)) {
    let ents = [];
    try {
      ents = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return out;
    }
    ents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const ent of ents) {
      if (ent.name === "node_modules" || ent.name === ".git") continue;
      walkTree(root, rel + "/" + ent.name, out);
    }
  } else if (isFile(abs)) {
    out.push(rel);
  }
  return out;
}

export function listManagedFiles(root) {
  const out = [];
  for (const name of SYNC_NAMES) walkTree(root, name, out);
  return out.sort();
}

/**
 * 显示用的副本名。desktop 的 node_modules 是指向 pack-test 的 Junction，两者
 * realpath 相同，合成一条显示成 "pack-test(desktop)" —— 前者是真正存放文件的 profile。
 */
export function copyLabel(entry) {
  const names = Array.isArray(entry.profiles) && entry.profiles.length
    ? entry.profiles.slice()
    : [entry.profile || ""];
  const paths = Array.isArray(entry.paths) ? entry.paths : [];
  const ownerIdx = paths.findIndex((p) => p && path.resolve(p) === path.resolve(entry.real || ""));
  const owner = ownerIdx >= 0 ? names[ownerIdx] : names[0];
  const others = names.filter((n) => n !== owner);
  if (!others.length) return owner;
  return owner + "(" + others.join(",") + ")";
}

function readVersion(root) {
  try {
    return String(JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version || "");
  } catch {
    return "";
  }
}

/** 扫该 DSH_HOME 下所有装了 dsh-purge 的 profile，realpath 去重。 */
export function findRuntimeCopies(dshHome) {
  const home = dshHome || process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
  const profilesRoot = path.join(home, "profiles");
  const self = SOURCE_ROOT;
  const out = [];
  const byReal = new Map();
  let names = [];
  try {
    names = fs
      .readdirSync(profilesRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch {
    names = [];
  }
  for (const name of names) {
    const cand = path.join(profilesRoot, name, "node_modules", "dsh-purge");
    if (!isDir(cand)) continue;
    const real = realOrSelf(cand);
    const hit = byReal.get(real);
    if (hit) {
      // desktop 的 node_modules 是指向 pack-test 的 Junction，两份 profile 名
      // 落到同一个真目录上。名字都留着，否则面板上会像是只有一份。
      hit.profiles.push(name);
      hit.paths.push(cand);
      continue;
    }
    const entry = {
      profile: name,
      profiles: [name],
      path: cand,
      paths: [cand],
      real,
      self: path.resolve(real) === path.resolve(self),
    };
    byReal.set(real, entry);
    out.push(entry);
  }
  return out;
}

/** 返回 [{ rel, state: "differs" | "missing_in_runtime", src, run }]；空数组 = 已同步。 */
export function compareRuntime(sourceRoot, targetRoot) {
  const want = listManagedFiles(sourceRoot);
  const diffs = [];
  for (const rel of want) {
    const a = hashFile(path.join(sourceRoot, rel));
    if (!a) continue;
    const b = hashFile(path.join(targetRoot, rel));
    if (!b) diffs.push({ rel, state: "missing_in_runtime", src: a.hash, run: "" });
    else if (a.hash !== b.hash) diffs.push({ rel, state: "differs", src: a.hash, run: b.hash });
  }
  return diffs;
}

/** 运行副本里有、源码里没有的受管文件（只在 --prune 时删）。 */
export function extraRuntimeFiles(sourceRoot, targetRoot) {
  const want = new Set(listManagedFiles(sourceRoot));
  return listManagedFiles(targetRoot).filter((rel) => !want.has(rel));
}

export async function runtimeSyncReport(options = {}) {
  const copies = findRuntimeCopies(options.dshHome);
  const report = {
    ok: true,
    plugin_root: SOURCE_ROOT,
    running_from: RUNNING_FROM,
    version: readVersion(SOURCE_ROOT),
    hint: SYNC_HINT,
    copies: [],
  };
  for (const c of copies) {
    const entry = {
      profile: c.profile,
      profiles: c.profiles,
      path: c.path,
      paths: c.paths,
      real: c.real,
      self: c.self,
      version: readVersion(c.real),
      ok: true,
      diffs: [],
      extra: [],
    };
    if (!c.self) {
      try {
        entry.diffs = compareRuntime(SOURCE_ROOT, c.real);
        entry.extra = extraRuntimeFiles(SOURCE_ROOT, c.real);
        entry.ok = entry.diffs.length === 0;
      } catch (e) {
        entry.ok = false;
        entry.error = String(e && e.message ? e.message : e);
      }
    }
    if (!entry.ok) report.ok = false;
    report.copies.push(entry);
  }
  return report;
}

function copyOne(sourceRoot, targetRoot, rel) {
  const from = path.join(sourceRoot, rel);
  const to = path.join(targetRoot, rel);
  const raw = fs.readFileSync(from);
  const buf = isBinaryRel(rel) ? raw : Buffer.from(normalizeText(raw.toString("utf8")), "utf8");
  fs.mkdirSync(path.dirname(to), { recursive: true });
  // 先写旁边再 rename：宿主进程正读着旧文件时，直接截断会读成半截。
  const tmp = to + ".sync-tmp";
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, to);
}

/** 把源码盖到运行副本上。默认不删多余文件（prune 才删）。 */
export async function syncRuntime(options = {}) {
  const copies = findRuntimeCopies(options.dshHome);
  const report = {
    ok: true,
    plugin_root: SOURCE_ROOT,
    running_from: RUNNING_FROM,
    version: readVersion(SOURCE_ROOT),
    copies: [],
  };
  for (const c of copies) {
    const entry = { profile: c.profile, profiles: c.profiles, paths: c.paths, real: c.real, self: c.self, copied: [], removed: [], errors: [], remaining: [] };
    if (c.self) {
      report.copies.push(entry);
      continue;
    }
    let diffs = [];
    try {
      diffs = compareRuntime(SOURCE_ROOT, c.real);
    } catch (e) {
      entry.errors.push(String(e && e.message ? e.message : e));
    }
    for (const d of diffs) {
      try {
        copyOne(SOURCE_ROOT, c.real, d.rel);
        entry.copied.push(d.rel);
      } catch (e) {
        entry.errors.push(d.rel + ": " + String(e && e.message ? e.message : e));
      }
    }
    if (options.prune) {
      for (const rel of extraRuntimeFiles(SOURCE_ROOT, c.real)) {
        try {
          fs.rmSync(path.join(c.real, rel), { force: true });
          entry.removed.push(rel);
        } catch (e) {
          entry.errors.push(rel + ": " + String(e && e.message ? e.message : e));
        }
      }
    }
    try {
      entry.remaining = compareRuntime(SOURCE_ROOT, c.real).map((d) => d.rel);
    } catch {}
    if (entry.errors.length || entry.remaining.length) report.ok = false;
    report.copies.push(entry);
  }
  return report;
}

/** 给 purge_status / 网页状态用的行（已含前缀符号）。 */
export function runtimeSyncLines(report) {
  const lines = [];
  if (!report || !Array.isArray(report.copies) || report.copies.length === 0) {
    lines.push("· 运行副本 / runtime: 没有 profile 安装（file:/link: 依赖直连源码，无需同步）");
    return lines;
  }
  for (const c of report.copies) {
    const where = copyLabel(c) + (c.version ? " " + c.version : "");
    if (c.self) {
      lines.push("✓ 运行副本 / runtime: " + where + " 直连源码 " + c.real);
    } else if (c.error) {
      lines.push("✗ 运行副本 / runtime: " + where + " 读不了 " + c.real + "（" + c.error + "）");
    } else if (c.ok) {
      lines.push("✓ 运行副本 / runtime: " + where + " 已同步 " + c.real);
    } else {
      const n = c.diffs.length;
      const names = c.diffs.map((d) => d.rel).slice(0, 4).join(", ");
      const more = n > 4 ? " 等 " + n + " 个" : "";
      lines.push("✗ 运行副本 / runtime: " + where + " 与源码差 " + n + " 个文件：" + names + more);
      const sameVer = c.version && c.version === report.version;
      lines.push(
        "    fix: " + SYNC_HINT + (sameVer
          ? "（两边都是 " + report.version + "，只是文件内容不同）"
          : "（源码 " + report.version + " / 副本 " + (c.version || "?") + "）")
      );
    }
    if (c.extra && c.extra.length) {
      lines.push("    ⚠ 副本里多在源码没有的文件 " + c.extra.length + " 个：" + c.extra.slice(0, 4).join(", "));
    }
  }
  return lines;
}
