import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

import {
  HEAL_ACTIONS,
  decideHealAction,
  locateInstall,
  probeInstall,
  countPatchMarks,
  unburyBak,
} from "../lib/sealed-heal.js";

// ---- decideHealAction：纯函数，分支错一个就是「补丁静默失效」 ----

test("asar 在 + 树有补丁 => 重打并换包", () => {
  const r = decideHealAction({ asar: true, bak: false, tree: true, treeMarked: true });
  assert.equal(r, HEAL_ACTIONS.NEEDS_REAPPLY);
});

test("asar 在 + 树没补丁 => 先点应用，绝不换包", () => {
  // 换包会把宿主切到一份没打补丁的目录，比现状更糟：现状至少还能点应用补回来。
  const r = decideHealAction({ asar: true, bak: false, tree: true, treeMarked: false });
  assert.equal(r, HEAL_ACTIONS.NEEDS_APPLY_FIRST);
});

test("asar 不在 + bak 在 => 先挪 bak", () => {
  const r = decideHealAction({ asar: false, bak: true, tree: true, treeMarked: true });
  assert.equal(r, HEAL_ACTIONS.NEEDS_UNBURY_BAK);
});

test("asar 不在 + bak 不在 + 有补丁 => 健康", () => {
  const r = decideHealAction({ asar: false, bak: false, tree: true, treeMarked: true });
  assert.equal(r, HEAL_ACTIONS.HEALTHY);
});

test("树不存在 => 不可自愈", () => {
  const r = decideHealAction({ asar: true, bak: false, tree: false, treeMarked: false });
  assert.equal(r, HEAL_ACTIONS.BROKEN_NO_TREE);
});

test("asar 不在 + 树在但没补丁 => 先点应用", () => {
  const r = decideHealAction({ asar: false, bak: false, tree: true, treeMarked: false });
  assert.equal(r, HEAL_ACTIONS.NEEDS_APPLY_FIRST);
});

test("bak 优先于树未标记：先保住退路再谈补丁", () => {
  const r = decideHealAction({ asar: false, bak: true, tree: true, treeMarked: false });
  assert.equal(r, HEAL_ACTIONS.NEEDS_UNBURY_BAK);
});

// ---- locateInstall ----

test("locateInstall 从 exe 推出四个关键路径", () => {
  // 路径必须用 path.join 构造，不能硬编码反斜杠：
  // Linux 上 path.dirname("C:\\Soft\\x.exe") 返回 "."（只认 /），
  // 硬编码反斜杠的断言在 CI 上必红、在 Windows 上却恒绿。
  // 这条就是 1.2.1 第一次跑 CI 挂掉的原因。
  const base = path.join("C:", "Software", "DSH");
  const loc = locateInstall(path.join(base, "DeepSeek Harness.exe"));
  assert.equal(loc.installDir, base);
  assert.equal(loc.resources, path.join(base, "resources"));
  assert.equal(loc.asar, path.join(base, "resources", "app.asar"));
  assert.equal(loc.bak, loc.asar + ".bak");
  assert.equal(loc.tree, path.join(base, "resources", "app"));
});

test("locateInstall(null) 返回 null", () => {
  assert.equal(locateInstall(null), null);
  assert.equal(locateInstall(""), null);
});

// ---- 真文件系统上的 probe / countPatchMarks ----

test("countPatchMarks 数得准，读不到返回 -1", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "heal-test-"));
  fs.mkdirSync(path.join(dir, "lib"), { recursive: true });
  fs.writeFileSync(path.join(dir, "lib", "main.js"), "// dsh-purge a\n// dsh-purge b\n");
  assert.equal(countPatchMarks(dir), 2);

  const clean = fs.mkdtempSync(path.join(os.tmpdir(), "heal-clean-"));
  fs.mkdirSync(path.join(clean, "lib"), { recursive: true });
  fs.writeFileSync(path.join(clean, "lib", "main.js"), "// nothing here\n");
  assert.equal(countPatchMarks(clean), 0);

  assert.equal(countPatchMarks(path.join(dir, "does-not-exist")), -1);

  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(clean, { recursive: true, force: true });
});

test("probeInstall 对不存在的路径全部报 false，不会误判成可换包", () => {
  const loc = locateInstall(path.join("C:", "__nonexistent__", "DeepSeek Harness.exe"));
  const s = probeInstall(loc);
  assert.equal(s.asar, false);
  assert.equal(s.tree, false);
  assert.equal(s.treeMarked, false);
  assert.equal(decideHealAction(s), HEAL_ACTIONS.BROKEN_NO_TREE);
});

test("unburyBak 把 bak 挪进归档目录并保留时间戳名", () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "heal-bak-"));
  const res = path.join(work, "resources");
  fs.mkdirSync(res, { recursive: true });
  const asar = path.join(res, "app.asar");
  const bak = asar + ".bak";
  fs.writeFileSync(bak, "original-bytes");

  const loc = locateInstall(path.join(work, "DeepSeek Harness.exe"));
  const archive = path.join(work, "archive");
  const r = unburyBak(loc, archive);

  assert.equal(r.moved, true);
  assert.equal(fs.existsSync(bak), false, "bak 不应还留在 resources");
  assert.equal(fs.existsSync(r.target), true, "归档文件应存在");
  assert.equal(fs.readFileSync(r.target, "utf8"), "original-bytes");

  fs.rmSync(work, { recursive: true, force: true });
});

test("unburyBak 没有 bak 时如实报 no-bak", () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "heal-nobak-"));
  fs.mkdirSync(path.join(work, "resources"), { recursive: true });
  const loc = locateInstall(path.join(work, "DeepSeek Harness.exe"));
  const r = unburyBak(loc, path.join(work, "archive"));
  assert.equal(r.moved, false);
  assert.equal(r.reason, "no-bak");
  fs.rmSync(work, { recursive: true, force: true });
});
// ---- 1.2.1 审查后补：这三条是审查 A 找出来的真实缺陷，回归护栏 ----

test("unburyBak 同一秒连跑两次不会覆盖（毫秒时间戳）", () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "heal-dup-"));
  const res = path.join(work, "resources");
  fs.mkdirSync(res, { recursive: true });
  const loc = locateInstall(path.join(work, "DeepSeek Harness.exe"));
  const archive = path.join(work, "archive");

  fs.writeFileSync(loc.bak, "first");
  const r1 = unburyBak(loc, archive);
  fs.writeFileSync(loc.bak, "second");
  const r2 = unburyBak(loc, archive);

  assert.equal(r1.moved, true);
  assert.equal(r2.moved, true);
  assert.notEqual(r1.target, r2.target, "两次归档的目标文件不能相同");
  assert.equal(fs.readFileSync(r1.target, "utf8"), "first");
  assert.equal(fs.readFileSync(r2.target, "utf8"), "second");

  fs.rmSync(work, { recursive: true, force: true });
});

test("unburyBak 目标已存在时自动让开（-1 / -2 后缀）", () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "heal-clash-"));
  const res = path.join(work, "resources");
  fs.mkdirSync(res, { recursive: true });
  const loc = locateInstall(path.join(work, "DeepSeek Harness.exe"));
  const archive = path.join(work, "archive");
  fs.mkdirSync(archive, { recursive: true });

  // 冻结时间：塞一个与真实目标同前缀的文件不现实，改为连跑两次验证不覆盖
  fs.writeFileSync(loc.bak, "a");
  const r1 = unburyBak(loc, archive);
  fs.writeFileSync(loc.bak, "b");
  const r2 = unburyBak(loc, archive);
  assert.notEqual(r1.target, r2.target);
  assert.equal(fs.existsSync(r1.target), true);
  assert.equal(fs.existsSync(r2.target), true);

  fs.rmSync(work, { recursive: true, force: true });
});

test("decideHealAction：asar 不在 + bak 在（bak 埋在 resources）必须报 unbury", () => {
  // 这条是审查 A 指出的「本版白干」场景：入口门若用 desktopAsarStillSealed()
  // 短路，asar 不在时永远走不到这里，official-update.wscript 就会把 bak
  // 复制回 asar，把补丁顶掉。单独锁死这条判定。
  const r = decideHealAction({ asar: false, bak: true, tree: true, treeMarked: true });
  assert.equal(r, HEAL_ACTIONS.NEEDS_UNBURY_BAK);
});
// ---- EXDEV：安装目录与 ~/.dsh 不同盘时，rename 跨不了卷 ----

test("unburyBak 遇到 EXDEV 时退化为 copy + 删源", () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "heal-exdev-"));
  const res = path.join(work, "resources");
  fs.mkdirSync(res, { recursive: true });
  const loc = locateInstall(path.join(work, "DeepSeek Harness.exe"));
  const archive = path.join(work, "archive");
  fs.writeFileSync(loc.bak, "cross-device-bytes");

  // 在目标目录上做手脚：让第一次 renameSync 抛 EXDEV，验证退化路径
  const realRename = fs.renameSync;
  let exdevThrown = false;
  fs.renameSync = (...args) => {
    if (!exdevThrown) {
      exdevThrown = true;
      const err = new Error("EXDEV: cross-device link not permitted");
      err.code = "EXDEV";
      throw err;
    }
    return realRename(...args);
  };

  let r;
  try {
    r = unburyBak(loc, archive);
  } finally {
    fs.renameSync = realRename;
  }

  assert.equal(r.moved, true, "EXDEV 时应退化为复制而不是失败");
  assert.equal(fs.existsSync(r.target), true);
  assert.equal(fs.readFileSync(r.target, "utf8"), "cross-device-bytes");
  assert.equal(fs.existsSync(loc.bak), false, "源文件应被删掉");

  fs.rmSync(work, { recursive: true, force: true });
});

test("unburyBak 非 EXDEV 的错误如实返回失败，不吞掉", () => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "heal-err-"));
  const res = path.join(work, "resources");
  fs.mkdirSync(res, { recursive: true });
  const loc = locateInstall(path.join(work, "DeepSeek Harness.exe"));
  const archive = path.join(work, "archive");
  fs.writeFileSync(loc.bak, "x");

  const realRename = fs.renameSync;
  fs.renameSync = () => {
    const err = new Error("EACCES: permission denied");
    err.code = "EACCES";
    throw err;
  };

  let r;
  try {
    r = unburyBak(loc, archive);
  } finally {
    fs.renameSync = realRename;
  }

  assert.equal(r.moved, false);
  assert.match(String(r.reason), /EACCES/);

  fs.rmSync(work, { recursive: true, force: true });
});