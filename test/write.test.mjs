import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { atomicWriteFile, atomicWriteSync } = await import("../lib/core.js");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "dshpurge-write-"));

test.after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function busy(code) {
  const e = new Error("simulated " + code);
  e.code = code;
  return e;
}

/** 让前 failures 次 renameSync 抛 code，之后走真实现。返回尝试计数器与还原函数。 */
function breakRenameSync(failures, code = "EPERM") {
  const orig = fs.renameSync;
  let attempts = 0;
  fs.renameSync = function (from, to, ...rest) {
    attempts += 1;
    if (attempts <= failures) throw busy(code);
    return orig.call(fs, from, to, ...rest);
  };
  return { attempts: () => attempts, restore: () => { fs.renameSync = orig; } };
}

function breakRenameAsync(failures, code = "EBUSY") {
  const orig = fs.promises.rename;
  let attempts = 0;
  fs.promises.rename = async function (from, to, ...rest) {
    attempts += 1;
    if (attempts <= failures) throw busy(code);
    return orig.call(fs.promises, from, to, ...rest);
  };
  return { attempts: () => attempts, restore: () => { fs.promises.rename = orig; } };
}

const leftovers = (dir) => fs.readdirSync(dir).filter((n) => n.endsWith(".tmp") || n.endsWith(".copytmp"));

test("rename 撞上 EPERM：退避重试后写入成功，不留临时文件", () => {
  const fp = path.join(root, "a.txt");
  const rig = breakRenameSync(2);
  try {
    atomicWriteSync(fp, "hello", "utf8");
  } finally {
    rig.restore();
  }
  assert.equal(rig.attempts(), 3, "应该重试到第 3 次才成功");
  assert.equal(fs.readFileSync(fp, "utf8"), "hello");
  assert.deepEqual(leftovers(root), []);
});

test("rename 一直 EPERM：重试 4 次后抛可读错误，并清掉临时文件", () => {
  const fp = path.join(root, "b.txt");
  const rig = breakRenameSync(99);
  let err = null;
  try {
    atomicWriteSync(fp, "x", "utf8");
  } catch (e) {
    err = e;
  } finally {
    rig.restore();
  }
  assert.ok(err, "应当抛错");
  assert.equal(rig.attempts(), 4);
  assert.equal(err.code, "EPERM");
  assert.ok(err.message.includes(fp), "错误里没有路径：" + err.message);
  assert.match(err.message, /退出 DeepSeek Harness 后重试/);
  assert.equal(fs.existsSync(fp), false);
  assert.deepEqual(leftovers(root), []);
});

test("不可重试的 errno 立刻抛出，不做无谓等待", () => {
  const fp = path.join(root, "c.txt");
  const rig = breakRenameSync(99, "ENOSPC");
  let err = null;
  const t0 = Date.now();
  try {
    atomicWriteSync(fp, "x", "utf8");
  } catch (e) {
    err = e;
  } finally {
    rig.restore();
  }
  assert.ok(err);
  assert.equal(rig.attempts(), 1);
  assert.equal(err.code, "ENOSPC");
  assert.ok(Date.now() - t0 < 200, "ENOSPC 不该走退避");
  assert.deepEqual(leftovers(root), []);
});

test("原子写（异步）：一次 EBUSY 后成功，不留临时文件", async () => {
  const fp = path.join(root, "d.txt");
  const rig = breakRenameAsync(1);
  try {
    await atomicWriteFile(fp, "async-ok", "utf8");
  } finally {
    rig.restore();
  }
  assert.equal(rig.attempts(), 2);
  assert.equal(fs.readFileSync(fp, "utf8"), "async-ok");
  assert.deepEqual(leftovers(root), []);
});

test("原子写（异步）：一直 EACCES 时 reject 并清掉临时文件", async () => {
  const fp = path.join(root, "e.txt");
  const rig = breakRenameAsync(99, "EACCES");
  let err = null;
  try {
    await atomicWriteFile(fp, "y", "utf8");
  } catch (e) {
    err = e;
  } finally {
    rig.restore();
  }
  assert.ok(err, "应当 reject");
  assert.equal(rig.attempts(), 4);
  assert.equal(err.code, "EACCES");
  assert.match(err.message, /文件占用|file busy/);
  assert.equal(fs.existsSync(fp), false);
  assert.deepEqual(leftovers(root), []);
});
