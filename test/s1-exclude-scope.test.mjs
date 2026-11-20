import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// S1/A6：exclude-patches.json 以前只挡住「贴」和「显示」两个入口。同一条补丁在
// hook deny 路径表、状态回填、client bundle 写盘、面板分母上各算各的 —— 本机把 #19
// 排除之后，patches_total 仍是 88 而 patch_status[19] 不存在，面板"总数/就绪"永远差 1。
// 这里钉住 effectivePatchIds 这条唯一入口。

const root = fs.mkdtempSync(path.join(os.tmpdir(), "dshpurge-exclude-scope-"));
const plainHome = path.join(root, "home-plain");
const exclHome = path.join(root, "home-excl");
process.env.DSH_HOME = plainHome;
for (const h of [plainHome, exclHome]) fs.mkdirSync(h, { recursive: true });

const EXCLUDED = [30, 31, 64, 65, 77];
fs.mkdirSync(path.join(exclHome, "dsh-purge"), { recursive: true });
fs.writeFileSync(
  path.join(exclHome, "dsh-purge", "exclude-patches.json"),
  JSON.stringify({ excludePatches: EXCLUDED }),
);

// 宿主目录写成 node_modules/@deepseek-ai 形态：isWatchedClientBundle 只认这个形状。
const aiBase = path.join(root, "node_modules", "@deepseek-ai");
const hooksFile = path.join(aiBase, "dsh-hooks-claude-code", "lib", "index.js");
const clientFile = path.join(aiBase, "dsh-client-ui-conversation", "lib", "client.js");

const core = await import("../lib/core.js");
const hooksDeny = await import("../lib/hooks-deny.js");

const byId = (id) => core.ALL_PATCHES.find((p) => p.id === id);
const clientRep = byId(77).replacements[0];
const CLIENT_BEFORE = "// fixture client bundle\n" + clientRep.pattern + "\n";

function put(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function seed() {
  fs.rmSync(aiBase, { recursive: true, force: true });
  put(hooksFile, "// hooks fixture\n");
  put(clientFile, CLIENT_BEFORE);
  fs.rmSync(clientFile + core.BAK_SUFFIX, { force: true });
}

test.after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

test("S1/A6 · effectivePatchIds 就是 readExcludePatches 的口径（唯一入口）", () => {
  assert.equal(core.effectivePatchIds(plainHome).size, 0);
  assert.deepEqual([...core.effectivePatchIds(exclHome)].sort((a, b) => a - b), [...EXCLUDED].sort((a, b) => a - b));
  assert.equal(core.withoutExcluded(core.ALL_PATCHES, exclHome).length, core.ALL_PATCHES.length - EXCLUDED.length);
});

test("S1/A6 · hookDenyPaths 不再把被排除补丁的目标文件放进 deny 表", () => {
  seed();
  const plain = core.hookDenyPaths(aiBase, plainHome);
  assert.ok(plain.some((p) => path.resolve(p).toLowerCase() === path.resolve(hooksFile).toLowerCase()),
    "对照组：未排除时必须登记：" + JSON.stringify(plain));
  assert.deepEqual(core.hookDenyPaths(aiBase, exclHome), [], "被排除的补丁仍进了 deny 表");
});

test("S1/A6 · annotateHookDenyStatus 不把被排除的 id 写回状态表", async () => {
  const io = { hookDenyPaths: () => [], loadText: async () => "", saveText: async () => true };
  const status = { 30: "applied" };
  const out = await hooksDeny.annotateHookDenyStatus(status, { hooksDenyBypass: false }, aiBase, io, exclHome);
  assert.deepEqual(Object.keys(out), ["30"], "被排除的 31/64/65 又被回填了：" + JSON.stringify(out));
  assert.equal(out[30], "applied", "已经 applied 的别被覆写");
});

test("S1/A6 · patchStatus 用同一个 dshHome：排除的 id 不出现在状态里", async () => {
  seed();
  const full = await core.patchStatus(aiBase, core.ALL_PATCHES, { dshHome: plainHome });
  const part = await core.patchStatus(aiBase, core.ALL_PATCHES, { dshHome: exclHome });
  assert.ok(30 in full, "对照组：未排除时该有条目");
  assert.equal(30 in part, false, "被排除的补丁不该出现在状态表");
  assert.equal(77 in part, false);
  assert.deepEqual(
    Object.keys(part).map(Number).sort((a, b) => a - b),
    core.withoutExcluded(core.ALL_PATCHES, exclHome).map((p) => p.id).sort((a, b) => a - b),
    "状态表的 id 集合必须等于'生效补丁'集合（面板分母的唯一口径）",
  );
});

test("S1/A6 · patchWatchedClientBundlesSync 不给被排除的补丁写盘", () => {
  seed();
  fs.rmSync(clientFile + core.BAK_SUFFIX, { force: true });
  const written = core.patchWatchedClientBundlesSync(aiBase, exclHome);
  assert.deepEqual(written, [], "被排除的补丁仍然写了 client bundle");
  assert.equal(fs.readFileSync(clientFile, "utf8"), CLIENT_BEFORE, "被排除的补丁改动了文件");
  assert.equal(fs.existsSync(clientFile + core.BAK_SUFFIX), false, "被排除的补丁还留了 bak");
});
