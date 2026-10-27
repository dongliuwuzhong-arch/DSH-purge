import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { extractZipBuffer } from "../lib/zip-extract.js";
import { relocateRedteamPreset, writeBakManifest } from "../lib/host-state.js";

/** 手搓一个 stored（不压缩）zip：够我们自己的解压器读就行，不依赖第三方。 */
function buildZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const body = Buffer.from(data || "", "utf8");
    const nameBuf = Buffer.from(name, "utf8");
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(0, 8);
    lh.writeUInt16LE(0, 10);
    lh.writeUInt16LE(0, 12);
    lh.writeUInt32LE(0, 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(body.length, 22);
    lh.writeUInt16LE(nameBuf.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, nameBuf, body);

    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(0, 10);
    ch.writeUInt16LE(0, 12);
    ch.writeUInt16LE(0, 14);
    ch.writeUInt32LE(0, 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(body.length, 24);
    ch.writeUInt16LE(nameBuf.length, 28);
    ch.writeUInt16LE(0, 30);
    ch.writeUInt16LE(0, 32);
    ch.writeUInt16LE(0, 34);
    ch.writeUInt16LE(0, 36);
    ch.writeUInt32LE(0, 38);
    ch.writeUInt32LE(offset, 42);
    centrals.push(ch, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

const tmp = (tag) => fs.mkdtempSync(path.join(os.tmpdir(), "dshpurge-" + tag + "-"));

test("zip 目录条目建成目录，文件条目照常写入", () => {
  const dest = tmp("zip");
  const buf = buildZip([
    { name: "pkg/" },
    { name: "pkg/a.txt", data: "alpha" },
    { name: "pkg/sub/" },
    { name: "pkg/sub/b.txt", data: "beta" },
  ]);
  extractZipBuffer(buf, dest);
  assert.equal(fs.statSync(path.join(dest, "pkg")).isDirectory(), true, "pkg 必须是目录");
  assert.equal(fs.readFileSync(path.join(dest, "pkg/a.txt"), "utf8"), "alpha");
  assert.equal(fs.statSync(path.join(dest, "pkg/sub")).isDirectory(), true, "pkg/sub 必须是目录");
  assert.equal(fs.readFileSync(path.join(dest, "pkg/sub/b.txt"), "utf8"), "beta");
});

test("zip 只有目录条目也能建出空目录", () => {
  const dest = tmp("zipdir");
  extractZipBuffer(buildZip([{ name: "empty/" }]), dest);
  assert.equal(fs.statSync(path.join(dest, "empty")).isDirectory(), true);
  assert.deepEqual(fs.readdirSync(path.join(dest, "empty")), []);
});

test("zip 目录条目挡住穿越路径", () => {
  const dest = tmp("zipesc");
  assert.throws(() => extractZipBuffer(buildZip([{ name: "../evil/" }]), dest), /zip 路径不合法/);
});

test("卸载把 redteam 预设改名进 .disabled，不删除", () => {
  const home = tmp("home");
  const presetDir = path.join(home, ".agent-presets", "redteam");
  fs.mkdirSync(presetDir, { recursive: true });
  fs.writeFileSync(path.join(presetDir, "preset.yml"), "name: redteam\n");

  const r = relocateRedteamPreset(home);
  assert.equal(r.moved, true);
  assert.equal(fs.existsSync(presetDir), false, "原位必须消失");
  const moved = path.join(home, ".agent-presets", ".disabled", "redteam");
  assert.equal(fs.existsSync(path.join(moved, "preset.yml")), true, "内容要跟着走");
  assert.equal(fs.readFileSync(path.join(moved, "preset.yml"), "utf8"), "name: redteam\n");

  const again = relocateRedteamPreset(home);
  assert.equal(again.moved, false);
  assert.equal(again.reason, "absent");
});

test("重复卸载不覆盖已有的 .disabled/redteam，改名带时间戳", () => {
  const home = tmp("home2");
  const presetDir = path.join(home, ".agent-presets", "redteam");
  fs.mkdirSync(presetDir, { recursive: true });
  fs.writeFileSync(path.join(presetDir, "preset.yml"), "first\n");
  relocateRedteamPreset(home, new Date(2026, 9, 27, 10, 0, 0));
  fs.mkdirSync(presetDir, { recursive: true });
  fs.writeFileSync(path.join(presetDir, "preset.yml"), "second\n");
  const r = relocateRedteamPreset(home, new Date(2026, 9, 27, 11, 22, 33));
  assert.equal(r.moved, true);
  assert.match(path.basename(r.to), /^redteam-20261027-112233$/);
  const disabled = path.join(home, ".agent-presets", ".disabled");
  assert.equal(fs.readFileSync(path.join(disabled, "redteam", "preset.yml"), "utf8"), "first\n");
  assert.equal(fs.readFileSync(path.join(r.to, "preset.yml"), "utf8"), "second\n");
});

test("bak 清单只写清单不动文件，跳过 node_modules", () => {
  const home = tmp("home3");
  const ai = tmp("ai");
  const live = path.join(ai, "pkg", "lib", "x.js");
  fs.mkdirSync(path.dirname(live), { recursive: true });
  fs.writeFileSync(live, "patched\n");
  fs.writeFileSync(live + ".dshpurge.bak", "original\n");
  const skipped = path.join(ai, "pkg", "node_modules", "y.js.dshpurge.bak");
  fs.mkdirSync(path.dirname(skipped), { recursive: true });
  fs.writeFileSync(skipped, "noise\n");

  const r = writeBakManifest(ai, home, { host: "test-host" });
  assert.equal(r.count, 1, "node_modules 里的 bak 不算");
  const manifest = JSON.parse(fs.readFileSync(r.path, "utf8"));
  assert.equal(manifest.count, 1);
  assert.equal(manifest.host, "test-host");
  assert.equal(manifest.aiBase, ai);
  const row = manifest.backups[0];
  assert.equal(row.original, live);
  assert.equal(row.size, Buffer.byteLength("original\n"));
  assert.equal(row.sha256, crypto.createHash("sha256").update("original\n").digest("hex"));
  assert.equal(row.originalExists, true);

  assert.equal(fs.readFileSync(live + ".dshpurge.bak", "utf8"), "original\n", "清单不许动 bak");
  assert.equal(fs.readFileSync(live, "utf8"), "patched\n", "清单不许动现网");
  assert.equal(fs.existsSync(skipped), true, "清单不许删东西");
});
