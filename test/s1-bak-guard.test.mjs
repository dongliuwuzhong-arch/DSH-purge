import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// S1/A1：revertAll 与 backupAll 的"坏 bak"防线。
// 这张表里唯一不可逆的一步就是 resolve 之后的 copyFile —— 0 字节 bak 盖上去，
// 宿主文件就变成空文件，只能重解包 asar。所以这里的每个用例都在钉"绝不 copy"。

const root = fs.mkdtempSync(path.join(os.tmpdir(), "dshpurge-bakguard-"));
process.env.DSH_HOME = path.join(root, "home");
fs.mkdirSync(process.env.DSH_HOME, { recursive: true });

const aiBase = path.join(root, "ai");
const target = path.join(aiBase, "dsh-agent-instructions", "lib", "index.js");
const bak = target + ".dshpurge.bak";

const { ALL_PATCHES, backupAll, revertAll } = await import("../lib/core.js");

const rep = ALL_PATCHES.find((p) => p.id === 1).replacements[0];
const ORIGINAL = "// fixture header\n" + rep.pattern + "\nmodule.exports = {};\n";
const PATCHED = ORIGINAL.replace(rep.pattern, rep.replace);

const lower = (p) => path.resolve(p).toLowerCase();
const has = (list, fp) => (list || []).some((p) => lower(p) === lower(fp));

function put(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

function fresh() {
  fs.rmSync(aiBase, { recursive: true, force: true });
  put(target, PATCHED);
  put(bak, ORIGINAL);
}

test.after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

test("S1/A1 · 0 字节 bak 绝不能被 copyFile 盖回宿主：落进 emptyBak，目标一个字节不动", async () => {
  fresh();
  fs.writeFileSync(bak, "");
  const before = fs.readFileSync(target);

  const r = await revertAll(aiBase);

  assert.ok(has(r.emptyBak, target), "0 字节 bak 该进 emptyBak：" + JSON.stringify(r.emptyBak));
  assert.equal(r.reverted.length, 0, "不许拿空备份'回滚'");
  assert.deepEqual(r.errors, []);
  assert.ok(fs.readFileSync(target).equals(before), "宿主文件被改动了");
  assert.ok(fs.existsSync(bak), "坏 bak 只报告不删除（留证据给人看）");
});

test("S1/A1 · 明显被截断的 bak（当前文件的前缀、断在行中）同样拦住", async () => {
  fresh();
  // 拷贝写到一半断掉，留下的就是"当前文件的前 k 个字节"
  const truncated = PATCHED.slice(0, 40);
  assert.notEqual(truncated.slice(-1), "\n", "夹具本身要停在行中，否则不算截断形态");
  fs.writeFileSync(bak, truncated);
  const before = fs.readFileSync(target);

  const r = await revertAll(aiBase);

  assert.ok(has(r.emptyBak, target), "截断 bak 该进 emptyBak：" + JSON.stringify(r.emptyBak));
  assert.equal(r.reverted.length, 0);
  assert.ok(fs.readFileSync(target).equals(before));
});

test("S1/A1 · 尾部追加型补丁：原件是当前文件的前缀但停在行尾，必须照常回滚", async () => {
  fresh();
  const appended = ORIGINAL + "// [dsh-purge] appended block\n";
  put(target, appended);
  put(bak, ORIGINAL); // 前缀，但以 \n 收尾 → 不是截断

  const r = await revertAll(aiBase);

  assert.ok(has(r.reverted, target), "正常备份被误判成截断：" + JSON.stringify(r.emptyBak));
  assert.equal(fs.readFileSync(target, "utf8"), ORIGINAL);
  assert.equal(fs.existsSync(bak), false, "回滚成功后 bak 该被吃掉");
});

test("S1/A1 · 0 字节 bak 会被 backupAll 当不存在并重建（否则缺口永久化）", async () => {
  fs.rmSync(aiBase, { recursive: true, force: true });
  put(target, ORIGINAL);
  put(bak, "");

  const b = await backupAll(aiBase);

  assert.deepEqual(b.errors, []);
  assert.ok(has(b.made, bak), "0 字节占位该被重建：" + JSON.stringify({ made: b.made, refused: b.refused }));
  assert.deepEqual(b.refused, [], "干净原件不该进 refused");
  assert.equal(fs.readFileSync(bak, "utf8"), ORIGINAL, "重建出来的 bak 必须等于原件");
  const stray = fs.readdirSync(path.dirname(target)).filter((n) => n !== "index.js" && n !== "index.js.dshpurge.bak");
  assert.deepEqual(stray, [], "重建过程不许留 .copytmp/.tmp 残渣：" + JSON.stringify(stray));
});
