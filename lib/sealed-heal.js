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
import { atomicWriteSync } from "./atomic-io.js";


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
  /**
   * 同一份 asar 已经换过 HEAL_SWAP_ATTEMPT_LIMIT 次都没成功：停手，等用户点「应用」。
   * 再杀一次 Electron 不会得到不同结果，只会重复「重启一次被杀一次」。
   */
  NEEDS_MANUAL_APPLY: "needs-manual-apply",
  /**
   * 上次换包的改名失败了（<asar>.rename-pending 在）。先只试一次改名，成功就不必杀进程。
   */
  NEEDS_ASAR_RENAME: "needs-asar-rename",
});

/**
 * 同一份 asar 最多自动换几次包。3 是「够试错、又不至于把用户困在重启循环里」的折中：
 * 单次失败通常是宿主占用（等一等就好），连续三次就是权限 / 杀软 / 跨盘这类结构性问题。
 */
export const HEAL_SWAP_ATTEMPT_LIMIT = 3;

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
 * 同一份 asar 已经记了几次换包尝试。
 *
 * 计数只在「同一个身份」下延续：asar 的 size + mtime 一变，说明官方真的换了新包，
 * 那份计数跟新包无关，必须归零——否则真升级后会退化成「再也不自动换包」。
 * 所以身份缺失 / 对不上时一律按 0 处理（宁可多试一次，也不要静默放弃自愈）。
 *
 * @param {{asarIdentity?:{size:number,mtimeMs:number}|null}} s 探针快照
 * @param {{attempts?:number, asar?:{size:number,mtimeMs:number}|null}|null} history 落盘记录
 */
export function healAttemptsFor(s, history) {
  const rec = history || null;
  const attempts = Number(rec?.attempts);
  if (!rec || !Number.isFinite(attempts) || attempts <= 0) return 0;
  const recorded = rec.asar || null;
  const current = s?.asarIdentity || null;
  if (!recorded || !current) return 0;
  if (Number(recorded.size) !== Number(current.size)) return 0;
  if (Math.round(Number(recorded.mtimeMs)) !== Math.round(Number(current.mtimeMs))) return 0;
  return Math.floor(attempts);
}

/**
 * 纯函数判定：给定目录快照（+ 可选的换包台账），返回该做什么。
 * 抽出来是为了能单测——这里任何一个分支判错，后果都是「补丁静默失效」。
 *
 * @param {{asar:boolean, asarUnpacked:boolean, bak:boolean, tree:boolean, treeMarked:boolean,
 *          asarIdentity?:{size:number,mtimeMs:number}|null, renamePending?:boolean}} s
 * @param {{attempts:number, lastError?:string, at?:string, asar?:{size:number,mtimeMs:number}|null}|null} history
 */
export function decideHealAction(s, history = null) {
  if (!s || s.tree !== true) return HEAL_ACTIONS.BROKEN_NO_TREE;
  if (s.asar === true) {
    // asar 在 = 宿主会读它。补丁树没打过补丁时不能换包，否则换成一份空目录。
    if (s.treeMarked !== true) return HEAL_ACTIONS.NEEDS_APPLY_FIRST;
    // 试满阈值就停手：再杀一次 Electron 只会重复「重启一次被杀一次」。
    // 顺序上必须先于 rename-pending——停手就该什么都不碰。
    if (healAttemptsFor(s, history) >= HEAL_SWAP_ATTEMPT_LIMIT) return HEAL_ACTIONS.NEEDS_MANUAL_APPLY;
    // 上次改名失败留下的标记：先只试改名，成功就不用杀进程；失败也不杀（见 index.js）。
    if (s.renamePending === true) return HEAL_ACTIONS.NEEDS_ASAR_RENAME;
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

function safeStat(p) {
  try { return fs.statSync(p); } catch { return null; }
}

/**
 * 实地快照。读不到的项一律 false（宁可漏判也不误判成「可以换包」）。
 *
 * asarIdentity / renamePending 是 1.5 加的：
 *   - identity（size + mtimeMs）用来判断「这几次失败是不是同一份包」，计数靠它清零；
 *   - renamePending 读的是上次改名失败留下的标记，存在就说明杀进程也改不动。
 */
export function probeInstall(loc) {
  if (!loc) return null;
  const asarStat = safeStat(loc.asar);
  const isFile = Boolean(asarStat && asarStat.isFile());
  return {
    asar: isFile,
    asarUnpacked: safeExists(loc.unpacked),
    bak: safeIsFile(loc.bak),
    tree: safeExists(loc.tree),
    treeMarked: hasPatchMark(loc.tree),
    marks: countPatchMarks(loc.tree),
    asarIdentity: isFile ? { size: asarStat.size, mtimeMs: asarStat.mtimeMs } : null,
    renamePending: safeIsFile(`${loc.asar}.rename-pending`),
  };
}

/**
 * 换包台账：<DSH_HOME>/dsh-purge/asar-swap.json
 *
 * 为什么必须落盘：heal 唯一的进程内护栏是模块级布尔（index.js 的 healSwapScheduled），
 * 宿主一重启就复位。而换包这条路要么把宿主杀掉、要么改名失败，两者都让进程内的
 * 计次失效 —— 于是「用户手动重启一次、被杀一次」次数无上限。写进文件才是证据。
 */
export function asarSwapRecordPath() {
  const base = upgradeMarkerDir();
  if (!base) return "";
  return path.join(base, "asar-swap.json");
}

/**
 * 读台账。读不到 / 写坏了都返回 null（按「没有历史」处理）：
 * 这里宁可多试一次，也不要因为一份坏 JSON 就永久放弃自愈。
 * PowerShell 5.1 的 `Set-Content -Encoding utf8` 会带 BOM，JSON.parse 直接被 BOM 顶死，
 * 所以这里先削掉 BOM —— 这是双写方（Node / PS1）里唯一必须互相迁就的一处。
 */
export function readHealAttempts() {
  const fp = asarSwapRecordPath();
  if (!fp) return null;
  try {
    const raw = fs.readFileSync(fp, "utf8").replace(/^\uFEFF/, "");
    const rec = JSON.parse(raw);
    const identity = rec?.asar;
    return {
      attempts: Number(rec?.attempts) || 0,
      lastError: String(rec?.lastError || ""),
      at: String(rec?.at || ""),
      asar: identity && Number.isFinite(Number(identity.size))
        ? { size: Number(identity.size), mtimeMs: Number(identity.mtimeMs) || 0 }
        : null,
    };
  } catch {
    return null;
  }
}

function writeHealAttempts(rec) {
  const fp = asarSwapRecordPath();
  if (!fp) return null;
  atomicWriteSync(fp, `${JSON.stringify(rec, null, 2)}\n`, "utf8");
  return fp;
}

/**
 * 记一次「要换包了」。必须在真正排换包**之前**写盘：
 * 换包一旦开始，本进程马上会被 PowerShell 杀掉，进程内的动作都留不下来。
 */
export function recordHealAttempt(s, { lastError = "", source = "heal" } = {}) {
  const prev = readHealAttempts();
  const attempts = healAttemptsFor(s, prev) + 1;
  const rec = {
    attempts,
    lastError: String(lastError || (attempts > 1 ? prev?.lastError || "" : "")),
    at: new Date().toISOString(),
    source,
    asar: s?.asarIdentity ? { size: s.asarIdentity.size, mtimeMs: s.asarIdentity.mtimeMs } : null,
  };
  try {
    writeHealAttempts(rec);
  } catch {
    /* 台账写不上不该挡换包本身：退化成「只有进程内护栏」，与 1.4.4 行为一致 */
  }
  return rec;
}

/** 记一次失败原因（次数沿用已落盘的值）。换包没发生时用它把「为什么」留下来。 */
export function recordHealFailure(s, reason, { source = "heal" } = {}) {
  const prev = readHealAttempts();
  const attempts = Math.max(healAttemptsFor(s, prev), Number(prev?.attempts) || 0);
  const rec = {
    attempts,
    lastError: String(reason || ""),
    at: new Date().toISOString(),
    source,
    asar: prev?.asar || (s?.asarIdentity ? { size: s.asarIdentity.size, mtimeMs: s.asarIdentity.mtimeMs } : null),
  };
  try {
    writeHealAttempts(rec);
  } catch {
    /* ignore */
  }
  return rec;
}

/** 换包真的发生了 / 改名成功了：台账清零。身份对不上本来也会归零，但显式清更干净。 */
export function clearHealAttempts() {
  const fp = asarSwapRecordPath();
  if (!fp) return false;
  try {
    fs.rmSync(fp, { force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * 读 `.rename-pending` 的内容。
 * 1.5 起这个文件不再只是一个时间戳：PS1 失败分支会把**原因**写在第二行，
 * 这样下次启动能说清「上次为什么没换成功」，而不是只看到「有过一次失败」。
 */
export function renamePendingReason(loc) {
  if (!loc) return "";
  try {
    return fs.readFileSync(`${loc.asar}.rename-pending`, "utf8").trim();
  } catch {
    return "";
  }
}

/**
 * 只试改名，不杀进程。
 *
 * 用在哪：<asar>.rename-pending 在的时候。上次改名失败通常意味着文件被占用，
 * 但「占用」是瞬时状态——再试一次可能就成了，成了就不必杀掉用户正在用的应用。
 *
 * 不做「先删旧 bak」：resources 里的 bak 是上一份官方原件，为了一次尝试就删掉它
 * 是拿唯一退路赌运气。bak 还在时直接报错，交给用户。
 */
export function tryRenameAsarAside(loc) {
  if (!loc) return { renamed: false, error: "no-loc" };
  if (!safeIsFile(loc.asar)) return { renamed: false, error: "no-asar" };
  if (safeIsFile(loc.bak)) return { renamed: false, error: "bak-exists" };
  try {
    fs.renameSync(loc.asar, loc.bak);
    return { renamed: true };
  } catch (e) {
    return { renamed: false, error: String(e && e.message ? e.message : e) };
  }
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
