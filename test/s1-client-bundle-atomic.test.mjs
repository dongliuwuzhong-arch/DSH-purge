import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { atomicWriteSync } from "../lib/atomic-io.js";

// S1/A12：client bundle 这条写盘路径原来是 copyFileSync + writeFileSync（非原子），
// 而换包 PowerShell 第一件事就是 Stop-Process -Force —— 被打死在中途就是半个 client.js
// （页面白屏）或半个 bak（回到 revertAll 的坏 bak 家族）。现在改走 atomic-io。
//
// 1.5（V15 补丁表）：主表里已经没有以 lib/client.js 为目标的补丁了（#56 / #77 进存档区），
// 于是 patchWatchedClientBundlesSync 从"写"退成"空转"。这里改成两条：
//   ① 原子写本身的性质直接核 lib/atomic-io.js（tmp + rename、不留临时文件）；
//   ② 该写盘入口在现表下必须一个字节都不写（删掉补丁不能变成"换个入口偷偷写"）。
// ② 覆盖的是"别再动这些文件"，① 覆盖的才是原来那条 S1/A12 的原子性。

const root = fs.mkdtempSync(path.join(os.tmpdir(), "dshpurge-clientatomic-"));
const dshHome = path.join(root, "home");
process.env.DSH_HOME = dshHome;
fs.mkdirSync(dshHome, { recursive: true });

const aiBase = path.join(root, "node_modules", "@deepseek-ai");
const clientFile = path.join(aiBase, "dsh-client-ui-conversation", "lib", "client.js");
const bak = clientFile + ".dshpurge.bak";

const core = await import("../lib/core.js");
const BEFORE = "// fixture client bundle\n";

function put(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function seed() {
  fs.rmSync(aiBase, { recursive: true, force: true });
  put(clientFile, BEFORE);
}

test.after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const tempsIn = (dir) => fs.readdirSync(dir).filter((n) => /\.(tmp|copytmp)$/.test(n));

test("S1/A12 · 原子写：内容到位、一个临时文件都不剩", () => {
  seed();
  const content = BEFORE + "// patch marker\n";
  atomicWriteSync(clientFile, content);
  assert.equal(fs.readFileSync(clientFile, "utf8"), content, "内容没写进去");
  assert.deepEqual(tempsIn(path.dirname(clientFile)), [], "原子写留下了临时文件");
});

test("S1/A12 · 原子写：bak 先落原件，再覆盖正文（bak 不许等于补丁后的内容）", () => {
  seed();
  if (fs.existsSync(bak)) fs.rmSync(bak);
  const current = fs.readFileSync(clientFile);
  atomicWriteSync(bak, current);
  atomicWriteSync(clientFile, BEFORE + "// patched\n");
  assert.equal(fs.readFileSync(bak, "utf8"), BEFORE, "bak 必须是把写之前的原件");
  assert.notEqual(fs.readFileSync(clientFile, "utf8"), BEFORE);
  assert.deepEqual(tempsIn(path.dirname(clientFile)), [], "原子写留下了临时文件");
});

test("1.5 · 主表已无以 client.js 为目标的补丁 → patchWatchedClientBundlesSync 必须空转", () => {
  seed();
  const written = core.patchWatchedClientBundlesSync(aiBase, dshHome);
  assert.deepEqual(written, [], "没有 client bundle 补丁却写了盘：" + JSON.stringify(written));
  assert.equal(fs.readFileSync(clientFile, "utf8"), BEFORE, "文件被改了");
  assert.equal(fs.existsSync(bak), false, "空转还留了 bak");
  assert.deepEqual(tempsIn(path.dirname(clientFile)), []);
});
