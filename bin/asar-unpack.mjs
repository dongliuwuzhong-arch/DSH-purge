#!/usr/bin/env node
// 把整个 .asar 解成一棵目录树（check-paths 的 asar-extract 只取单个文件，这个补上批量）。
// 用法：node asar-unpack.mjs <asar 路径> <输出目录>
import fs from "node:fs";
import path from "node:path";

const [, , asarPath, outDir] = process.argv;
if (!asarPath || !outDir) { console.error("用法: node asar-unpack.mjs <asar> <输出目录>"); process.exit(2); }

const fd = fs.openSync(asarPath, "r");
const head = Buffer.alloc(16);
fs.readSync(fd, head, 0, 16, 0);
const base = 8 + head.readUInt32LE(4);
const jsonLen = head.readUInt32LE(12);
const hb = Buffer.alloc(jsonLen);
fs.readSync(fd, hb, 0, jsonLen, 16);
const header = JSON.parse(hb.toString("utf8"));

let files = 0, bytes = 0;
const walk = (node, prefix) => {
  for (const [name, v] of Object.entries(node.files || {})) {
    const p = prefix ? prefix + "/" + name : name;
    if (v.files) { walk(v, p); continue; }
    const dst = path.join(outDir, p.split("/").join(path.sep));
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    // unpacked 条目不在 asar 体内，旁边有个 <asar>.unpacked 目录装着；缺了就落空文件。
    if (v.unpacked) {
      const side = asarPath + ".unpacked" + path.sep + p.split("/").join(path.sep);
      if (fs.existsSync(side)) { fs.copyFileSync(side, dst); bytes += fs.statSync(side).size; }
      else fs.writeFileSync(dst, Buffer.alloc(0));
      files++; continue;
    }
    const off = Number(v.offset);
    if (!Number.isFinite(off)) { fs.writeFileSync(dst, Buffer.alloc(0)); files++; continue; }
    const buf = Buffer.alloc(v.size || 0);
    if (v.size) fs.readSync(fd, buf, 0, v.size, base + off);
    fs.writeFileSync(dst, buf);
    files++; bytes += v.size || 0;
  }
};
walk(header, "");
fs.closeSync(fd);
console.log("解出 " + files + " 个文件，" + (bytes / 1048576).toFixed(1) + " MB -> " + outDir);
