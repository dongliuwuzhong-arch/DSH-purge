import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// 2026-11-22（V15 收 · 代码审计 F7）：
// "没有备份"这一种结局以前有两种字面形状 —— patchShim 写 `no_backup:<msg>`，
// revertShim 写裸 `no_backup`。下游只要有人写 `=== "no_backup"`，带 msg 那种就漏掉。
// 现在两处都从 shimNoBackupStatus() 出，判定统一走 isShimNoBackup()（前缀匹配）。

// DSH_HOME 必须先指向临时目录再加载插件：shimBackupPath() 走 findDshHome()。
const root = fs.mkdtempSync(path.join(os.tmpdir(), "purge-shimshape-"));
process.env.DSH_HOME = path.join(root, "home");
fs.mkdirSync(process.env.DSH_HOME, { recursive: true });

const core = await import("../lib/core.js");
const { hostFs } = await import("../lib/extract-asar.js");

const PS1_ORIGINAL = "# original launcher\nnpm run dsh %*\n";

test.after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function fresh(prefix) {
  const dir = path.join(root, prefix);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

test("构造点唯一：空原因→裸 no_backup，有原因→no_backup:<msg>，冒号只出现一次", () => {
  assert.equal(core.shimNoBackupStatus(""), "no_backup");
  assert.equal(core.shimNoBackupStatus(null), "no_backup");
  assert.equal(core.shimNoBackupStatus(new Error("EPERM: 拒绝访问")), "no_backup:EPERM: 拒绝访问");
  assert.equal(core.shimNoBackupStatus("  多\n行   空白  "), "no_backup:多 行 空白", "原因要压成一行");
});

test("判定一律走前缀：两种形态都认，别的状态不认", () => {
  assert.equal(core.isShimNoBackup("no_backup"), true);
  assert.equal(core.isShimNoBackup("no_backup:EBUSY"), true);
  assert.equal(core.isShimNoBackup("missing"), false);
  assert.equal(core.isShimNoBackup("error:EPERM"), false);
  assert.equal(core.isShimNoBackup(undefined), false);
});

test("patchShim：备份建不成时返回 no_backup:<msg>，并且 shim 一个字节都不变", async () => {
  const dir = fresh("bin-nobak");
  const ps1 = path.join(dir, "dsh.ps1");
  fs.writeFileSync(ps1, PS1_ORIGINAL, "utf8");

  const origCopy = hostFs.promises.copyFile;
  const origWarn = console.warn;
  const warns = [];
  hostFs.promises.copyFile = async () => {
    const e = new Error("simulated EPERM");
    e.code = "EPERM";
    throw e;
  };
  console.warn = (...args) => warns.push(args.join(" "));
  let result;
  try {
    result = await core.patchShim(dir);
  } finally {
    hostFs.promises.copyFile = origCopy;
    console.warn = origWarn;
  }

  const status = String(result["dsh.ps1"]);
  assert.match(status, /^no_backup:/, "必须带原因，实际：" + status);
  assert.equal(core.isShimNoBackup(status), true);
  assert.equal(fs.readFileSync(ps1, "utf8"), PS1_ORIGINAL, "备份失败时不许覆盖原件");
  assert.ok(warns.some((line) => line.includes("shim backup failed")), "必须记一行");
});

test("revertShim：没有备份可还原时是裸 no_backup —— 也没原因可带，但走的是同一个构造点", async () => {
  const dir = fresh("bin-nobak-revert");
  const ps1 = path.join(dir, "dsh.ps1");
  fs.writeFileSync(ps1, PS1_ORIGINAL, "utf8");

  const r = await core.revertShim(dir, { scrubDesktop: false });
  assert.equal(r["dsh.ps1"], "no_backup");
  assert.equal(core.isShimNoBackup(r["dsh.ps1"]), true, "两种形态都要被 isShimNoBackup 认到");
});
