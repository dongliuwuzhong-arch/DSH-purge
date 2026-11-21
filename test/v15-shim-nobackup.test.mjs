import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// 1.5：patchShim 建 bak 失败时不许再覆盖 shim（F04 / core.js patchShim）。
//
// 1.4.4 的写法是 `try { copyFile(fp, bak) } catch {}` 后照样 saveText 覆盖，
// 并返回 patched —— 唯一退路没了还报成功。这里的判据就是：
// 备份建不成时，文件必须一个字节都不变，结果里必须带上 no_backup。

// DSH_HOME 必须先指向临时目录再加载插件：shimBackupPath() 走 findDshHome()。
const root = fs.mkdtempSync(path.join(os.tmpdir(), "purge-shim-nobak-"));
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

function busy(code) {
  const e = new Error("simulated " + code);
  e.code = code;
  return e;
}

test("对照：备份能建时照常打补丁，bak 存的是改前原文", async () => {
  const dir = fresh("bin-ok");
  const ps1 = path.join(dir, "dsh.ps1");
  fs.writeFileSync(ps1, PS1_ORIGINAL, "utf8");

  const r = await core.patchShim(dir);
  assert.equal(r["dsh.ps1"], "patched", "实际 " + r["dsh.ps1"]);
  const after = fs.readFileSync(ps1, "utf8");
  assert.notEqual(after, PS1_ORIGINAL, "补丁应当写进去了");
  assert.equal(fs.readFileSync(ps1 + core.BAK_SUFFIX, "utf8"), PS1_ORIGINAL, "bak 必须是改前原文");
});

test("备份失败：不覆盖 shim，返回 no_backup，并且记一行", async () => {
  const dir = fresh("bin-nobak");
  const ps1 = path.join(dir, "dsh.ps1");
  fs.writeFileSync(ps1, PS1_ORIGINAL, "utf8");

  const origCopy = hostFs.promises.copyFile;
  const warns = [];
  const origWarn = console.warn;
  hostFs.promises.copyFile = async () => { throw busy("EPERM"); };
  console.warn = (...args) => { warns.push(args.join(" ")); };
  let result;
  try {
    result = await core.patchShim(dir);
  } finally {
    hostFs.promises.copyFile = origCopy;
    console.warn = origWarn;
  }

  assert.match(String(result["dsh.ps1"]), /^no_backup:/, "必须如实报未打补丁，实际 " + result["dsh.ps1"]);
  assert.equal(fs.readFileSync(ps1, "utf8"), PS1_ORIGINAL, "备份失败就不许动 shim 一个字节");
  assert.equal(fs.existsSync(ps1 + core.BAK_SUFFIX), false, "失败的备份不该留下半个文件");
  assert.ok(
    warns.some((line) => /shim backup failed/.test(line)),
    "必须至少记一行，实际：" + JSON.stringify(warns),
  );
});

test("备份失败不影响同一目录里别的启动器（逐个 continue，不整批放弃）", async () => {
  const dir = fresh("bin-mixed");
  const ps1 = path.join(dir, "dsh.ps1");
  fs.writeFileSync(ps1, PS1_ORIGINAL, "utf8");

  // 只让 dsh.ps1 那次复制失败，其余照真实现走。
  const origCopy = hostFs.promises.copyFile;
  let failed = false;
  hostFs.promises.copyFile = async (src, dst, ...rest) => {
    if (!failed && String(dst).endsWith("dsh.ps1" + core.BAK_SUFFIX)) {
      failed = true;
      throw busy("EACCES");
    }
    return origCopy(src, dst, ...rest);
  };
  const origWarn = console.warn;
  let result;
  console.warn = () => {};
  try {
    result = await core.patchShim(dir);
  } finally {
    hostFs.promises.copyFile = origCopy;
    console.warn = origWarn;
  }
  assert.match(String(result["dsh.ps1"]), /^no_backup:/);
  assert.equal(result["dsh.cmd"], "missing", "目录里本来没有 dsh.cmd");
  assert.equal(fs.readFileSync(ps1, "utf8"), PS1_ORIGINAL);
});
