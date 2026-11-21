import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// 1.5 换包计次（F01）。全部在临时 DSH_HOME 里跑，不碰真宿主、不杀任何进程。
//
// 判据：同一份 asar 连试 HEAL_SWAP_ATTEMPT_LIMIT 次之后，decideHealAction 必须不再
// 返回 NEEDS_REAPPLY（那意味着"再杀一次 Electron"），而是 NEEDS_MANUAL_APPLY。

const root = fs.mkdtempSync(path.join(os.tmpdir(), "purge-heal-attempts-"));
process.env.DSH_HOME = path.join(root, "home");
fs.mkdirSync(process.env.DSH_HOME, { recursive: true });

const {
  HEAL_ACTIONS,
  HEAL_SWAP_ATTEMPT_LIMIT,
  decideHealAction,
  healAttemptsFor,
  asarSwapRecordPath,
  readHealAttempts,
  recordHealAttempt,
  recordHealFailure,
  clearHealAttempts,
  renamePendingReason,
  tryRenameAsarAside,
  locateInstall,
  probeInstall,
} = await import("../lib/sealed-heal.js");

test.after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const IDENTITY = { size: 1234, mtimeMs: 1700000000000 };
const SEALED = {
  asar: true, asarUnpacked: false, bak: false, tree: true, treeMarked: true,
  marks: 9, asarIdentity: IDENTITY, renamePending: false,
};

const historyAt = (attempts, identity = IDENTITY, lastError = "") =>
  ({ attempts, asar: identity, lastError, at: "2026-11-22T00:00:00.000Z" });

// ---- 纯函数：计数与阈值 ----

test("阈值是 3（写死在这个数上：再低会误判一次瞬时占用，再高就是让用户多点几次）", () => {
  assert.equal(HEAL_SWAP_ATTEMPT_LIMIT, 3);
});

test("没有台账时行为不变：密封态仍然是「重打并换包」", () => {
  assert.equal(decideHealAction(SEALED), HEAL_ACTIONS.NEEDS_REAPPLY);
  assert.equal(decideHealAction(SEALED, null), HEAL_ACTIONS.NEEDS_REAPPLY);
});

test("同一份 asar 第 1、2 次失败后仍允许再试", () => {
  assert.equal(decideHealAction(SEALED, historyAt(1)), HEAL_ACTIONS.NEEDS_REAPPLY);
  assert.equal(decideHealAction(SEALED, historyAt(2)), HEAL_ACTIONS.NEEDS_REAPPLY);
});

test("同一份 asar 试满 3 次 → 停手，改判 NEEDS_MANUAL_APPLY（不再杀 Electron）", () => {
  assert.equal(decideHealAction(SEALED, historyAt(3)), HEAL_ACTIONS.NEEDS_MANUAL_APPLY);
  assert.equal(decideHealAction(SEALED, historyAt(9)), HEAL_ACTIONS.NEEDS_MANUAL_APPLY);
});

test("asar 身份变了（官方换了新包）→ 计数归零，重新允许自愈", () => {
  const newer = { ...SEALED, asarIdentity: { size: 9999, mtimeMs: 1700000099999 } };
  assert.equal(decideHealAction(newer, historyAt(5)), HEAL_ACTIONS.NEEDS_REAPPLY);
  // 只差 mtime（同 size）也必须算「换过包」：官方同版本重装就是这种形态。
  const sameSize = { ...SEALED, asarIdentity: { size: IDENTITY.size, mtimeMs: IDENTITY.mtimeMs + 1 } };
  assert.equal(decideHealAction(sameSize, historyAt(5)), HEAL_ACTIONS.NEEDS_REAPPLY);
});

test("身份无从比较时按「没有历史」处理（宁可多试一次，不要静默放弃自愈）", () => {
  assert.equal(healAttemptsFor(SEALED, historyAt(9, null)), 0);
  assert.equal(healAttemptsFor({ ...SEALED, asarIdentity: null }, historyAt(9)), 0);
  assert.equal(decideHealAction({ ...SEALED, asarIdentity: null }, historyAt(9)), HEAL_ACTIONS.NEEDS_REAPPLY);
});

test("计数写坏了（NaN / 负数）不该把自愈锁死", () => {
  assert.equal(healAttemptsFor(SEALED, { attempts: "oops", asar: IDENTITY }), 0);
  assert.equal(healAttemptsFor(SEALED, { attempts: -3, asar: IDENTITY }), 0);
});

test("rename-pending 在 → 先试改名，不杀进程", () => {
  const pending = { ...SEALED, renamePending: true };
  assert.equal(decideHealAction(pending, null), HEAL_ACTIONS.NEEDS_ASAR_RENAME);
  // 已经停手时优先「停手」：什么都不碰。
  assert.equal(decideHealAction(pending, historyAt(3)), HEAL_ACTIONS.NEEDS_MANUAL_APPLY);
});

test("其它分支不受台账影响（没有树 / 有 bak / 树没补丁）", () => {
  assert.equal(decideHealAction({ asar: true, tree: false }, historyAt(9)), HEAL_ACTIONS.BROKEN_NO_TREE);
  assert.equal(decideHealAction({ asar: false, bak: true, tree: true, treeMarked: true }, historyAt(9)), HEAL_ACTIONS.NEEDS_UNBURY_BAK);
  assert.equal(decideHealAction({ asar: false, bak: false, tree: true, treeMarked: false }, historyAt(9)), HEAL_ACTIONS.NEEDS_APPLY_FIRST);
});

// ---- 落盘台账 ----

test("台账写在 <DSH_HOME>/dsh-purge/asar-swap.json", () => {
  assert.equal(asarSwapRecordPath(), path.join(process.env.DSH_HOME, "dsh-purge", "asar-swap.json"));
});

test("记两次尝试：文件里 attempts 递增，且带上 asar 身份", () => {
  clearHealAttempts();
  const a = recordHealAttempt(SEALED);
  assert.equal(a.attempts, 1);
  const b = recordHealAttempt(SEALED);
  assert.equal(b.attempts, 2);

  const rec = readHealAttempts();
  assert.equal(rec.attempts, 2);
  assert.deepEqual(rec.asar, IDENTITY);
  assert.match(rec.at, /^20\d\d-/);
  clearHealAttempts();
});

test("换了一份 asar 再记：次数从 1 重新开始（不继承上一份包的失败）", () => {
  clearHealAttempts();
  recordHealAttempt(SEALED);
  recordHealAttempt(SEALED);
  const newer = { ...SEALED, asarIdentity: { size: 4321, mtimeMs: 1700000055555 } };
  const rec = recordHealAttempt(newer);
  assert.equal(rec.attempts, 1);
  assert.deepEqual(readHealAttempts().asar, newer.asarIdentity);
  clearHealAttempts();
});

test("记失败：次数不变，lastError 落盘（这就是「为什么」）", () => {
  clearHealAttempts();
  recordHealAttempt(SEALED);
  const rec = recordHealFailure(SEALED, "Move-Item app.asar -> app.asar.bak failed after 80 attempts");
  assert.equal(rec.attempts, 1);
  assert.match(readHealAttempts().lastError, /80 attempts/);
  clearHealAttempts();
});

test("clearHealAttempts 之后文件不在了，读回来是 null", () => {
  recordHealAttempt(SEALED);
  assert.equal(clearHealAttempts(), true);
  assert.equal(fs.existsSync(asarSwapRecordPath()), false);
  assert.equal(readHealAttempts(), null);
});

test("读得懂 PowerShell 5.1 的带 BOM JSON（双写方唯一必须互相迁就的地方）", () => {
  clearHealAttempts();
  fs.mkdirSync(path.dirname(asarSwapRecordPath()), { recursive: true });
  const body = JSON.stringify({ attempts: 2, lastError: "ps1", at: "2026-11-22T00:00:00.000Z", source: "asar-swap-ps1", asar: IDENTITY });
  fs.writeFileSync(asarSwapRecordPath(), "\uFEFF" + body, "utf8");
  const rec = readHealAttempts();
  assert.equal(rec.attempts, 2);
  assert.equal(rec.lastError, "ps1");
  assert.equal(healAttemptsFor(SEALED, rec), 2);
  clearHealAttempts();
});

test("JSON 写坏了按「没有历史」处理，不抛错、不自锁", () => {
  clearHealAttempts();
  fs.mkdirSync(path.dirname(asarSwapRecordPath()), { recursive: true });
  fs.writeFileSync(asarSwapRecordPath(), "{ not json", "utf8");
  assert.equal(readHealAttempts(), null);
  assert.equal(decideHealAction(SEALED, readHealAttempts()), HEAL_ACTIONS.NEEDS_REAPPLY);
  clearHealAttempts();
});

// ---- .rename-pending 读取与「只试改名」 ----

test("renamePendingReason 读得出上次失败的原因（1.5 起标记里第二行就是原因）", () => {
  const work = fs.mkdtempSync(path.join(root, "pending-"));
  fs.mkdirSync(path.join(work, "resources"), { recursive: true });
  const loc = locateInstall(path.join(work, "DeepSeek Harness.exe"));
  fs.writeFileSync(loc.asar, "asar-bytes");
  assert.equal(renamePendingReason(loc), "");

  fs.writeFileSync(`${loc.asar}.rename-pending`, "2026-11-22T00:00:00.000Z\nMove-Item failed: file locked\n", "utf8");
  assert.match(renamePendingReason(loc), /file locked/);
});

test("tryRenameAsarAside：asar 在、bak 不在 → 真的挪开（不需要杀进程）", () => {
  const work = fs.mkdtempSync(path.join(root, "rename-"));
  fs.mkdirSync(path.join(work, "resources"), { recursive: true });
  const loc = locateInstall(path.join(work, "DeepSeek Harness.exe"));
  fs.writeFileSync(loc.asar, "asar-bytes");

  const r = tryRenameAsarAside(loc);
  assert.equal(r.renamed, true);
  assert.equal(fs.existsSync(loc.asar), false);
  assert.equal(fs.readFileSync(loc.bak, "utf8"), "asar-bytes");
});

test("tryRenameAsarAside：bak 还在时不动手（那是上一份官方原件）", () => {
  const work = fs.mkdtempSync(path.join(root, "rename-bak-"));
  fs.mkdirSync(path.join(work, "resources"), { recursive: true });
  const loc = locateInstall(path.join(work, "DeepSeek Harness.exe"));
  fs.writeFileSync(loc.asar, "asar-bytes");
  fs.writeFileSync(loc.bak, "original-bytes");

  const r = tryRenameAsarAside(loc);
  assert.equal(r.renamed, false);
  assert.equal(r.error, "bak-exists");
  assert.equal(fs.readFileSync(loc.bak, "utf8"), "original-bytes", "不许删/覆盖唯一的原件");
  assert.equal(fs.readFileSync(loc.asar, "utf8"), "asar-bytes");
});

test("tryRenameAsarAside：asar 已经不在 → no-asar（不是失败，是已经换过了）", () => {
  const work = fs.mkdtempSync(path.join(root, "rename-gone-"));
  fs.mkdirSync(path.join(work, "resources"), { recursive: true });
  const loc = locateInstall(path.join(work, "DeepSeek Harness.exe"));
  assert.equal(tryRenameAsarAside(loc).error, "no-asar");
});

test("probeInstall 带上 identity 与 renamePending（判定要用的两个新输入）", () => {
  const work = fs.mkdtempSync(path.join(root, "probe-"));
  fs.mkdirSync(path.join(work, "resources", "app", "lib"), { recursive: true });
  const loc = locateInstall(path.join(work, "DeepSeek Harness.exe"));
  fs.writeFileSync(loc.asar, "asar-bytes");
  fs.writeFileSync(path.join(loc.tree, "lib", "main.js"), "// dsh-purge\n");

  const snap = { ...probeInstall(loc) };
  assert.equal(snap.asar, true);
  assert.equal(snap.asarIdentity.size, "asar-bytes".length);
  assert.ok(snap.asarIdentity.mtimeMs > 0);
  assert.equal(snap.renamePending, false);

  fs.writeFileSync(`${loc.asar}.rename-pending`, "2026-11-22T00:00:00.000Z\n", "utf8");
  assert.equal(probeInstall(loc).renamePending, true);
  assert.equal(decideHealAction(probeInstall(loc), null), HEAL_ACTIONS.NEEDS_ASAR_RENAME);
});

// ---- PS1 文本级断言：防「只改一处」 ----

function swapPs1Text() {
  const src = fs.readFileSync(new URL("../lib/desktop.js", import.meta.url), "utf8");
  const at = src.indexOf("const ASAR_SWAP_PS1 = [");
  assert.ok(at > 0, "desktop.js 里找不到 ASAR_SWAP_PS1");
  const end = src.indexOf("].join(", at);
  const body = src.slice(at + "const ASAR_SWAP_PS1 = ".length, end + 1);
  return new Function("return " + body + ".join(String.fromCharCode(13,10))")();
}

test("ASAR_SWAP_PS1 的失败分支：必须既重开 DSH，又把原因写下来", () => {
  const ps1 = swapPs1Text();
  const failAt = ps1.indexOf("} else {");
  assert.ok(failAt > 0, "找不到失败分支");
  const failBranch = ps1.slice(failAt);

  assert.match(failBranch, /Start-Process -FilePath \$ExePath/, "改名失败也要把 DSH 拉起来");
  assert.match(failBranch, /Set-Content -LiteralPath \$lock/, "失败要留标记（$lock 就是 .rename-pending）");
  assert.match(failBranch, /\$reason/, "失败原因要先拼出来");
  assert.match(failBranch, /lastError/, "失败原因要进台账");
  assert.match(failBranch, /attempts/, "台账要沿用已落的次数");

  // 参数存在且是可选（缺省空串）：不能因为调用方没传就 Mandatory 报错。
  assert.match(ps1, /\[string\]\$FailLogPath = ''/);
  // $lock 的取值必须还是 <asar>.rename-pending —— index.js 的 heal 分支读的就是它。
  assert.match(ps1, /\$lock = \$AsarPath \+ '\.rename-pending'/);
  // 成功分支仍然重开一次，且清掉标记。
  assert.match(ps1.slice(0, failAt), /Start-Process -FilePath \$ExePath/);
  assert.match(ps1.slice(0, failAt), /Remove-Item -LiteralPath \$lock/);
});

test("scheduleAsarSwapRestart 会把 -FailLogPath 传给 PowerShell", () => {
  const src = fs.readFileSync(new URL("../lib/desktop.js", import.meta.url), "utf8");
  assert.match(src, /"-FailLogPath", asarSwapRecordPath\(\)/, "PowerShell 分支必须传台账路径");
});
