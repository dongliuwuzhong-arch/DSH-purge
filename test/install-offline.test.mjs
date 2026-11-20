import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  desktopInstallGuard, guardRefusalLines, liveDesktopDirs, normalizeDir, sameOrNested,
} from "../scripts/install-offline.mjs";

// 2026-11-16（S4）：不传 --desktop-install 时 install-offline 会自己探测桌面安装目录，
// 实测返回现网那份（%INSTALL_DIR%\DeepSeek Harness.exe），再写进
// <DSH_HOME>/dsh-purge/desktop-install.txt —— core.js 把这条当成"本插件认领的安装"，
// 于是沙箱里的插件会去改现网。护栏就是拦这一下。
//
// 判据（desktopInstallGuard）：
//   显式 --desktop-install / --allow-live → 放行；
//   本次 DSH_HOME 就是现网 DSH_HOME → 放行（给现网装插件，认领是对的）；
//   什么都没探测到 → 放行（没有东西可写）；
//   现网目录解析不出来（unresolved）→ 拒绝；
//   探测到的目录落在现网里 → 拒绝，并把目录打出来。

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "..", "scripts", "install-offline.mjs");
const NODE = process.execPath;

function sandboxHome(tag) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "purge-guard-" + tag + "-"));
  fs.mkdirSync(path.join(home, "profiles", "desktop"), { recursive: true });
  fs.writeFileSync(path.join(home, "profiles", "desktop", "package.json"),
    JSON.stringify({ name: "sandbox", dependencies: {}, dsh: { profile: { bundles: [] } } }), "utf8");
  return home;
}

/** 造一份"看起来像桌面安装"的目录：只放一个空 exe，够探测认出来就行。 */
function fakeInstall(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "purge-fake-" + tag + "-"));
  fs.writeFileSync(path.join(dir, "DeepSeek Harness.exe"), "");
  return dir;
}

/** 这台机器上自动探测会得到哪个目录 —— 问脚本自己（--allow-live --dry-run 会把它打出来）。
 *  探测结果依赖本机装了什么，测试不能写死它；拿到之后就能把"等于现网"这个情形摆稳。 */
function learnDetected(home) {
  const probe = runScript(["--dsh-home", home, "--profile", "desktop", "--dry-run", "--allow-live"]);
  assert.equal(probe.code, 0, probe.out);
  const hit = probe.out.match(/would write desktop-install\.txt: (.+)/);
  return hit ? normalizeDir(hit[1].trim()) : "";
}

/** 跑真脚本。继承的环境里先摘掉 DSH_HOME / DSH_DESKTOP_INSTALL，免得本机状态漏进来。 */
function runScript(args, { cwd = HERE, env = {} } = {}) {
  const inherited = { ...process.env };
  delete inherited.DSH_HOME;
  delete inherited.DSH_DESKTOP_INSTALL;
  const res = spawnSync(NODE, [SCRIPT, ...args], {
    cwd, encoding: "utf8", env: { ...inherited, ...env },
  });
  return { code: res.status, out: (res.stdout || "") + (res.stderr || "") };
}

test("同一个安装树：相等 / 相含都算，盘符根不算", () => {
  assert.ok(sameOrNested("D:\\Fixture\\DSH", "d:/fixture/dsh/"));
  assert.ok(sameOrNested("D:/Fixture/DSH/resources", "D:/Fixture/DSH"));
  assert.ok(sameOrNested("D:/Fixture/DSH", "D:/Fixture/DSH/resources"));
  assert.ok(!sameOrNested("D:/Fixture/DSH2", "D:/Fixture/DSH"));
  assert.ok(!sameOrNested("D:/Fixture/DSH", "C:/"));
  assert.equal(normalizeDir("D:\\Fixture\\DSH\\"), "D:/Fixture/DSH");
  assert.equal(normalizeDir(""), "");
});

test("护栏：沙箱 DSH_HOME + 探测到现网 → 拒绝", () => {
  const g = desktopInstallGuard({
    detected: "D:/Fixture/DSH",
    liveDirs: ["D:/Fixture/DSH"],
    liveHomes: ["%USERPROFILE%/.dsh"],
    dshHome: "C:/Temp/sb",
  });
  assert.equal(g.ok, false);
  assert.equal(g.reason, "live");
  assert.equal(g.liveDir, "D:/Fixture/DSH");
});

test("护栏：显式 --desktop-install 用点名的那份", () => {
  const g = desktopInstallGuard({
    detected: "D:/Fixture/DSH",
    liveDirs: ["D:/Fixture/DSH"],
    dshHome: "C:/Temp/sb",
    explicit: "C:/Temp/inst",
  });
  assert.deepEqual(g, { ok: true, use: "C:/Temp/inst", reason: "explicit", liveDir: "" });
});

test("护栏：--allow-live 放行（明确要认领现网）", () => {
  const g = desktopInstallGuard({
    detected: "D:/Fixture/DSH",
    liveDirs: ["D:/Fixture/DSH"],
    dshHome: "C:/Temp/sb",
    allowLive: true,
  });
  assert.equal(g.ok, true);
  assert.equal(g.reason, "allow-live");
  assert.equal(g.use, "D:/Fixture/DSH");
});

test("护栏：现网目录解析不出来 → 拒绝（不确定不算安全）", () => {
  const g = desktopInstallGuard({
    detected: "C:/Somewhere/DSH",
    liveDirs: [],
    liveHomes: ["%USERPROFILE%/.dsh"],
    dshHome: "C:/Temp/sb",
  });
  assert.equal(g.ok, false);
  assert.equal(g.reason, "unresolved");
});

test("护栏：本次 DSH_HOME 就是现网 DSH_HOME → 照常装（不是沙箱）", () => {
  const g = desktopInstallGuard({
    detected: "D:/Fixture/DSH",
    liveDirs: ["D:/Fixture/DSH"],
    liveHomes: ["%USERPROFILE%/.dsh"],
    dshHome: "%USERPROFILE%/.dsh",
  });
  assert.equal(g.ok, true);
  assert.equal(g.reason, "live-home");
});

test("护栏：什么都没探测到 → 放行（没有东西可写）", () => {
  const g = desktopInstallGuard({ detected: "", liveDirs: ["D:/Fixture/DSH"], dshHome: "C:/Temp/sb" });
  assert.equal(g.ok, true);
  assert.equal(g.use, "");
});

test("拒绝文案里必须把目录和两个出口都写出来", () => {
  const text = guardRefusalLines({
    detected: "D:/Fixture/DSH",
    reason: "live",
    liveDir: "D:/Fixture/DSH",
    dshHome: "C:/Temp/sb",
    stateFile: "C:/Temp/sb/dsh-purge/desktop-install.txt",
  }).join("\n");
  assert.ok(text.includes("D:/Fixture/DSH"), "必须打印被拒绝的目录：" + text);
  assert.ok(text.includes("--desktop-install"), text);
  assert.ok(text.includes("--allow-live"), text);
  assert.ok(text.includes("desktop-install.txt"), text);
});

test("liveDesktopDirs：认 DSH_DESKTOP_INSTALL 和 dsh-home 里记过的目录", () => {
  const home = sandboxHome("livedirs");
  fs.mkdirSync(path.join(home, "dsh-purge"), { recursive: true });
  fs.writeFileSync(path.join(home, "dsh-purge", "desktop-install.txt"), "D:/Fixture/DSH\n", "utf8");
  const dirs = liveDesktopDirs({
    env: { DSH_DESKTOP_INSTALL: "C:/Other/DSH" },
    dshHome: home,
    execPath: "C:/node/node.exe",
  });
  assert.ok(dirs.includes("C:/Other/DSH"), JSON.stringify(dirs));
  assert.ok(dirs.includes("D:/Fixture/DSH"), JSON.stringify(dirs));
});

test("端到端：沙箱装 + 探测到现网 → 拒绝，且一个字节都不写", () => {
  const home = sandboxHome("live");
  const detected = learnDetected(home);
  if (!detected) {
    // 这台机器一个桌面安装都探测不到：护栏没有对象可拦，走 no-install 放行。
    const plain = runScript(["--dsh-home", home, "--profile", "desktop", "--dry-run"]);
    assert.equal(plain.code, 0, plain.out);
    return;
  }
  const r = runScript(["--dsh-home", home, "--profile", "desktop"], {
    env: { DSH_DESKTOP_INSTALL: detected },
  });
  assert.equal(r.code, 1, r.out);
  assert.ok(r.out.includes("拒绝"), r.out);
  assert.ok(r.out.includes(detected), "必须打印探测到的目录：" + r.out);
  assert.ok(!fs.existsSync(path.join(home, "dsh-purge", "desktop-install.txt")), "拒绝时不许写 desktop-install.txt");
  assert.ok(!fs.existsSync(path.join(home, "plugins", "dsh-purge")), "拒绝时不许复制插件");
});

test("端到端：沙箱装 + --allow-live → 放行（dry-run 不落盘）", () => {
  const home = sandboxHome("allow");
  const detected = learnDetected(home);
  assert.ok(!fs.existsSync(path.join(home, "dsh-purge")), "dry-run 不许落盘");
  if (!detected) return;
  const inst = fakeInstall("allow");
  const r = runScript(["--dsh-home", home, "--profile", "desktop", "--dry-run", "--allow-live"], {
    cwd: inst,
    env: { DSH_DESKTOP_INSTALL: detected },
  });
  assert.equal(r.code, 0, r.out);
  assert.ok(r.out.includes("would write desktop-install.txt: " + detected), r.out);
  assert.ok(!fs.existsSync(path.join(home, "dsh-purge")), "dry-run 不许落盘");
});

test("端到端：显式 --desktop-install 用给的目录，不再探测", () => {
  const home = sandboxHome("explicit");
  const inst = fakeInstall("explicit");
  const want = fakeInstall("want");
  const r = runScript(
    ["--dsh-home", home, "--profile", "desktop", "--dry-run", "--desktop-install", want],
    { cwd: inst, env: { DSH_DESKTOP_INSTALL: inst } },
  );
  assert.equal(r.code, 0, r.out);
  assert.ok(r.out.includes("would write desktop-install.txt: " + normalizeDir(want)), r.out);
  assert.ok(r.out.includes(normalizeDir(want)) && !r.out.includes("would write desktop-install.txt: " + normalizeDir(inst)), r.out);
});

test("端到端：--help 只打印用法，不装东西", () => {
  const home = sandboxHome("help");
  const r = runScript(["--help", "--dsh-home", home, "--profile", "desktop"]);
  assert.equal(r.code, 0, r.out);
  assert.ok(r.out.includes("--allow-live"), r.out);
  assert.ok(!fs.existsSync(path.join(home, "plugins")), "--help 不许落盘");
});
