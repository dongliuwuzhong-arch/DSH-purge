import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// DSH_HOME 先指向临时目录再加载插件：shimBackupPath() 也走 findDshHome()，
// 不设的话这条测试会往真的 ~/.dsh 里搬 bak。
const root = fs.mkdtempSync(path.join(os.tmpdir(), "dshpurge-shim-"));
const dshHome = path.join(root, "home");
process.env.DSH_HOME = dshHome;
fs.mkdirSync(dshHome, { recursive: true });

const core = await import("../lib/core.js");

const SHIM_BEGIN = "REM dsh-purge shim begin\nIF NOT DEFINED DSH_HOME SET \"DSH_HOME=x\"\nREM dsh-purge shim end\n";
const CMD_ORIGINAL = "@ECHO off\r\nnode bin.js %*\r\n";
const CMD_PATCHED = "@ECHO off\r\n" + SHIM_BEGIN + "node bin.js %*\r\n";

function fresh(prefix) {
  const dir = path.join(root, prefix);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function put(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
}

test.after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

test("revertAllShims 从 bak 还原启动器，并把 bak 吃掉", async () => {
  const dir = fresh("bin-restore");
  const cmd = path.join(dir, "dsh.cmd");
  put(cmd, CMD_PATCHED);
  put(cmd + core.BAK_SUFFIX, CMD_ORIGINAL);

  const results = await core.revertAllShims({ dirs: [dir], scrub: false });
  assert.equal(results[dir]["dsh.cmd"], "reverted");
  assert.equal(fs.readFileSync(cmd, "utf8"), CMD_ORIGINAL);
  assert.equal(fs.existsSync(cmd + core.BAK_SUFFIX), false);
  // 目录里本来没有 dsh.ps1 / dsh
  assert.equal(results[dir]["dsh.ps1"], "missing");
  assert.equal(results[dir]["dsh"], "missing");
});

test("revertAllShims 第二趟是空操作，不抛错", async () => {
  const dir = fresh("bin-idempotent");
  const cmd = path.join(dir, "dsh.cmd");
  put(cmd, CMD_PATCHED);
  put(cmd + core.BAK_SUFFIX, CMD_ORIGINAL);

  await core.revertAllShims({ dirs: [dir], scrub: false });
  const again = await core.revertAllShims({ dirs: [dir], scrub: false });
  assert.equal(again[dir]["dsh.cmd"], "no_backup");
  assert.equal(fs.readFileSync(cmd, "utf8"), CMD_ORIGINAL);
});

test("revertAllShims 对没有 bak 但被注入过的启动器只剥注入", async () => {
  const dir = fresh("bin-strip");
  const cmd = path.join(dir, "dsh.cmd");
  put(cmd, CMD_PATCHED);

  const results = await core.revertAllShims({ dirs: [dir], scrub: false });
  assert.equal(results[dir]["dsh.cmd"], "stripped_inject");
  assert.equal(fs.readFileSync(cmd, "utf8"), CMD_ORIGINAL);
  // 剥离必须留不下 "dsh-purge shim" 字样，否则下一趟又判 patched、永远剥不干净
  assert.equal(core.shimIsPatched(cmd), false);
  const again = await core.revertAllShims({ dirs: [dir], scrub: false });
  assert.equal(again[dir]["dsh.cmd"], "no_backup");
});

test("isTextShim 认得文本启动器（hostFs 没有 readSync，这条曾经永远为假）", () => {
  const dir = fresh("bin-istext");
  const cmd = path.join(dir, "dsh.cmd");
  put(cmd, CMD_ORIGINAL);
  assert.equal(core.shimFileStatus(cmd), "original");
  // 真正的二进制（前 512 字节带 NUL）仍判 binary
  const exe = path.join(dir, "dsh.exe");
  fs.writeFileSync(exe, Buffer.from([0x4d, 0x5a, 0x00, 0x00, 0x41, 0x42]));
  assert.equal(core.shimFileStatus(exe), "binary");
});

test("sanitizeDesktopCommandRuntimes 只动本插件的产物", () => {
  const dir = fresh("bin-scrub");
  const cmd = path.join(dir, "dsh.cmd");
  put(cmd, CMD_PATCHED);
  // 启动器原文 bak：应搬出密封 bin，目录里那份要被删掉
  put(cmd + core.BAK_SUFFIX, CMD_ORIGINAL);
  // 非启动器的 bak：直接删
  put(path.join(dir, "helper.js.dshpurge.bak"), "stale\n");
  // 其它残留产物：直接删
  put(path.join(dir, "note.dshpurge.tmp"), "junk\n");
  // 不是本插件的东西：一个字节都不许动
  put(path.join(dir, "keep.txt"), "user file\n");

  const report = core.sanitizeDesktopCommandRuntimes({ dirs: [dir] });
  assert.equal(report.length, 1);
  assert.equal(report[0].dir, dir);
  const cleaned = report[0].cleaned.join(" ");
  assert.match(cleaned, /stripped_cmd_inject/);
  assert.match(cleaned, /deleted:helper\.js\.dshpurge\.bak/);
  assert.match(cleaned, /deleted_artifact:note\.dshpurge\.tmp/);
  assert.match(cleaned, /(relocated_bak|external_bak_exists):dsh\.cmd/);
  assert.match(cleaned, /removed_in_bin_bak:dsh\.cmd/);

  assert.equal(fs.readFileSync(cmd, "utf8"), CMD_ORIGINAL);
  assert.equal(fs.existsSync(cmd + core.BAK_SUFFIX), false);
  assert.equal(fs.existsSync(path.join(dir, "helper.js.dshpurge.bak")), false);
  assert.equal(fs.existsSync(path.join(dir, "note.dshpurge.tmp")), false);
  assert.equal(fs.readFileSync(path.join(dir, "keep.txt"), "utf8"), "user file\n");
  // 注意：非密封目录下 shimBackupPath(fp) 就是 fp+后缀，等于「搬出去」的目标原地不动，
  // 所以这里 bak 是被直接清掉的。真宿主那条 sealed bin 路径会把 bak 挪到
  // $DSH_HOME/dsh-purge/shim-backups（isDesktopCommandRuntimeDir 只认真实安装路径，
  // 测试里造不出密封目录）——那一段靠 1.1.93 的卸载测试与线上状态核对兜着。
});

test("连字符孤儿 bak（.dsh-purge.bak）只删不还原", () => {
  // repairOfficialCliAfterUnpack 写的是 dsh.cmd.dsh-purge.bak（连字符，故意不用 BAK_SUFFIX）：
  // 它记的是「CLI 指向 app.asar」的修复前版本，解包后 app.asar 可能已不存在，照它还原会把 CLI
  // 指进空处。以前 revertShim 与 sanitize 的两条正则都匹配不到它，于是永远躺在 cli/bin 里。
  const dir = fresh("bin-orphan");
  const cmd = path.join(dir, "dsh.cmd");
  const GOOD = "@ECHO off\r\nset \"DSHAPP=%~dp0..\\..\\..\\app\"\r\n";
  const BAD_ASAR = "@ECHO off\r\nset \"DSHAPP=%~dp0..\\..\\..\\app.asar\"\r\n";
  put(cmd, GOOD);
  put(cmd + ".dsh-purge.bak", BAD_ASAR);

  const report = core.sanitizeDesktopCommandRuntimes({ dirs: [dir] });
  assert.equal(report.length, 1);
  assert.match(report[0].cleaned.join(" "), /deleted_orphan_bak:dsh\.cmd\.dsh-purge\.bak/);
  assert.equal(fs.existsSync(cmd + ".dsh-purge.bak"), false, "孤儿 bak 没被删掉");
  // 关键：绝不能按 bak 还原 —— CLI 必须还是指向解包的 app/
  assert.equal(fs.readFileSync(cmd, "utf8"), GOOD, "孤儿 bak 被当成还原基线用了");
});

test("revertCmdFlash 摘掉 bin.js 的隐藏控制台注入并清 sidecar", () => {
  const app = fresh("flash-app");
  const binRoot = path.join(app, "dsh");
  const binJs = path.join(binRoot, "lib", "bin.js");
  put(binJs, '#!/usr/bin/env node\nimport "./dsh-purge-hide-console.js"; // [dsh-purge] hide-console\nmain();\n');
  put(path.join(binRoot, "lib", "dsh-purge-hide-console.js"), "export {};\n");
  put(path.join(binRoot, "lib", "dsh-purge-child-process-hide.mjs"), "export {};\n");

  const report = core.revertCmdFlash(app, dshHome);
  assert.equal(report.hide, "reverted");
  assert.equal(fs.readFileSync(binJs, "utf8"), "#!/usr/bin/env node\nmain();\n");
  assert.equal(fs.existsSync(path.join(binRoot, "lib", "dsh-purge-hide-console.js")), false);
  assert.equal(fs.existsSync(path.join(binRoot, "lib", "dsh-purge-child-process-hide.mjs")), false);
});

test("inspectStaleBaks 预演只报不写，真跑才刷 bak", () => {
  const aiBase = path.join(root, "bak-ai");
  fs.rmSync(aiBase, { recursive: true, force: true });
  const rep = core.ALL_PATCHES.find((p) => p.id === 1).replacements[0];
  // 已打补丁的目标：bak 与现网不同，但判据应该认得出「这是我们打过的版本」→ 不刷
  const patchedTarget = path.join(aiBase, "dsh-agent-instructions", "lib", "index.js");
  put(patchedTarget, "// header\n" + rep.replace + "\n");
  put(patchedTarget + core.BAK_SUFFIX, "// header\n" + rep.pattern + "\n");
  // 真·过期 bak：原文件与 bak 不同，且看不出补丁痕迹 → 该刷
  const stray = path.join(aiBase, "misc", "notes.txt");
  put(stray, "new build\n");
  put(stray + core.BAK_SUFFIX, "old build\n");

  const dry = core.inspectStaleBaks(aiBase, { dryRun: true });
  assert.equal(dry.dryRun, true);
  assert.deepEqual(dry.refreshed.map((p) => path.resolve(p)), [path.resolve(stray)]);
  assert.equal(dry.skippedPatched, 1);
  assert.equal(fs.readFileSync(stray + core.BAK_SUFFIX, "utf8"), "old build\n");

  const refreshed = core.refreshStaleBaksForUpgrade(aiBase);
  assert.deepEqual(refreshed.map((p) => path.resolve(p)), [path.resolve(stray)]);
  assert.equal(fs.readFileSync(stray + core.BAK_SUFFIX, "utf8"), "new build\n");
  assert.equal(
    fs.readFileSync(patchedTarget + core.BAK_SUFFIX, "utf8"),
    "// header\n" + rep.pattern + "\n",
  );
});
