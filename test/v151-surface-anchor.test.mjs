import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { installAnchor, installLooksDesktop, detectSurface, detectSurfaceWithAnchor } from "../lib/surface.js";

// 2026-11-22（V15 收 · 文档审计 S1-1）：
// 纯 node 进程里 process.execPath 是 node.exe，detectSurface() 一律判 web；
// 而 web 的插件根探测明确排除桌面安装路径（core.findAiBaseWeb 的 isInsideDesktopInstall），
// 于是命令行上 `dsh-purge --status` 永远「插件根未找到」，它提示的 DSH_BASE 也是死路。
// 判据改成"安装锚点"：<DSH_HOME>/dsh-purge/desktop-install.txt 记的那份桌面安装。

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, "..", "bin", "dsh-purge.js");
const NODE = process.execPath;

/** 一份"像桌面安装"的空目录：有 resources/app/dsh 就够 installLooksDesktop 认。 */
function fakeInstall(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "purge-anchor-" + tag + "-"));
  const appDsh = path.join(dir, "resources", "app", "dsh");
  fs.mkdirSync(appDsh, { recursive: true });
  // 2026-11-22：Linux CI 上这条会红——只有 resources/app/dsh 时 targetFiles() 找不到 @deepseek-ai，
  // --status 认成 desktop 之后仍打不出"补丁 N/M 已清洗"。所以夹具里补一棵最小插件根。
  const ai = path.join(appDsh, "node_modules", "@deepseek-ai", "dsh-agent-instructions", "lib");
  fs.mkdirSync(ai, { recursive: true });
  fs.writeFileSync(path.join(ai, "index.js"), "// fixture\n", "utf8");
  return dir;
}

function homeWith(anchorLine) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "purge-anchor-home-"));
  if (anchorLine !== null) {
    fs.mkdirSync(path.join(home, "dsh-purge"), { recursive: true });
    fs.writeFileSync(path.join(home, "dsh-purge", "desktop-install.txt"), anchorLine + "\n", "utf8");
  }
  return home;
}

function runStatus(home, extra = []) {
  const env = { ...process.env, DSH_HOME: home };
  delete env.DSH_SURFACE;
  delete env.DSH_DESKTOP_INSTALL;
  delete env.DSH_BASE;
  const res = spawnSync(NODE, [BIN, "--status", ...extra], { encoding: "utf8", env, timeout: 120000 });
  return { code: res.status, out: String(res.stdout || "") + String(res.stderr || "") };
}

test("installLooksDesktop：认 resources/app/dsh，也认同名 exe；带占位符的不算", () => {
  const dir = fakeInstall("look");
  try {
    assert.equal(installLooksDesktop(dir), true);
    assert.equal(installLooksDesktop(path.join(dir, "resources", "app", "dsh")), false, "里面那层不是安装根");
    assert.equal(installLooksDesktop("%INSTALL_DIR%"), false, "占位符不是路径");
    assert.equal(installLooksDesktop(path.join(dir, "nope.exe")), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("installAnchor：认领文件指向真安装 → desktop；文件里有占位符 → 不认", () => {
  const install = fakeInstall("hit");
  const home = homeWith(install.replace(/\\/g, "/"));
  const homeBad = homeWith("%INSTALL_DIR%");
  try {
    const hit = installAnchor({ dshHome: home, env: {} });
    assert.equal(hit.desktop, true);
    assert.equal(hit.anchor.toLowerCase(), path.normalize(install).toLowerCase());
    assert.equal(installAnchor({ dshHome: homeBad, env: {} }).desktop, false);
    assert.equal(installAnchor({ dshHome: home, env: { DSH_DESKTOP_INSTALL: "%INSTALL_DIR%" } }).desktop, true,
      "显式 env 优先，但占位符不算 —— 这里应当回落到认领文件");
  } finally {
    fs.rmSync(install, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(homeBad, { recursive: true, force: true });
  }
});

test("detectSurfaceWithAnchor 与 detectSurface 分工：后者不掺磁盘状态", () => {
  const install = fakeInstall("split");
  const home = homeWith(install.replace(/\\/g, "/"));
  try {
    assert.equal(detectSurface({ env: {} }), "web", "纯 node + 无 DSH_SURFACE → web（既有语义不能变）");
    assert.equal(detectSurfaceWithAnchor({ dshHome: home, env: {} }), "desktop");
    assert.equal(detectSurfaceWithAnchor({ dshHome: home, env: { DSH_SURFACE: "web" } }), "web", "显式最优先");
  } finally {
    fs.rmSync(install, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("CLI：不给 DSH_SURFACE 时 --status 靠安装锚点认出 desktop", () => {
  const install = fakeInstall("cli");
  const home = homeWith(install.replace(/\\/g, "/"));
  try {
    const res = runStatus(home);
    assert.equal(res.code, 0, res.out);
    assert.match(res.out, /宿主 \/ surface desktop/, res.out.split(/\r?\n/).slice(0, 6).join(" / "));
    assert.match(res.out, /安装锚点/);
    // 认成 desktop 之后必须真的拿到逐条状态 —— 以前这里打的是「未定位宿主插件根，逐条状态未知」
    assert.match(res.out, /补丁 \d+\/\d+ 已清洗/, "没有打出逐条状态汇总行");
  } finally {
    fs.rmSync(install, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("CLI：--surface web 压过安装锚点（人要说清楚就该听人的）", () => {
  const install = fakeInstall("web");
  const home = homeWith(install.replace(/\\/g, "/"));
  try {
    const res = runStatus(home, ["--surface", "web"]);
    assert.equal(res.code, 0, res.out);
    assert.match(res.out, /宿主 \/ surface web/);
  } finally {
    fs.rmSync(install, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});
