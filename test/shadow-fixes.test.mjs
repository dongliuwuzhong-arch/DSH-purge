import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ALL_PATCHES, applyReplacementsToText, applyPatches, backupAll, inspectStaleBaks } from "../lib/core.js";

// 2026-11-14 影子安装在四个纯净版本上跑出来的两个 P0：
//  1) inspectStaleBaks 会无条件把既有 .dshpurge.bak 覆盖成「打完补丁的版本」→ 回滚能力归零；
//  2) #43 只吃两行形态，rc.2 的预设多一行身份句，打完留下悬挂标量，YAML 直接解析失败。

const P43 = ALL_PATCHES.find((p) => p.id === 43);

test("#43 三行形态（rc.2/rc.3）：打完不留悬挂身份句", () => {
  const src = [
    "            config:",
    "              prefix: >-",
    "                You are a coding agent powered by the {{model}} model.",
    "                You help the user customize DeepSeek Harness itself.",
    "          - id: agent-instructions",
    "",
  ].join("\n");
  const once = applyReplacementsToText(src, P43, "cordis.patch.yml");
  assert.equal(once.changed, true);
  assert.ok(!once.text.includes("You help the user customize DeepSeek Harness itself."), "悬挂行必须一起被吃掉");
  const lines = once.text.split("\n");
  const i = lines.findIndex((l) => l.includes('prefix: ""'));
  assert.ok(i > 0, 'prefix 必须变成 ""');
  assert.match(lines[i + 1], /- id: agent-instructions/, "下一行必须是下一个映射项，不能是散落的句子");
});

test("#43 两行形态（0.2.1/rc.1）仍然照旧处理", () => {
  const src = [
    "              prefix: >-",
    "                You are a coding agent powered by the {{model}} model.",
    "          - id: agent-instructions",
    "",
  ].join("\n");
  const once = applyReplacementsToText(src, P43, "cordis.patch.yml");
  assert.equal(once.changed, true);
  assert.ok(once.text.includes('prefix: ""'));
});

test("inspectStaleBaks 默认只报告，绝不改写既有 bak", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "purge-bak-"));
  const ai = path.join(root, "dsh", "node_modules", "@deepseek-ai");
  const pkg = path.join(ai, "dsh-workspace", "lib");
  fs.mkdirSync(pkg, { recursive: true });
  const fp = path.join(pkg, "index.js");
  const original = "const a = 1;\n";
  const patched = "const a = 1; // __wsErrLog [dsh-purge] workspace\n";
  fs.writeFileSync(fp + ".dshpurge.bak", original);
  fs.writeFileSync(fp, patched);
  const before = fs.readFileSync(fp + ".dshpurge.bak", "utf8");
  const report = inspectStaleBaks(ai, {});
  const after = fs.readFileSync(fp + ".dshpurge.bak", "utf8");
  assert.equal(after, before, "bak 必须原样保留");
  assert.ok(Array.isArray(report.refreshed));
  fs.rmSync(root, { recursive: true, force: true });
});
