import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { hostFs } from "../lib/extract-asar.js";
import { atomicCopyFile } from "../lib/atomic-io.js";

// 1.5：atomicCopyFile 的退避重试（F07）。
// Windows 上「目标被宿主占用」是真机常态：copyFile 在 try 之外 + rename 不走重试，
// 结果是写成功、复制失败、还落一地 .copytmp。

const root = fs.mkdtempSync(path.join(os.tmpdir(), "purge-atomic-copy-"));

test.after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function busy(code) {
  const e = new Error("simulated " + code);
  e.code = code;
  return e;
}

/** 让前 failures 次复制抛 code，之后走真实现。 */
function breakCopy(failures, code = "EBUSY") {
  const orig = hostFs.promises.copyFile;
  let attempts = 0;
  hostFs.promises.copyFile = async (src, dst, ...rest) => {
    attempts += 1;
    if (attempts <= failures) throw busy(code);
    return orig(src, dst, ...rest);
  };
  return { attempts: () => attempts, restore: () => { hostFs.promises.copyFile = orig; } };
}

/** 让前 failures 次 rename 抛 code，之后走真实现。 */
function breakRename(failures, code = "EPERM") {
  const orig = hostFs.promises.rename;
  let attempts = 0;
  hostFs.promises.rename = async (from, to, ...rest) => {
    attempts += 1;
    if (attempts <= failures) throw busy(code);
    return orig(from, to, ...rest);
  };
  return { attempts: () => attempts, restore: () => { hostFs.promises.rename = orig; } };
}

const leftovers = () => fs.readdirSync(root).filter((n) => n.endsWith(".copytmp") || n.endsWith(".tmp"));

function seed(name, text) {
  const fp = path.join(root, name);
  fs.writeFileSync(fp, text, "utf8");
  return fp;
}

test("复制撞上 EBUSY：退避重试后成功，字节一致，不留临时文件", async () => {
  const src = seed("src-a.txt", "original-bytes");
  const dst = path.join(root, "dst-a.txt");
  const rig = breakCopy(2);
  try {
    await atomicCopyFile(src, dst);
  } finally {
    rig.restore();
  }
  assert.equal(rig.attempts(), 3, "应该重试到第 3 次才成功");
  assert.equal(fs.readFileSync(dst, "utf8"), "original-bytes");
  assert.deepEqual(leftovers(), []);
});

test("改名撞上 EPERM（1.4.4 没走 renameWithRetry 的那一步）：重试后成功", async () => {
  const src = seed("src-b.txt", "rename-retry");
  const dst = path.join(root, "dst-b.txt");
  const rig = breakRename(2, "EPERM");
  try {
    await atomicCopyFile(src, dst);
  } finally {
    rig.restore();
  }
  assert.equal(rig.attempts(), 3);
  assert.equal(fs.readFileSync(dst, "utf8"), "rename-retry");
  assert.deepEqual(leftovers(), []);
});

test("一直 EBUSY：抛可读错误（带路径与「退出 DeepSeek Harness 后重试」），并清掉临时文件", async () => {
  const src = seed("src-c.txt", "busy");
  const dst = path.join(root, "dst-c.txt");
  const rig = breakCopy(99, "EBUSY");
  let err = null;
  try {
    await atomicCopyFile(src, dst);
  } catch (e) {
    err = e;
  } finally {
    rig.restore();
  }
  assert.ok(err, "应当抛错");
  assert.equal(err.code, "EBUSY");
  assert.match(err.message, /文件占用|file busy/);
  assert.equal(fs.existsSync(dst), false, "目标不该出现半成品");
  assert.deepEqual(leftovers(), [], "失败路径必须自己清 tmp（1.4.4 里 copyFile 在 try 之外，没人清）");
});

test("不可重试的 errno 立刻抛，不做无谓等待", async () => {
  const src = seed("src-d.txt", "nospc");
  const dst = path.join(root, "dst-d.txt");
  const rig = breakCopy(99, "ENOSPC");
  let err = null;
  const t0 = Date.now();
  try {
    await atomicCopyFile(src, dst);
  } catch (e) {
    err = e;
  } finally {
    rig.restore();
  }
  assert.ok(err);
  assert.equal(err.code, "ENOSPC");
  assert.equal(rig.attempts(), 1, "ENOSPC 不该走退避");
  assert.ok(Date.now() - t0 < 200);
  assert.deepEqual(leftovers(), []);
});
