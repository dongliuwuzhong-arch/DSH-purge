/**
 * [1.2.1] 密封 asar 启动自愈。
 *
 * 为什么需要它：官方桌面版把宿主代码封在 `resources\\app.asar` 里，
 * dsh-purge 的补丁只能写进去的 `resources\\app\\` 目录。让补丁真正生效，
 * 必须把 `app.asar` 改名挪走，逼 Electron 回退到目录形态（Electron 的
 * appSearchPaths 默认序列是 `["app.asar", "app", "default_app.asar"]`，见
 * shell/common/node_bindings.cc）。
 *
 * 而**每一次官方更新都会把 app.asar 放回来**，宿主随即转而加载未打补丁的原包，
 * 界面一切正常、零报错，只有补丁静默失效。1.2.0 及更早只处理了「升级刚装完」
 * 这一次（official-update.wscript 写 reapply-asar.pending），没处理三种残留：
 *
 *   1. 换了 asar 但没把 `app.asar.bak` 挪出 resources —— 下次官方更新脚本
 *      看到「asar 不在 + bak 在」会把 bak 复制回 asar（official-update.wscript:41）。
 *   2. 上次换包中途失败，asar 还在、补丁树也在。
 *   3. 用户手动重装了同版本，标记没人写。
 *
 * 本模块只做**判定**，不动手。动手仍然走 core.restartSealedDesktopIfNeeded()，
 * 这样杀进程/改名/重开这套经过验证的路径不需要第二套实现。
 */

import path from "node:path";
import { hostFs as fs } from "./extract-asar.js";
import { upgradeMarkerDir } from "./official-update.js";


/**
 * bak 归档目录。放在 ~/.dsh/dsh-purge/asar-archive/ 下——
 * 官方 NSIS 升级会把整个安装目录清一遍，放安装目录里等于没备份。
 */
export function asarArchiveDir() {
  const base = upgradeMarkerDir();
  if (!base) return "";
  return path.join(base, "asar-archive");
}

/** 自愈判定结果。`action` 就是调用方该做的事。 */
export const HEAL_ACTIONS = Object.freeze({
  /** 一切正常：asar 不在、补丁树有补丁。什么都不做。 */
  HEALTHY: "healthy",
  /** asar 回来了（官方更新 / 手动重装）。需要重打补丁 + 换包。 */
  NEEDS_REAPPLY: "needs-reapply",
  /** asar 不在，但 bak 还留在 resources 里，下次更新会把它复原。只需挪走 bak。 */
  NEEDS_UNBURY_BAK: "needs-unbury-bak",
  /** 补丁树存在但没有补丁痕迹：不要换包，换了等于加载未打补丁的目录。 */
  NEEDS_APPLY_FIRST: "needs-apply-first",
  /** 补丁树都不在了：无法自愈，只能等用户点「应用」重新解包。 */
  BROKEN_NO_TREE: "broken-no-tree",
});

/**
 * 注意：这里**故意没有** "not-applicable" 这一档。
 * 「非桌面 / 定位不到安装目录」由调用方在进入本模块之前就短路掉
 * （`desktopAsarStillSealed()` 为假时直接 return），
 * 所以 decideHealAction 的输入一定是「已经确认在密封态」的。
 * 留一个永远不会被返回的枚举值，只会让后来读代码的人以为漏了分支。
 */

/**
 * 补丁痕迹。
 *
 * 用宽匹配 `dsh-purge` 而不是 `[dsh-purge]`：真机抽查发现 main.js 里有 9 处
 * `dsh-purge` 但只有 2 处是带方括号的注释——补丁的写法不统一，用窄的会漏判，
 * 而漏判的后果是把一份「其实打过补丁」的树当成空的，进而拒绝换包。
 *
 * 误报方向是可接受的：这份树里出现 `dsh-purge` 字样，本身就说明它被本插件动过。
 * 真正的原件（asar 里那份）一处都没有。
 */
const PATCH_MARK = /dsh-purge/;
const PATCH_MARK_G = /dsh-purge/g;

function safeExists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

function safeIsFile(p) {
  try { return fs.statSync(p).isFile(); } catch { return false; }
}

/**
 * 数一份宿主树里有几处补丁痕迹。
 * rv 0   = 干净原件（没打过补丁）
 * rv >0  = 打过补丁
 * rv -1  = 读不到（文件不存在 / 权限）
 */
export function countPatchMarks(treeDir) {
  const probe = path.join(treeDir, "lib", "main.js");
  let text;
  try { text = fs.readFileSync(probe, "utf8"); } catch { return -1; }
  const hits = text.match(PATCH_MARK_G);
  return hits ? hits.length : 0;
}

function hasPatchMark(treeDir) {
  const probe = path.join(treeDir, "lib", "main.js");
  try { return PATCH_MARK.test(fs.readFileSync(probe, "utf8")); } catch { return false; }
}

/**
 * 纯函数判定：给定目录快照，返回该做什么。
 * 抽出来是为了能单测——这里任何一个分支判错，后果都是「补丁静默失效」。
 *
 * @param {{asar:boolean, asarUnpacked:boolean, bak:boolean, tree:boolean, treeMarked:boolean}} s
 */
export function decideHealAction(s) {
  if (!s || s.tree !== true) return HEAL_ACTIONS.BROKEN_NO_TREE;
  if (s.asar === true) {
    // asar 在 = 宿主会读它。补丁树没打过补丁时不能换包，否则换成一份空目录。
    if (s.treeMarked !== true) return HEAL_ACTIONS.NEEDS_APPLY_FIRST;
    return HEAL_ACTIONS.NEEDS_REAPPLY;
  }
  // asar 不在 = 已在目录形态。此时 bak 若还躺在 resources 里就是定时炸弹。
  if (s.bak === true) return HEAL_ACTIONS.NEEDS_UNBURY_BAK;
  if (s.treeMarked !== true) return HEAL_ACTIONS.NEEDS_APPLY_FIRST;
  return HEAL_ACTIONS.HEALTHY;
}

/** 从 exe 推出 resources / app.asar / app 树 / bak 的位置。 */
export function locateInstall(exe) {
  if (!exe) return null;
  const installDir = path.dirname(path.normalize(exe));
  const resources = path.join(installDir, "resources");
  const asar = path.join(resources, "app.asar");
  return {
    exe,
    installDir,
    resources,
    asar,
    bak: `${asar}.bak`,
    unpacked: `${asar}.unpacked`,
    tree: path.join(resources, "app"),
  };
}

/** 实地快照。读不到的项一律 false（宁可漏判也不误判成「可以换包」）。 */
export function probeInstall(loc) {
  if (!loc) return null;
  return {
    asar: safeIsFile(loc.asar),
    asarUnpacked: safeExists(loc.unpacked),
    bak: safeIsFile(loc.bak),
    tree: safeExists(loc.tree),
    treeMarked: hasPatchMark(loc.tree),
    marks: countPatchMarks(loc.tree),
  };
}

/**
 * 把 bak 挪出 resources。
 *
 * 为什么不直接删：bak 是**上一份官方原件**，是用户唯一的本地回退。
 * 挪到 `~/.dsh/dsh-purge/asar-archive/` 下，官方升级清不到那里。
 */
export function unburyBak(loc, archiveDir) {
  if (!loc || !archiveDir) return { moved: false, reason: "no-loc" };
  if (!safeIsFile(loc.bak)) return { moved: false, reason: "no-bak" };
  // 毫秒级时间戳 + 唯一后缀：同一秒内连跑两次不会互相覆盖。
  // （1.2.1 初版用秒级 slice(0,19)，Windows 的 rename 会静默覆盖同名目标。）
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 23);
  let target = path.join(archiveDir, `app.asar.${stamp}.bak`);
  let n = 1;
  while (safeIsFile(target)) {
    target = path.join(archiveDir, `app.asar.${stamp}-${n}.bak`);
    n += 1;
    if (n > 100) break;
  }
  try {
    fs.mkdirSync(archiveDir, { recursive: true });
    try {
      fs.renameSync(loc.bak, target);
    } catch (error) {
      // EXDEV：安装目录和 ~/.dsh 不在同一个卷上。改名跨不了盘，退化成复制 + 删源。
      // DSH 允许装到任意盘符，这条路径在真实用户机上会被走到。
      if (error && error.code === "EXDEV") {
        fs.copyFileSync(loc.bak, target);
        fs.rmSync(loc.bak, { force: true });
      } else {
        throw error;
      }
    }
    return { moved: true, target };
  } catch (error) {
    return { moved: false, reason: String(error && error.message ? error.message : error) };
  }
}
