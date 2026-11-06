import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { repairOfficialCliAfterUnpack } from "../lib/desktop.js";

// .dsh-purge.bak 的假备份 bug（2026-11-06 发现并修掉）
//
// lib/desktop.js 的 repairOfficialCliAfterUnpack() 是**同步函数**，原本这样写：
//
//   if (!isFile(bak)) {
//     try { atomicCopyFile(fp, bak); } catch {}   // async，没 await
//   }
//   atomicWriteSync(fp, patched.text, "utf8");    // 同步写，立刻落盘
//
// atomicCopyFile 内部第一个 await 是 fsp.mkdir，会让出执行权；
// 等它醒来去 copyFile 时，fp 已被同步写改成新内容。结果 bak 和 fp 一字不差。
// 真机实测：dsh.cmd 562 字节 / .dsh-purge.bak 562 字节，cmp 报 IDENTICAL。
//
// 这一组测试**直接调被修的那个导出函数**，不是复刻它的逻辑 —— 如果哪天有人把
// desktop.js 里那行改回 atomicCopyFile，用例 1 会红。这是判据。

const OFFICIAL_CMD = [
  "@echo off",
  "setlocal DisableDelayedExpansion",
  'set "ELECTRON_RUN_AS_NODE=1"',
  '"%~dp0..\\..\\..\\..\\DeepSeek Harness.exe" --expose-internals "%~dp0..\\..\\..\\app.asar\\dsh\\node_modules\\@deepseek-ai\\dsh-desktop-host\\lib\\cli.js" %*',
  "exit /b %errorlevel%",
  "",
].join("\n");

/** 造一个最小安装目录：假的 exe + resources/runtime/cli/bin/dsh.cmd（官方原版内容）。 */
function makeFakeInstall() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-shimbak-"));
  const exe = path.join(root, "DeepSeek Harness.exe");
  fs.writeFileSync(exe, "fake", "utf8");

  const cliBin = path.join(root, "resources", "runtime", "cli", "bin");
  fs.mkdirSync(cliBin, { recursive: true });

  const cmd = path.join(cliBin, "dsh.cmd");
  fs.writeFileSync(cmd, OFFICIAL_CMD, "utf8");

  return { root, exe, cmd, bak: `${cmd}.dsh-purge.bak` };
}

function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

test("回归：repair 之后 .dsh-purge.bak 必须是改前的原文，不是改后的内容", () => {
  const f = makeFakeInstall();
  try {
    const r = repairOfficialCliAfterUnpack(f.exe);
    assert.equal(r.ok, true, "应当认这个假 exe（isOfficialHarnessExecutable 只看文件名）");

    const shimRow = r.shims.find((s) => s.path.toLowerCase().endsWith("dsh.cmd"));
    assert.ok(shimRow, "没找到 dsh.cmd 的处理结果");
    assert.equal(shimRow.status, "patched", "应当是 patched，实际 " + shimRow.status);

    const after = fs.readFileSync(f.cmd, "utf8");
    assert.ok(after.includes("[dsh-purge cli entry begin]") || after.includes("REM dsh-purge cli entry begin"),
      "dsh.cmd 应当被改成分支 fallback（带 dsh-purge 标记）");
    assert.notEqual(after, OFFICIAL_CMD, "dsh.cmd 必须变了");

    assert.ok(fs.existsSync(f.bak), "bak 必须存在");
    const bakText = fs.readFileSync(f.bak, "utf8");

    // 这一条就是 bug 判据：bak 必须是原文
    assert.equal(bakText, OFFICIAL_CMD, "bak 存的必须是改前原文");
    assert.notEqual(bakText, after, "bak 和改后文件必须不同 —— 相同就说明又变成假备份了");
  } finally {
    cleanup(f.root);
  }
});

test("bak 已存在时不覆盖（保留最早那份原文）", () => {
  const f = makeFakeInstall();
  try {
    // 先手工放一份"更早的原文"
    fs.writeFileSync(f.bak, "EARLIEST-CONTENT", "utf8");

    repairOfficialCliAfterUnpack(f.exe);

    assert.equal(fs.readFileSync(f.bak, "utf8"), "EARLIEST-CONTENT",
      "已存在的 bak 不该被覆盖 —— 那是最初的原文");
  } finally {
    cleanup(f.root);
  }
});

test("幂等：重复调用不会再改一次（already / skipped）", () => {
  const f = makeFakeInstall();
  try {
    repairOfficialCliAfterUnpack(f.exe);
    const first = fs.readFileSync(f.cmd, "utf8");
    const firstBak = fs.readFileSync(f.bak, "utf8");

    const r2 = repairOfficialCliAfterUnpack(f.exe);
    const shimRow = r2.shims.find((s) => s.path.toLowerCase().endsWith("dsh.cmd"));
    assert.ok(["already", "skipped"].includes(shimRow.status), "第二次应当是 already/skipped，实际 " + shimRow.status);

    assert.equal(fs.readFileSync(f.cmd, "utf8"), first, "第二次不该改动文件");
    assert.equal(fs.readFileSync(f.bak, "utf8"), firstBak, "第二次不该动 bak");
  } finally {
    cleanup(f.root);
  }
});
