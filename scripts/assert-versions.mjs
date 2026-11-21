#!/usr/bin/env node
// 版本单源：四处必须说同一个版本。
//
// 2026-11-22（V15 工程 P1-6 / F-09）：版本号一直是双写 + 两处文档副本：
//   package.json      · version        （npm/门禁读的）
//   package.json      · dsh.version    （宿主读的）
//   release-notes.md  · 首行 "# X"     （release 正文第一行，release.yml 会比对它）
//   CHANGELOG.md      · 首条 "## X ·"  （人读的更新日志首节）
// 以前 release.yml 只锁了其中一处（release-notes 首行），"版本升了、CHANGELOG 没升"
// 这种最常见的发版失误要人肉眼看。这里一次全锁。
//
// 退出码：0 = 四处一致；1 = 有不一致（逐条打出来）。
// 用法：node scripts/assert-versions.mjs [--root <仓库根>]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function argValue(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] || "") : "";
}

export function readVersionFacts(root) {
  const facts = { problems: [], ok: [] };
  let pkg = null;
  try {
    pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  } catch (error) {
    facts.problems.push("package.json 读不出来: " + (error && error.message ? error.message : error));
    return facts;
  }
  const version = String(pkg.version ?? "").trim();
  const dshVersion = String(pkg.dsh?.version ?? "").trim();
  facts.version = version;

  if (!/^\d+\.\d+\.\d+/.test(version)) {
    facts.problems.push(`package.json version 不像版本号: ${JSON.stringify(version)}`);
  }
  if (!dshVersion) facts.problems.push("package.json 缺 dsh.version（宿主读的是这一处）");

  let notesFirst = "";
  try {
    notesFirst = fs.readFileSync(path.join(root, "release-notes.md"), "utf8").split(/\r?\n/)[0].trim();
  } catch (error) {
    facts.problems.push("release-notes.md 读不出来: " + (error && error.message ? error.message : error));
  }
  let changelogFirst = "";
  try {
    const text = fs.readFileSync(path.join(root, "CHANGELOG.md"), "utf8");
    const hit = text.match(/^##\s+(.+)$/m);
    changelogFirst = hit ? hit[1].trim() : "";
  } catch (error) {
    facts.problems.push("CHANGELOG.md 读不出来: " + (error && error.message ? error.message : error));
  }

  const notesVersion = (notesFirst.match(/^#\s*v?([0-9][^\s]*)/) || [])[1] || "";
  const changelogVersion = (changelogFirst.match(/^v?([0-9][0-9A-Za-z.\-]*)/) || [])[1] || "";

  const rows = [
    ["package.json · version", version],
    ["package.json · dsh.version", dshVersion],
    ["release-notes.md 首行", notesVersion],
    ["CHANGELOG.md 首条", changelogVersion],
  ];
  facts.rows = rows;
  facts.notesFirst = notesFirst;
  facts.changelogFirst = changelogFirst;

  if (!notesVersion) {
    facts.problems.push(`release-notes.md 首行不是 "# <版本>" 形态: ${JSON.stringify(notesFirst)}`);
  }
  if (!changelogVersion) {
    facts.problems.push(`CHANGELOG.md 找不到 "## <版本> · 日期" 形态的首节标题（现在是 ${JSON.stringify(changelogFirst)}）`);
  }
  for (const [label, value] of rows) {
    if (!value) continue;
    if (value !== version) facts.problems.push(`${label} = ${value}，与 package.json version = ${version} 不一致`);
  }
  if (!facts.problems.length) {
    facts.ok.push(`四处一致：${version}（package.json version / dsh.version、release-notes.md 首行、CHANGELOG.md 首条）`);
  }
  return facts;
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log([
      "用法: node scripts/assert-versions.mjs [--root <仓库根>]",
      "",
      "锁住四处版本：package.json 的 version 与 dsh.version、release-notes.md 首行、CHANGELOG.md 首条。",
      "退出码 0 = 一致；1 = 有不一致。版本号本身由人改，这个脚本只负责让「改漏一处」立刻红。",
    ].join("\n"));
    return 0;
  }
  const root = path.resolve(argValue(args, "--root") || path.dirname(path.dirname(fileURLToPath(import.meta.url))));
  const facts = readVersionFacts(root);
  for (const line of facts.problems) console.error("✗ " + line);
  for (const line of facts.ok) console.log("✓ " + line);
  if (!facts.problems.length) return 0;
  console.error(`版本不一致（${facts.problems.length} 处）：四处必须同一个数，改的是人，红的是这道门。`);
  return 1;
}

if (import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = main();
}
