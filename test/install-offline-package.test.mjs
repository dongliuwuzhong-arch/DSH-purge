import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// 2026-11-22（V15 工程 P1-7 / 台账第 4 条）：preflight-baseline.json 是"我这台机器"的贴点记录。
// 它跟着插件进别人的 home，对方的预检差分就变成拿我的基线比他的机器。
// 判据：真装一次（不 dry-run），装进去的副本里不许有它，别的文件照旧在。
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "..", "scripts", "install-offline.mjs");
const NODE = process.execPath;

function writeFile(file, body = "") {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, "utf8");
}

/** 一份最小的"包"：装的时候不校验内容，只要目录形态够走过 copyPackage + linkPackage。 */
function stubSource() {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), "purge-src-"));
  writeFile(path.join(src, "package.json"), JSON.stringify({ name: "dsh-purge", version: "0.0.0-stub" }));
  writeFile(path.join(src, "lib", "index.js"), "export {};\n");
  writeFile(path.join(src, "lib", "keep.js"), "export const keep = 1;\n");
  writeFile(path.join(src, "client.js"), "");
  writeFile(path.join(src, "cordis.patch.yml"), "");
  writeFile(path.join(src, "scripts", "preflight-baseline.json"), '{"version":"bogus"}\n');
  writeFile(path.join(src, "scripts", "install-offline.mjs"), "// stub\n");
  writeFile(path.join(src, "test", "x.test.mjs"), "// stub\n");
  return src;
}

function sandboxHome(tag) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "purge-pkghome-" + tag + "-"));
  writeFile(path.join(home, "profiles", "desktop", "package.json"),
    JSON.stringify({ name: "sandbox", dependencies: {}, dsh: { profile: { bundles: [] } } }));
  return home;
}

test("装一份：scripts/preflight-baseline.json 不许进别人的 DSH_HOME，别的脚本照旧进", () => {
  const src = stubSource();
  const home = sandboxHome("baseline");
  const inst = fs.mkdtempSync(path.join(os.tmpdir(), "purge-pkginst-"));
  const inherited = { ...process.env };
  delete inherited.DSH_HOME;
  delete inherited.DSH_DESKTOP_INSTALL;
  const res = spawnSync(NODE, [
    SCRIPT, "--dsh-home", home, "--profile", "desktop", "--source", src, "--desktop-install", inst,
  ], { cwd: HERE, encoding: "utf8", env: inherited });
  const out = (res.stdout || "") + (res.stderr || "");
  assert.equal(res.status, 0, out);

  const plugin = path.join(home, "plugins", "dsh-purge");
  assert.ok(fs.existsSync(path.join(plugin, "lib", "keep.js")), "普通文件应该被装进去");
  assert.ok(fs.existsSync(path.join(plugin, "scripts", "install-offline.mjs")), "scripts/ 里别的文件应该被装进去");
  assert.ok(!fs.existsSync(path.join(plugin, "scripts", "preflight-baseline.json")),
    "本机预检基线被装进了别人的 home：" + path.join(plugin, "scripts", "preflight-baseline.json"));
  assert.ok(!fs.existsSync(path.join(plugin, "test")), "test/ 应该被跳过");
});
