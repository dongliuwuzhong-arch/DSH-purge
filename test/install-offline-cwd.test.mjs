import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { findDesktopAppExecutable } from "../lib/desktop.js";
import { normalizeDir } from "../scripts/install-offline.mjs";

// 2026-11-22（V15 工程 P1-4 / F-03）：探测认 cwd 的旧行为。
// 现场实测（审计 §1.1）：在任意一个只放了一个空壳 "DeepSeek Harness.exe" 的目录里跑
// install-offline，探测会返回那个空壳目录，再写进 <DSH_HOME>/dsh-purge/desktop-install.txt
// —— core.js 把这条当成"本插件认领的安装"，于是去向一个空目录贴补丁。
// 两道修：①DSH_DESKTOP_INSTALL 排在 cwd 前面；②install-offline 用 useCwd:false 整体关掉 cwd。
// 所以这里的反例是"含同名 exe 的临时目录"，不是文件是否存在的断言。

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "..", "scripts", "install-offline.mjs");
const NODE = process.execPath;

function fakeInstall(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "purge-cwd-" + tag + "-"));
  fs.writeFileSync(path.join(dir, "DeepSeek Harness.exe"), "");
  return dir;
}

function sandboxHome(tag) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "purge-cwdhome-" + tag + "-"));
  fs.mkdirSync(path.join(home, "profiles", "desktop"), { recursive: true });
  fs.writeFileSync(path.join(home, "profiles", "desktop", "package.json"),
    JSON.stringify({ name: "sandbox", dependencies: {}, dsh: { profile: { bundles: [] } } }), "utf8");
  return home;
}

function runScript(args, { cwd = HERE, env = {} } = {}) {
  const inherited = { ...process.env };
  delete inherited.DSH_HOME;
  delete inherited.DSH_DESKTOP_INSTALL;
  const res = spawnSync(NODE, [SCRIPT, ...args], {
    cwd, encoding: "utf8", env: { ...inherited, ...env },
  });
  return { code: res.status, out: (res.stdout || "") + (res.stderr || "") };
}

const probe = (extra) => findDesktopAppExecutable({
  execPath: NODE,
  argv: [],
  env: {},
  discover: false,
  resourcesPath: "",
  ...extra,
});

test("探测：DSH_DESKTOP_INSTALL 点名的那份赢过 cwd 里的同名空壳 exe", () => {
  const wanted = fakeInstall("wanted");
  const empty = fakeInstall("empty");
  const hit = probe({ cwd: empty, env: { DSH_DESKTOP_INSTALL: wanted } });
  assert.equal(normalizeDir(path.dirname(hit)), normalizeDir(wanted), hit);
});

test("探测：useCwd:false 时 cwd 完全不参与（不再认空壳 exe）", () => {
  const empty = fakeInstall("off");
  const hit = probe({ cwd: empty, useCwd: false });
  assert.ok(!normalizeDir(hit).toLowerCase().includes(normalizeDir(empty).toLowerCase()),
    "useCwd:false 仍返回了 cwd 里的 exe：" + hit);
});

test("探测：裸参数（--profile desktop）不许把 cwd 漏回探测起点", () => {
  // 这是 F-03 的第二条泄漏，比 useCwd 那条隐蔽：argv 里 "desktop" 这类裸词按 cwd 解析后
  // dirname 就是当前目录，于是"仅靠 useCwd:false"仍然认得出 cwd 里那个空壳 exe。
  const empty = fakeInstall("argv");
  const hit = probe({ cwd: empty, useCwd: false, argv: ["--profile", "desktop", "--dry-run"] });
  assert.ok(!normalizeDir(hit).toLowerCase().includes(normalizeDir(empty).toLowerCase()),
    "裸参数把 cwd 带回来了：" + hit);
});

test("探测：useCwd 不传时 cwd 仍然作数（别为了修 F-03 把已有一路探测拆掉）", () => {
  const empty = fakeInstall("on");
  const hit = probe({ cwd: empty });
  assert.equal(normalizeDir(path.dirname(hit)), normalizeDir(empty), hit);
});

test("端到端：cwd 里有同名空壳 exe，写进 desktop-install.txt 的是点名的那份", () => {
  const home = sandboxHome("win");
  const cwdDir = fakeInstall("cwdwin");
  const wanted = fakeInstall("want");
  // --allow-live：DSH_DESKTOP_INSTALL 自己也会被 liveDesktopDirs 当成"现网"，护栏会拦。
  const r = runScript(["--dsh-home", home, "--profile", "desktop", "--dry-run", "--allow-live"], {
    cwd: cwdDir,
    env: { DSH_DESKTOP_INSTALL: wanted },
  });
  assert.equal(r.code, 0, r.out);
  assert.ok(r.out.includes("would write desktop-install.txt: " + normalizeDir(wanted)), r.out);
  assert.ok(!r.out.includes(normalizeDir(cwdDir)), "认了 cwd 里那个空壳目录：" + r.out);
});

test("端到端：没人点名时，cwd 里的空壳目录也不许被认成安装", () => {
  const home = sandboxHome("nocwd");
  const cwdDir = fakeInstall("cwdonly");
  const r = runScript(["--dsh-home", home, "--profile", "desktop", "--dry-run"], { cwd: cwdDir });
  assert.ok(r.code === 0 || r.code === 1, r.out);
  assert.ok(!r.out.includes(normalizeDir(cwdDir)), "把 cwd 那个空壳目录写进去了：" + r.out);
});
