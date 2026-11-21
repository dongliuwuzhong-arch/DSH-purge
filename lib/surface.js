import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { hasVarToken } from "./path-guard.js";

/** 当前已接线的宿主面。gui / tui 先能识别，适配仍回退 web。 */
export const SURFACES = Object.freeze(["web", "desktop", "gui", "tui"]);

/** 社区 Electron 端（ds-bot / deepseek-bot / dsh-next）沿用同一套 resources/app 结构。 */
const COMMUNITY_HOST_NAMES = ["ds-bot", "dsbot", "deepseek-bot", "deepseek bot", "dsh-next", "dsh next"];

/**
 * 取入参，不拿本进程的真实值去顶"调用方没给"的字段。
 *
 * [1.1.98] 以前统一写成 `input.resourcesPath ?? process.resourcesPath`：只要调用方显式
 * 传了 execPath/versions（测试、或者别的宿主内嵌），没传的 resourcesPath/argv 就会回落到
 * **本进程**的真实值，于是纯 node 语义的判定在 Electron 里永远变成 desktop。判定函数一旦
 * 混着"显式入参 + 隐式环境"，就没法隔离验证，也没法在别的宿主里复用。
 *
 * 规则：入参里出现任何一个身份字段，就按"隔离判定"算——没给的一律当空。
 * 一个都不给（真宿主调用 detectSurface()）才回落到 process.*。
 */
function inputOrAmbient(input, key, ambientValue) {
  if (Object.prototype.hasOwnProperty.call(input, key)) return input[key];
  const isolated = ["execPath", "resourcesPath", "argv", "versions", "env"]
    .some((k) => Object.prototype.hasOwnProperty.call(input, k));
  return isolated ? undefined : ambientValue;
}

function norm(value) {
  return String(value || "").trim().toLowerCase();
}

function slash(value) {
  return String(value || "").replace(/\\/g, "/").toLowerCase();
}

function exeName(execPath) {
  return path.basename(String(execPath || "")).toLowerCase();
}

function communityNameHit(n) {
  if (!n) return false;
  return COMMUNITY_HOST_NAMES.some((k) => n.includes(k));
}

export function pathLooksDesktop(p) {
  const n = slash(p);
  if (!n) return false;
  // 安装目录可能叫 "DeepSeek Harness" / "deepseek-harness" / "DeepseekHarnessDesktop"。
  // 源码仓库也常带 deepseek-harness 名字，所以还要带 resources/、exe、.app/ 才算桌面安装。
  const harnessDir =
    n.includes("/deepseek harness/") ||
    n.includes("/deepseek-harness/") ||
    n.includes("/deepseekharness") ||
    /\/deepseek[\s._-]*harness/.test(n);
  return (
    n.includes("/dsh desktop/") ||
    n.includes("/dsh desktop.app/") ||
    n.includes("dsh-desktop") ||
    n.includes("dsh-plugin-desktop") ||
    n.includes("/deepseek harness.app/") ||
    (harnessDir && (n.includes("/resources/") || n.includes("/contents/resources/") || n.endsWith("/resources"))) ||
    /\/dsh desktop\.exe$/i.test(n) ||
    /\/deepseek[\s._-]*harness\.exe$/i.test(n) ||
    n.endsWith("/host-process-entry.js") ||
    n.endsWith("/desktop-cli.js")
  );
}

function resourcesLookLikeDesktopInstall(resourcesPath) {
  if (!resourcesPath) return false;
  if (pathLooksDesktop(resourcesPath)) return true;
  const n = slash(resourcesPath);
  if (!(n.endsWith("/resources") || n.includes("/contents/resources"))) return false;
  try {
    const asar = path.join(resourcesPath, "app.asar");
    if (fs.existsSync(asar) && fs.statSync(asar).isFile()) return true;
    if (fs.existsSync(path.join(resourcesPath, "app", "dsh"))) return true;
    if (fs.existsSync(path.join(resourcesPath, "app.asar.unpacked", "dsh"))) return true;
  } catch {
    /* ignore */
  }
  return false;
}

/**
 * 社区 Electron 端（ds-bot / deepseek-bot / dsh-next）不是官方 DeepSeek Harness 桌面端，
 * 但重启与探测走的是同一条路。宽判据只在 process.versions.electron 存在时才生效——
 * 纯 node 进程的 argv 里出现 dsh-next 路径，不该被当成桌面端。
 */
export function isCommunityElectronHost(input = {}) {
  const versions = inputOrAmbient(input, "versions", process.versions);
  if (!versions || !versions.electron) return false;
  const execPath = inputOrAmbient(input, "execPath", process.execPath);
  const name = exeName(execPath);
  if (/^(ds-?bot|dsh[ -]next|deepseek[ -]bot)(\.exe)?$/.test(name)) return true;
  if (communityNameHit(slash(execPath))) return true;
  const resourcesPath = inputOrAmbient(input, "resourcesPath", process.resourcesPath);
  if (communityNameHit(slash(resourcesPath))) return true;
  const argv = inputOrAmbient(input, "argv", process.argv);
  if ((Array.isArray(argv) ? argv : []).some((arg) => communityNameHit(slash(arg)))) return true;
  return false;
}

export function isDesktopSurface(input = {}) {
  const env = inputOrAmbient(input, "env", process.env);
  const forced = norm(env.DSH_SURFACE);
  if (forced === "desktop") return true;
  if (forced && SURFACES.includes(forced)) return false;

  const execPath = inputOrAmbient(input, "execPath", process.execPath);
  const name = exeName(execPath);
  if (
    name === "dsh desktop.exe" ||
    name === "dsh desktop" ||
    name === "deepseek harness.exe" ||
    name === "deepseek-harness.exe" ||
    name === "deepseek harness" ||
    name === "deepseek-harness" ||
    /^deepseek[\s._-]*harness(\.exe)?$/.test(name)
  ) return true;
  if (pathLooksDesktop(execPath)) return true;
  if (isCommunityElectronHost(input)) return true;

  const resourcesPath = inputOrAmbient(input, "resourcesPath", process.resourcesPath);
  if (resourcesLookLikeDesktopInstall(resourcesPath)) return true;

  const argv = inputOrAmbient(input, "argv", process.argv);
  if ((Array.isArray(argv) ? argv : []).some((arg) => pathLooksDesktop(arg))) return true;

  const parentPort = inputOrAmbient(input, "parentPort", process.parentPort);
  if (parentPort && (pathLooksDesktop(execPath) || resourcesLookLikeDesktopInstall(resourcesPath))) return true;

  if (env.ELECTRON_RUN_AS_NODE && (pathLooksDesktop(execPath) || resourcesLookLikeDesktopInstall(resourcesPath))) return true;
  return false;
}

/**
 * 安装锚点（V15 收 · 文档审计 S1-1）。
 *
 * 病：纯 node 进程里 execPath 是 node.exe，`isDesktopSurface()` 一律判 false → surface=web；
 * 而 web 的插件根探测**明确排除**桌面安装路径（core.findAiBaseWeb 里的
 * `!desktop.isInsideDesktopInstall(p)`），于是 CLI 上 `dsh-purge --status` 永远
 * "插件根未找到"，连它指的那句"设 DSH_BASE 后重试"也无效（本机唯一宿主就在桌面安装里）。
 *
 * 判据只能问"这台机器上有没有一份桌面安装，且本插件认领了它"：
 *   1 `DSH_DESKTOP_INSTALL`（显式点名，install-offline --desktop-install 也会写进下面那个文件）；
 *   2 `<DSH_HOME>/dsh-purge/desktop-install.txt`（applyRuntimeEnv / install-offline 的认领记录）。
 * 两条都要求目标真像一份桌面安装（含 resources/app/dsh 或同名 exe），名字对不上不算。
 */
export function installLooksDesktop(value) {
  const raw = String(value ?? "").trim();
  if (!raw || hasVarToken(raw)) return false;
  const p = path.normalize(raw);
  try {
    const st = fs.statSync(p);
    if (st.isFile()) {
      return /^(deepseek[\s._-]*harness|dsh desktop)(\.exe)?$/i.test(path.basename(p));
    }
    if (!st.isDirectory()) return false;
    if (fs.existsSync(path.join(p, "resources", "app", "dsh"))) return true;
    if (fs.existsSync(path.join(p, "resources", "app.asar"))) return true;
    if (fs.existsSync(path.join(p, "resources", "app.asar.unpacked", "dsh"))) return true;
    for (const name of fs.readdirSync(p)) {
      if (/^(deepseek[\s._-]*harness|dsh desktop)(\.exe)?$/i.test(name)) return true;
    }
  } catch {
    return false;
  }
  return false;
}

/** 读锚点，返回 { desktop, anchor, source }；source 是给人看的一句话。 */
export function installAnchor(input = {}) {
  const env = inputOrAmbient(input, "env", process.env);
  const explicit = String(env.DSH_DESKTOP_INSTALL || "").trim();
  if (explicit && installLooksDesktop(explicit)) {
    return { desktop: true, anchor: path.normalize(explicit), source: "DSH_DESKTOP_INSTALL" };
  }
  const home = String(input.dshHome || env.DSH_HOME || "").trim() || path.join(os.homedir(), ".dsh");
  const file = path.join(home, "dsh-purge", "desktop-install.txt");
  try {
    const line = fs.readFileSync(file, "utf8").split(/\r?\n/).map((s) => s.trim()).find(Boolean) || "";
    if (line && installLooksDesktop(line)) {
      return { desktop: true, anchor: path.normalize(line), source: file };
    }
  } catch {
    /* 没有认领记录就是没有 */
  }
  return { desktop: false, anchor: "", source: "" };
}

/**
 * CLI / 纯 node 进程用的 surface 判定：显式 DSH_SURFACE 最优先，其次进程身份，最后安装锚点。
 * 注意 `detectSurface()` 故意不含锚点 —— 它在宿主内被上百处调用，而测试与嵌入场景靠的是
 * "进程身份"，把磁盘状态混进去会让同一份代码在开发机上算 desktop、在 CI 上算 web。
 */
export function detectSurfaceWithAnchor(input = {}) {
  const env = inputOrAmbient(input, "env", process.env);
  const forced = forcedSurface(env);
  if (forced) return forced;
  if (isDesktopSurface(input)) return "desktop";
  if (installAnchor(input).desktop) return "desktop";
  return "web";
}

function forcedSurface(env) {
  const forced = norm(env.DSH_SURFACE);
  return SURFACES.includes(forced) ? forced : "";
}

export function detectSurface(input = {}) {
  const env = inputOrAmbient(input, "env", process.env);
  const forced = forcedSurface(env);
  if (forced) return forced;
  if (isDesktopSurface(input)) return "desktop";
  return "web";
}

/** gui / tui 尚未单独适配，先走 web 重启与探测。 */
export function adapterFor(kind) {
  return kind === "desktop" ? "desktop" : "web";
}
