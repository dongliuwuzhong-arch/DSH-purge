import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// DSH_HOME 先指向临时目录再加载插件：findDshHome() 优先读它，整趟不碰真的 ~/.dsh。
const root = fs.mkdtempSync(path.join(os.tmpdir(), "dshpurge-uninstall-"));
const dshHome = path.join(root, "home");
process.env.DSH_HOME = dshHome;
fs.mkdirSync(dshHome, { recursive: true });

const aiBase = path.join(root, "ai");
const target = path.join(aiBase, "dsh-agent-instructions", "lib", "index.js");
const strayBak = path.join(aiBase, "misc", "notes.txt.dshpurge.bak");
const CLI = "C:/Software/DSH/resources/runtime/cli/bin/dsh.cmd";
const CLI_BAK = CLI + ".dsh-purge.bak";

const { ALL_PATCHES } = await import("../lib/core.js");
const { uninstallPurge } = await import("../lib/uninstall.js");

const rep = ALL_PATCHES.find((p) => p.id === 1).replacements[0];
const ORIGINAL = "// fixture header\n" + rep.pattern + "\nmodule.exports = {};\n";
const PATCHED = ORIGINAL.replace(rep.pattern, rep.replace);

function put(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text, "utf8");
}

function seed() {
  fs.rmSync(aiBase, { recursive: true, force: true });
  fs.rmSync(path.join(dshHome, ".agent-presets"), { recursive: true, force: true });
  // 现场：补丁已打上，旁边躺着原件 bak；另有一个不在补丁表里的游离 bak（回滚不认识，应进清单）
  put(target, PATCHED);
  put(target + ".dshpurge.bak", ORIGINAL);
  put(strayBak, "stray original\n");
  // 破甲预设：卸载后应该被挪进 .disabled
  put(path.join(dshHome, ".agent-presets", "redteam", "agent.cordis.yml"), "apiVersion: dsh/v1\n");
  put(path.join(dshHome, ".agent-presets", "redteam", "anchor-gate.mjs"), "export default {};\n");
}

test.after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

test("卸载：注入的 state + skipRuntime 下把补丁收拾干净、预设挪走、清单落地", async () => {
  seed();
  const cliBefore = fs.existsSync(CLI) ? fs.readFileSync(CLI) : null;
  const cliBakBefore = fs.existsSync(CLI_BAK) ? fs.readFileSync(CLI_BAK) : null;

  const report = await uninstallPurge({
    state: {
      ai_base: aiBase,
      dsh_home: dshHome,
      host_version: "0.2.1-rc.3",
      has_backup: true,
      patches_applied: 1,
    },
    skipRuntime: true,
  });

  assert.deepEqual(report.errors, [], "卸载报告里不该有错误：" + JSON.stringify(report.errors));
  assert.equal(report.ok, true);
  assert.equal(report.applied, true);
  assert.equal(report.reverted, true);
  assert.deepEqual(report.shim, { skipped: true }, "shim 复原该被跳过");
  assert.deepEqual(report.flash, { skipped: true }, "flash 复原该被跳过");

  // 补丁回滚：现网逐字节回到原件，bak 被吃掉
  assert.equal(fs.readFileSync(target, "utf8"), ORIGINAL, "补丁没回滚");
  assert.equal(fs.existsSync(target + ".dshpurge.bak"), false, "回滚后 bak 该删掉");
  assert.ok(Array.isArray(report.patches.reverted));

  // 破甲预设挪进 .disabled（只改名不删除，反悔能挪回来）
  assert.equal(report.presets.moved, true);
  assert.equal(fs.existsSync(path.join(dshHome, ".agent-presets", "redteam")), false);
  assert.ok(fs.existsSync(path.join(dshHome, ".agent-presets", ".disabled", "redteam", "agent.cordis.yml")));

  // 备份清单：只剩游离 bak 被记下来，且 original 不带后缀
  const manifestPath = path.join(dshHome, "dsh-purge-bak-manifest.json");
  assert.equal(report.bakManifest.path, manifestPath);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.host, "0.2.1-rc.3");
  assert.equal(manifest.count, report.bakManifest.count);
  assert.equal(manifest.count, 1, "清单里该只剩那个游离 bak，实际 " + JSON.stringify(manifest.backups));
  assert.equal(path.resolve(manifest.backups[0].bak), path.resolve(strayBak));
  assert.ok(manifest.backups[0].original.endsWith("notes.txt"), "original 不该带 .dshpurge.bak 后缀");
  assert.equal(manifest.backups[0].originalExists, false);

  // 宿主 CLI 目录一个字节都不许动（skipRuntime 的承诺）
  assert.ok(cliBefore === null || fs.readFileSync(CLI).equals(cliBefore), "宿主 dsh.cmd 被改了");
  assert.ok(cliBakBefore === null || fs.existsSync(CLI_BAK) && fs.readFileSync(CLI_BAK).equals(cliBakBefore), "宿主 dsh.cmd.bak 被改了");
});

test("卸载：没有预设、没有 bak 时也不该报错（空场幂等）", async () => {
  fs.rmSync(aiBase, { recursive: true, force: true });
  fs.rmSync(path.join(dshHome, ".agent-presets"), { recursive: true, force: true });
  fs.rmSync(path.join(dshHome, "dsh-purge-bak-manifest.json"), { force: true });

  const report = await uninstallPurge({
    state: { ai_base: aiBase, dsh_home: dshHome, host_version: null, has_backup: false, patches_applied: 0 },
    skipRuntime: true,
  });

  assert.deepEqual(report.errors, []);
  assert.equal(report.ok, true);
  assert.equal(report.applied, false);
  assert.equal(report.presets.moved, false);
  assert.equal(report.presets.reason, "absent");
  assert.equal(report.bakManifest.count, 0);
});
