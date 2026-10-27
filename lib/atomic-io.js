/**
 * 原子写与 rename 退避重试。
 *
 * 从 lib/core.js 拆出来：这里只用得到 node:path 与 hostFs 的路由层，不认识补丁表、
 * 不认识宿主布局。拆开之后 lib/desktop.js 的 import 不再回到 core.js，
 * core.js <-> desktop.js 那个既存的循环也就断了。
 */
import path from "node:path";
import { hostFs } from "./extract-asar.js";

const fs = hostFs;
const fsp = hostFs.promises;
// rename 撞上宿主进程占用时是瞬时的（EPERM/EBUSY），退避重试比直接报错有用得多。
// 循环实测见过一次：EPERM rename ...tmp -> cordis.patch.yml，重试即成功、字节一致。
const RENAME_RETRY_DELAYS = [20, 60, 150];
const RENAME_RETRY_CODES = new Set(["EPERM", "EBUSY", "EACCES", "ENOTEMPTY"]);
const RENAME_BUSY_HINT = "宿主进程可能正占用该文件：退出 DeepSeek Harness 后重试 / file busy, quit the host and retry";

function renameHint(e, to) {
  if (!RENAME_RETRY_CODES.has(String(e?.code || ""))) return e;
  const wrapped = new Error(`写入 ${to} 失败（${e.code}）：${RENAME_BUSY_HINT}`);
  wrapped.cause = e;
  wrapped.code = e.code;
  return wrapped;
}

function sleepSyncMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function renameSyncWithRetry(from, to) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (e) {
      if (!RENAME_RETRY_CODES.has(String(e?.code || ""))) throw e;
      if (attempt >= RENAME_RETRY_DELAYS.length) throw renameHint(e, to);
      sleepSyncMs(RENAME_RETRY_DELAYS[attempt]);
    }
  }
}

async function renameWithRetry(from, to) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fsp.rename(from, to);
      return;
    } catch (e) {
      if (!RENAME_RETRY_CODES.has(String(e?.code || ""))) throw e;
      if (attempt >= RENAME_RETRY_DELAYS.length) throw renameHint(e, to);
      await new Promise((done) => setTimeout(done, RENAME_RETRY_DELAYS[attempt]));
    }
  }
}

// H19:原子写。write-to-tmp + rename。EBUSY/ENOSPC 都不会半写坏原文件。
// 不走 FileHandle:hostFs.promises 只包了 readFile/writeFile/mkdir/unlink/rm/copyFile,无 open。
// 不显式 fsync:原子性靠 rename;KB 级配置文件断电丢最新一次写入可接受,下一次 apply 会补。
export function atomicWriteSync(fp, content, encoding = "utf8") {
  const dir = path.dirname(fp);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${fp}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content, encoding);
  try {
    renameSyncWithRetry(tmp, fp);
  } catch (e) {
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw e;
  }
}

export async function atomicWriteFile(fp, content, encoding = "utf8") {
  const dir = path.dirname(fp);
  await fsp.mkdir(dir, { recursive: true });
  const tmp = `${fp}.${process.pid}.${Date.now()}.tmp`;
  await fsp.writeFile(tmp, content, encoding);
  try {
    await renameWithRetry(tmp, fp);
  } catch (e) {
    try { await fsp.unlink(tmp); } catch { /* ignore */ }
    throw e;
  }
}

export async function atomicCopyFile(src, dst) {
  const dir = path.dirname(dst);
  await fsp.mkdir(dir, { recursive: true });
  const tmp = `${dst}.${process.pid}.${Date.now()}.copytmp`;
  await fsp.copyFile(src, tmp);
  try {
    await fsp.rename(tmp, dst);
  } catch (e) {
    try { await fsp.unlink(tmp); } catch { /* ignore */ }
    throw e;
  }
}
