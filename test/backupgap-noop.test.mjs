import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { ALL_PATCHES, backupGap } from "../lib/core.js";

// 2026-11-13：备份缺口把三个 dsh-session-reference 文件报成「已带补丁痕迹：原件要另外找回」，
// 实际它们与 app.asar.dshpurge-away 里的原件逐字节相同，一字节都没被打过。
// 成因：targetLooksPatched 只问「替换后的文本在不在」，而 #50 的三条替换 0.2.2-rc.1 上游本来就有，
// 于是"上游已包含"被当成"我们打过"。backupGap 的 missing 分支原来不看 changed，直接归进 patched。
// 这两条用例把这个区别钉住：空操作不算打过，真打过还要照报。

const PATCH = ALL_PATCHES.find((p) => p.id === 50);
const BAK_SUFFIX = ".dshpurge.bak";

function makeAiBase() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "dshpurge-bg-"));
  const dir = path.join(base, "dsh-session-reference", "lib");
  fs.mkdirSync(dir, { recursive: true });
  return { base, file: path.join(dir, "index.js") };
}

// #50 三条替换的产物文本：上游自己做到这一步时，文件里就是这个样子
const UPSTREAM_DONE = PATCH.replacements.map((r) => r.replace).join("\n") + "\n";

test("bak 缺失但补丁对当前文本是空操作：报缺口，但不报「原件要另外找回」", async () => {
  const { base, file } = makeAiBase();
  fs.writeFileSync(file, UPSTREAM_DONE);
  try {
    const gap = await backupGap(base);
    assert.ok(gap.missing.includes(file), "没有 bak 就该进 missing");
    assert.ok(
      !gap.patched.includes(file),
      "上游已经包含补丁内容 ≠ 我们打过补丁，不该催人去追原件",
    );
    assert.ok(!fs.existsSync(file + BAK_SUFFIX));
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});

test("bak 缺失且确实被打过：照旧报「原件要另外找回」", async () => {
  const { base, file } = makeAiBase();
  // 原文那行还在、替换后的文本不在、#50 的 marker 也没命中：这条替换真能改东西，changed=true。
  // （别拿 UPSTREAM_DONE 一起塞进来——#50 是 skipIfMarked，marker 一命中就整条跳过，changed 恒 false）
  const stillActionable = "[dsh-purge] #50\n" + PATCH.replacements[0].pattern + "\nexport {};\n";
  fs.writeFileSync(file, stillActionable);
  try {
    const gap = await backupGap(base);
    assert.ok(gap.missing.includes(file));
    assert.ok(gap.patched.includes(file), "真打过的文件仍要让运维知道原件得另外找");
  } finally {
    fs.rmSync(base, { recursive: true, force: true });
  }
});
