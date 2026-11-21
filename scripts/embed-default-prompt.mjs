import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sealSlot } from "../lib/table-key.js";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = path.join(root, "lib", "default-prompt-inject.md");
const dest = path.join(root, "lib", "asset-table.js");

if (!fs.existsSync(src)) {
  throw new Error(`missing local source: ${src}`);
}

const text = fs.readFileSync(src, "utf8");
if (!text.trim()) throw new Error("local source is empty");

// --check（2026-11-22，V15 P0-1）：只验不写 —— 源 md 与 lib/asset-table.js 里那个槽
// （运行时真正注入的就是它）是否同步。不同步退 1，供 CI 与 assert-soul-guard 之外的第二道门用。
if (process.argv.slice(2).includes("--check")) {
  const { openSlot } = await import("../lib/table-read.js");
  const norm = (s) => String(s ?? "").replace(/\r\n/g, "\n").trim();
  const slot = openSlot();
  const md = norm(text);
  const sealed = norm(slot);
  const tail = `md ${Buffer.byteLength(text)}B / 槽 ${Buffer.byteLength(slot)}B`;
  if (!sealed) {
    console.error(`✗ 密封槽解不出来（${tail}）：lib/asset-table.js 损坏或表密钥不匹配`);
    process.exit(1);
  }
  if (md !== sealed) {
    console.error(`✗ 源与槽不同步（${tail}）：改完 ${path.relative(root, src)} 没重跑 npm run embed-prompt，或槽被单独改过`);
    process.exit(1);
  }
  console.log(
    `✓ 源与槽同步（${tail}）` +
      (text === slot ? "" : "；只差行尾，重跑本脚本可把槽的行尾改成 LF"),
  );
  process.exit(0);
}

const packed = sealSlot(text);
const chunk = (s, n = 96) => {
  const out = [];
  for (let i = 0; i < s.length; i += n) out.push(s.slice(i, i + n));
  return out;
};

const out = `const SLOT_ROWS = ${JSON.stringify(chunk(packed.SLOT), null, 2)};

export const SLOT = SLOT_ROWS.join("");
export const MASK = ${JSON.stringify(packed.MASK)};
export const TAG = ${JSON.stringify(packed.TAG)};
export const IV = ${JSON.stringify(packed.IV)};
`;

fs.writeFileSync(dest, out, "utf8");
process.stdout.write(`wrote ${path.relative(root, dest)} bytes=${text.length}\n`);
