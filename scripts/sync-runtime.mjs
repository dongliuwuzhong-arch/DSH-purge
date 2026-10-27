#!/usr/bin/env node
import path from "node:path";
import process from "node:process";
import { SYNC_HINT, copyLabel, runtimeSyncReport, syncRuntime } from "../lib/runtime-sync.js";

// 源码 -> 运行副本。默认只报告，加 --apply 才写盘。
//
//   node scripts/sync-runtime.mjs            只报告（退出码 1 表示不同步）
//   node scripts/sync-runtime.mjs --apply    把源码盖到运行副本
//   node scripts/sync-runtime.mjs --prune    额外删掉副本里源码没有的受管文件
//   node scripts/sync-runtime.mjs --json     机器可读输出

const argv = process.argv.slice(2);
const has = (...names) => names.some((n) => argv.includes(n));
const apply = has("--apply", "-a");
const prune = has("--prune", "-p");
const asJson = has("--json");

const out = [];

function say(s = "") {
  out.push(s);
}

function printReport(report) {
  say("dsh-purge 运行副本同步 / runtime sync");
  say("  源码 / source  " + report.plugin_root + "  (" + (report.version || "?") + ")");
  if (!report.copies.length) {
    say("  副本 / copies  无（没有 profile 装 dsh-purge；file:/link: 依赖直连源码，无需同步）");
    return;
  }
  for (const c of report.copies) {
    const head = "  " + copyLabel(c) + (c.self ? "  直连源码  " : "  副本  ") + c.real;
    say(head);
    if (c.self) {
      say("               self-link，无需同步");
      continue;
    }
    if (c.error) {
      say("               [ERROR] " + c.error);
      continue;
    }
    say("               版本 " + (c.version || "?") + (c.ok ? "  已同步" : "  差 " + c.diffs.length + " 个文件"));
    for (const d of c.diffs) {
      say("               " + (d.state === "missing_in_runtime" ? "缺  " : "不同 ") + d.rel);
    }
    if (c.extra && c.extra.length) {
      say("               副本多出 " + c.extra.length + " 个：" + c.extra.join(", ") + (prune ? "（将删除）" : ""));
    }
  }
}

function printApplyResult(result) {
  say("");
  say("同步结果 / result" + (result.ok ? "  OK" : "  有问题"));
  for (const c of result.copies) {
    say("  " + copyLabel(c) + (c.self ? "  self-link，跳过" : "  拷贝 " + c.copied.length + " 个，删除 " + c.removed.length + " 个"));
    for (const rel of c.copied) say("       + " + rel);
    for (const rel of c.removed) say("       - " + rel);
    for (const e of c.errors) say("       [ERROR] " + e);
    for (const rel of c.remaining) say("       ! 仍未同步 " + rel);
  }
}

async function main() {
  if (has("--help", "-h")) {
    console.log(`dsh-purge 运行副本同步

  node scripts/sync-runtime.mjs            只报告（不同步则退出码 1）
  node scripts/sync-runtime.mjs --apply    把源码盖到运行副本
  node scripts/sync-runtime.mjs --prune    连带删除副本里源码没有的受管文件（需配 --apply）
  node scripts/sync-runtime.mjs --json     机器可读输出

受管清单：lib bin docs scripts client.js cordis.patch.yml screenshots.json
          package.json README.md README.zh-CN.md CHANGELOG.md COMPAT-0.2.1.md LICENSE

文本文件按 LF 写入（本机 core.autocrlf=true，仓库 blob 是 LF）；图片等二进制原样拷。
每个文件先写 .sync-tmp 再 rename，避免宿主读到半截。`);
    return 0;
  }

  if (!apply) {
    const report = await runtimeSyncReport();
    if (asJson) console.log(JSON.stringify(report, null, 2));
    else printReport(report);
    const bad = report.copies.filter((c) => !c.self && !c.ok);
    if (!asJson) {
      if (bad.length) {
        say("");
        say("  有 " + bad.length + " 个副本与源码不同步。修复：");
        say("    " + SYNC_HINT);
      } else {
        say("");
        say("  全部同步。");
      }
      console.log(out.join("\n"));
    }
    return bad.length ? 1 : 0;
  }

  const result = await syncRuntime({ prune });
  if (asJson) console.log(JSON.stringify(result, null, 2));
  else {
    printReport(await runtimeSyncReport());
    printApplyResult(result);
    console.log(out.join("\n"));
  }
  if (!result.ok) return 1;
  if (!asJson) {
    const still = await runtimeSyncReport();
    if (!still.ok) return 1;
  }
  return 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    process.stderr.write("[dsh-purge] sync-runtime 失败: " + (err && err.stack ? err.stack : err) + "\n");
    process.exitCode = 2;
  });
