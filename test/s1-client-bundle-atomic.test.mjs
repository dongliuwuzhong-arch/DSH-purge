import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// S1/A12：client bundle 这条写盘路径原来是 copyFileSync + writeFileSync（非原子），
// 而换包 PowerShell 第一件事就是 Stop-Process -Force —— 被打死在中途就是半个 client.js
// （页面白屏）或半个 bak（回到 revertAll 的坏 bak 家族）。现在改走 atomic-io。

const root = fs.mkdtempSync(path.join(os.tmpdir(), "dshpurge-clientatomic-"));
const dshHome = path.join(root, "home");
process.env.DSH_HOME = dshHome;
fs.mkdirSync(dshHome, { recursive: true });

const aiBase = path.join(root, "node_modules", "@deepseek-ai");
const clientFile = path.join(aiBase, "dsh-client-ui-conversation", "lib", "client.js");
const bak = clientFile + ".dshpurge.bak";

const core = await import("../lib/core.js");
const rep = core.ALL_PATCHES.find((p) => p.id === 77).replacements[0];
const BEFORE = "// fixture client bundle\n" + rep.pattern + "\n";

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

test("S1/A12 · 写 client bundle：内容与 bak 都到位，一个临时文件都不剩", () => {
  seed();
  const written = core.patchWatchedClientBundlesSync(aiBase, dshHome);

  assert.deepEqual(written, ["@deepseek-ai/dsh-client-ui-conversation"], "没认出写过的包名：" + JSON.stringify(written));
  const after = fs.readFileSync(clientFile, "utf8");
  assert.notEqual(after, BEFORE, "文件没被改");
  assert.ok(after.includes("[dsh-purge] rewind drops sent messages in this conversation"), "产物不在");
  assert.equal(fs.readFileSync(bak, "utf8"), BEFORE, "bak 必须是写之前的原件");
  assert.deepEqual(tempsIn(path.dirname(clientFile)), [], "原子写留下了临时文件");
});

test("S1/A12 · 第二趟不该再写（字节相同就不动 mtime/内容）", () => {
  seed();
  assert.equal(core.patchWatchedClientBundlesSync(aiBase, dshHome).length, 1);
  const first = fs.readFileSync(clientFile);
  assert.deepEqual(core.patchWatchedClientBundlesSync(aiBase, dshHome), [], "第二趟又写了一遍");
  assert.ok(fs.readFileSync(clientFile).equals(first), "内容被反复改动");
  assert.deepEqual(tempsIn(path.dirname(clientFile)), []);
});
