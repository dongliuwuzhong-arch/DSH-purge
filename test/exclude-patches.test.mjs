import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { readExcludePatches, withoutExcluded, ALL_PATCHES } from "../lib/core.js";

// 2026-11-16：需要"永久排除某条补丁"（宿舍机咨询里问过；本机因为温和剪枝要排除 #19）。
// 以前只能在 patches.js 里删条目 —— 一删就跟上游分叉。

const home = fs.mkdtempSync(path.join(os.tmpdir(), "purge-exclude-"));

test("没有清单文件 → 空集合，不过滤", () => {
  assert.equal(readExcludePatches(home).size, 0);
  assert.equal(withoutExcluded(ALL_PATCHES, home).length, ALL_PATCHES.length);
});

test("写了 excludePatches → 该 id 被剔除", () => {
  fs.mkdirSync(path.join(home, "dsh-purge"), { recursive: true });
  fs.writeFileSync(path.join(home, "dsh-purge", "exclude-patches.json"), JSON.stringify({ excludePatches: [19, "5"] }), "utf8");
  const set = readExcludePatches(home);
  assert.deepEqual([...set].sort((a, b) => a - b), [5, 19]);
  const kept = withoutExcluded(ALL_PATCHES, home);
  assert.ok(!kept.some((p) => p.id === 19 || p.id === 5));
  assert.equal(kept.length, ALL_PATCHES.length - 2);
});

test("清单写坏了 → 当作没排除（不能因此少贴别的补丁）", () => {
  const bad = fs.mkdtempSync(path.join(os.tmpdir(), "purge-exclude-bad-"));
  fs.mkdirSync(path.join(bad, "dsh-purge"), { recursive: true });
  fs.writeFileSync(path.join(bad, "dsh-purge", "exclude-patches.json"), "{ not json", "utf8");
  assert.equal(readExcludePatches(bad).size, 0);
  assert.equal(withoutExcluded(ALL_PATCHES, bad).length, ALL_PATCHES.length);
});
