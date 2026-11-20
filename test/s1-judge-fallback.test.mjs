import test from "node:test";
import assert from "node:assert/strict";

import { ALL_PATCHES, patchFileOutcome, targetLooksPatched } from "../lib/core.js";

// S1/A3 + A4 + A5 的判定层。三条落在同一族函数上（patchApplied / targetLooksPatched）：
//   假阴（贴完报 skipped）：marker 与补丁体只差大小写（#36）、文案彻底脱钩（#73 / #100）
//   假阳（原件报 applied）：markersAny 里混进补丁体自己会写出来的上游原句（#24 的 "fetch: true"）
//   判据不等价：legacy 的 patterns/replace 没进 rule2（#7 这类七条）

const byId = (id) => ALL_PATCHES.find((p) => p.id === id);
const repsOf = (p) => (Array.isArray(p.replacements) ? p.replacements : (p.patterns ?? []).map((pat) => ({ pattern: pat, replace: p.replace })));
const firstKey = (p) => (Array.isArray(p.file) ? p.file[0] : p.file);

/** 打完补丁的那份文本：产物全在场、原文全不在。不依赖任何宿主文件。 */
const productText = (p) => ["// fixture", ...repsOf(p).map((r) => String(r.replace)), ""].join("\n");

/** 产物都在、但 marker 那句被后来的改动改掉了 = 现场「marker 漂移」形态。 */
function driftedText(p) {
  let text = productText(p);
  for (const marker of p.markers || []) text = text.split(marker).join("[drifted]");
  return text;
}

const SYNTHETIC = {
  id: 9001,
  file: "synthetic",
  replacements: [{ pattern: "ORIGINAL_TEXT_ALPHA", replace: "PATCHED_TEXT_ALPHA" }],
  markers: ["[dsh-purge] synthetic marker"],
};

test("S1/A4 · 机制：marker 缺席但产物在场 + 无可打 pattern → applied（贴完不再报 skipped）", () => {
  const p = SYNTHETIC;
  assert.equal(patchFileOutcome("ORIGINAL_TEXT_ALPHA", p), "pending", "干净原文必须待贴");
  assert.equal(patchFileOutcome("PATCHED_TEXT_ALPHA", p), "applied", "产物在场就该 applied");
  assert.equal(
    patchFileOutcome("PATCHED_TEXT_ALPHA ORIGINAL_TEXT_ALPHA", p),
    "pending",
    "原文还在 = 活没干完，兜底不许把半贴的文件判成 applied",
  );
});

test("S1/A4 · #36 marker 与补丁体只差大小写：大小写不敏感兜底生效", () => {
  const p = byId(36);
  const fp = "dsh-tool-fs/lib/index.js";
  assert.ok(productText(p).toLowerCase().includes(p.markers[0].toLowerCase()), "夹具前提：marker 小写形态在产物里");
  let text = productText(p).replace(/approval is auto-granted/g, "Approval is auto-granted");
  assert.equal(text.includes(p.markers[0]), false, "夹具没体现大小写漂移");
  assert.equal(patchFileOutcome(text, p, fp), "applied", "贴完了还报 skipped（大小写兜底没生效）");
});

test("S1/A4 · #73 / #100 marker 与补丁体彻底脱钩：产物在场即 applied", () => {
  for (const [id, fp] of [[73, "minimal.patch.yml"], [100, "dsh-api-session-controller/lib/index.js"]]) {
    const p = byId(id);
    const text = driftedText(p);
    for (const marker of p.markers || []) assert.equal(text.includes(marker), false, "#" + id + " 夹具不该命中 marker");
    assert.equal(patchFileOutcome(text, p, fp), "applied", "#" + id + " 贴完仍被判 skipped");
  }
});

test("S1/A5 · #24 的 markersAny 混了一条上游原句（fetch: true）：原件不再判 applied", () => {
  const p = byId(24);
  const upstream = "- id: tool-web\n  name: '@deepseek-ai/dsh-tool-web'\n  config:\n    fetch: true\n    searchTimeoutMs: 60000\n";
  const ours = upstream + "    # [dsh-purge] preset fetch enabled\n";
  assert.equal(patchFileOutcome(upstream, p, "standard.patch.yml"), "skipped",
    "fetch: true 是上游原句，命中它不能算'我们贴过'");
  assert.equal(patchFileOutcome(ours, p, "standard.patch.yml"), "applied");
  assert.equal(patchFileOutcome(String(repsOf(p)[0].pattern) + "\n", p, "standard.patch.yml"), "pending");
});

test("S1/A5 · 带 [dsh-purge] 字样的 marker 永远是有效证据（#53 不被这条规则误伤）", () => {
  const p = byId(53);
  const text = productText(p);
  assert.ok(p.markers.some((m) => m.startsWith("[dsh-purge]") && text.includes(m)), "夹具该命中插件自写 marker");
  assert.equal(patchFileOutcome(text, p, "dsh-web-app/lib/index.js"), "applied");
});

test("S1/A3 · rule2 现在也认 legacy 的 patterns/replace（#7 不再把原文当已打过）", () => {
  const p = byId(7);
  const key = firstKey(p);
  // marker（= 打完之后的 mode 行）命中，但上游原文那行还在 —— 这就是"是原件"。
  // 旧实现 rule2 只认 patch.replacements，#7 这种 legacy 声明整条跳过 rule2，
  // 于是 marker 一命中就判"打过"，backupAll 拒建 bak。
  const text = ["// fixture", String(p.replace), String(p.patterns[0]), ""].join("\n");
  assert.equal(targetLooksPatched(text, key), false, "原文还在就该判干净");
});

test("S1/A3 · 幂等插入（replace 自带 pattern，#103）不再让 rule2 恒真", () => {
  const p = byId(103);
  const key = firstKey(p);
  const reps = repsOf(p);
  assert.ok(String(reps[0].replace).includes(String(reps[0].pattern)), "前提：repl[0] 是自包含替换");
  assert.equal(String(reps[1].replace).includes(String(reps[1].pattern)), false, "前提：repl[1] 不是");
  const patched = ["// fixture", ...reps.map((r) => String(r.replace)), ""].join("\n");
  const clean = ["// fixture", ...reps.map((r) => String(r.pattern)), ""].join("\n");
  assert.equal(targetLooksPatched(patched, key), true, "打完补丁的文件必须判'已打过'（否则会拿它当原件建 bak）");
  assert.equal(targetLooksPatched(clean, key), false, "原文仍在 = 干净基线");
});
