import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { resolveCandidatePath, findUnresolvedVarToken, filterCandidatePaths } from "../lib/path-guard.js";
import { findDesktopAppExecutable, commonDesktopInstallDirs } from "../lib/desktop.js";
import { usableInstallDir, normalizeDir } from "../scripts/install-offline.mjs";

// 2026-11-22（V15 收 · 代码审计 F3）：%VAR% 没展开被当真路径。
// 现场：任务目录里凭空长出 `%SystemDrive%\ProgramData\Microsoft\Windows\Caches\`（整棵缓存被复制进来），
// 发布克隆里长出 `NVIDIA Corporation/`。根因是"任何字符串都敢当路径用"——
// env / 配置 / 命令行里躺着 $env:DSH_HOME、%INSTALL_DIR% 这种没展开的占位符时，
// path.join / fs.cpSync 会把它当成 cwd 下的相对目录，于是写盘。
// 修法不是把它们塞进 .gitignore（那是把症状藏起来），而是在取候选路径的入口 reject。

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN = path.join(HERE, "..");
const SCRIPT = path.join(PLUGIN, "scripts", "install-offline.mjs");
const NODE = process.execPath;

test("占位符判定：%VAR% / $env:VAR / ${VAR} / $VAR 都认得，普通路径不误判", () => {
  assert.equal(findUnresolvedVarToken("%INSTALL_DIR%/DeepSeek Harness.exe"), "%INSTALL_DIR%");
  assert.equal(findUnresolvedVarToken("C:/plain/dir"), "");
  assert.equal(findUnresolvedVarToken("a/${NOPE_NOT_SET}/b"), "${NOPE_NOT_SET}");
  assert.equal(findUnresolvedVarToken("x/$env:NOPE_NOT_SET/y"), "$env:NOPE_NOT_SET");
  assert.equal(resolveCandidatePath("%INSTALL_DIR%/resources").path, "");
  assert.equal(resolveCandidatePath("%INSTALL_DIR%/resources").rejected, true);
});

test("能展开的就展开（%SystemDrive% 这类真实存在的变量），展不开的一律 reject", () => {
  // 显式给 env：Linux CI 上没有 SystemDrive 这个变量，靠宿主环境会恒 reject（2026-11-22 修）
  const hit = resolveCandidatePath("%SystemDrive%/ProgramData/x", { env: { SystemDrive: "C:" } });
  assert.equal(hit.rejected, false, hit.reason);
  assert.match(hit.path, /ProgramData[\\/]x$/);
  assert.ok(!hit.path.includes("%"), "展开之后不该还留着 %：" + hit.path);

  const miss = resolveCandidatePath("%INSTALL_DIR%/x", { env: {} });
  assert.equal(miss.path, "");
  assert.match(miss.reason, /%INSTALL_DIR%/);
});

test("批量过滤：能用的留下、去重、顺序稳定", () => {
  // 用平台绝对路径造夹具：posix 上 "C:/a" 不是绝对路径，会被正当拒绝（2026-11-22 修）
  const a1 = path.resolve(os.tmpdir(), "pa-a");
  const a3 = path.resolve(os.tmpdir(), "pa-c");
  const out = filterCandidatePaths([a1, "%INSTALL_DIR%/b", a1, "", a3], { env: {} });
  assert.deepEqual(out.map((p) => path.normalize(p)), [path.normalize(a1), path.normalize(a3)]);
});

test("探测入口：DSH_DESKTOP_INSTALL 写成 %INSTALL_DIR%\\DeepSeek Harness.exe 必须返回空", () => {
  // 审计给的就是这条判据。以前它会 walkParents 到 cwd，然后由一个空壳 exe 当选。
  const hit = findDesktopAppExecutable({
    execPath: NODE,
    resourcesPath: "",
    argv: [],
    discover: false,
    useCwd: false,
    env: { DSH_DESKTOP_INSTALL: "%INSTALL_DIR%\\DeepSeek Harness.exe" },
  });
  assert.equal(hit, "", "占位符路径被当成了安装目录：" + hit);
});

test("候选目录：ProgramFiles / LOCALAPPDATA 带占位符时一个都不许出现在候选里", () => {
  const dirs = commonDesktopInstallDirs(
    { ProgramFiles: "%ProgramFiles%", "ProgramFiles(x86)": "%ProgramFiles(x86)%", LOCALAPPDATA: "%LOCALAPPDATA%" },
    {},
  );
  const bad = dirs.filter((d) => String(d).includes("%"));
  assert.deepEqual(bad, [], "候选里还有没展开的占位符：" + bad.join(", "));
});

test("install-offline 的目录口径：usableInstallDir 拒占位符，normalizeDir 保持原语义", () => {
  assert.equal(usableInstallDir("%INSTALL_DIR%"), "");
  // 安装目录这一层连"能展开"的也拒：fs 不会替你展开，返回一个猜出来的目录比拒更危险。
  assert.equal(usableInstallDir("%USERPROFILE%/.dsh"), "");
  assert.equal(usableInstallDir("$env:DSH_HOME/x"), "");
  assert.equal(usableInstallDir("C:/Somewhere/DSH/"), "C:/Somewhere/DSH");
  assert.equal(normalizeDir("C:/Somewhere/DSH/"), "C:/Somewhere/DSH");
});

test("端到端：--source 给 %INSTALL_DIR% 时退 1，且不许在 cwd 里造出 % 目录", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "purge-f3-cwd-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "purge-f3-home-"));
  try {
    const env = { ...process.env, DSH_HOME: home };
    delete env.DSH_SURFACE;
    const res = spawnSync(NODE, [SCRIPT, "--source", "%INSTALL_DIR%", "--dsh-home", home], {
      cwd, encoding: "utf8", env,
    });
    assert.equal(res.status, 1, (res.stdout || "") + (res.stderr || ""));
    const junk = fs.readdirSync(cwd).filter((name) => name.includes("%"));
    assert.deepEqual(junk, [], "cwd 里长出了占位符目录：" + junk.join(", "));
  } finally {
    fs.rmSync(cwd, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});
