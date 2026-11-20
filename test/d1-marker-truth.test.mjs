import test from "node:test";
import assert from "node:assert/strict";

import { ALL_PATCHES, applyReplacementsToText, patchFileOutcome, patchWrittenMarkers } from "../lib/core.js";

// 影子报告 2026-11-16 §5.3：#62 / #100 / #101 / #102 在 rc.5 上"只落了一部分标记"。
// 查清的结果是 markers 里混着四类不会由本表写出的东西（旧编号别名、手打标记、上游原句、
// 死分支标记），不是有 replacement 没落地。这里把这条区分钉成机器判据：
//   markers        = 认得的全部证据（patchApplied 仍然用它，不许收紧也不许放松）
//   markersWritten = 本表 replacement 会写出来的（落地核对只认它）

const WITH_WRITTEN = ALL_PATCHES.filter((p) => Array.isArray(p.markersWritten) && p.markersWritten.length > 0);
const patchById = (id) => ALL_PATCHES.find((p) => p.id === id);
const replaceTexts = (patch) => (Array.isArray(patch.replacements)
  ? patch.replacements.map((r) => r.replace)
  : (patch.patterns || []).map(() => patch.replace)).filter((t) => typeof t === "string");

const P24 = patchById(24);

// rc.3 / rc.5 出厂 preset 的真实文本（dsh-web-app/presets/*.patch.yml，缩进 10/12/14）。
const PRESET_RC5 = [
  "lowParallelInProgress: true",
  "          - id: tool-web",
  "            name: '@deepseek-ai/dsh-tool-web'",
  "            config:",
  "              fetch: true",
  "              searchTimeoutMs: 60000",
  "          - id: present",
  "",
].join("\n");

// 0.1.x / liangshen / 用户 unrestricted 的老形态：0 缩进、fetch: false。
const PRESET_OLD = [
  "- id: tool-web",
  "  name: '@deepseek-ai/dsh-tool-web'",
  "  config:",
  "    fetch: false",
  "    searchTimeoutMs: 60000",
  "",
].join("\n");

const MARKER = "[dsh-purge] preset fetch enabled";

test("每条 markersWritten 都在 markers 里，且能逐字在某个 replacement 的 replace 里找到", () => {
  assert.ok(WITH_WRITTEN.length >= 5, "这几条补丁应该都声明了 markersWritten");
  for (const patch of WITH_WRITTEN) {
    const texts = replaceTexts(patch);
    for (const marker of patch.markersWritten) {
      assert.ok(patch.markers.includes(marker), "#" + patch.id + " 的 markersWritten 不在 markers 里：" + marker);
      assert.ok(texts.some((t) => t.includes(marker)),
        "#" + patch.id + " 声明会写出的标记在 replacement 里找不到：" + marker);
    }
    // 反方向不必全等：markers 里那些旧编号 / 手打 / 上游原句就是故意留在里面的。
    assert.ok(patchWrittenMarkers(patch).length >= 1, "#" + patch.id + " 一条会写出的标记都没有");
  }
});

test("#24 出厂 preset（rc.3 / rc.5 都是 fetch: true）：补一行痕迹，且只补一次", () => {
  const once = applyReplacementsToText(PRESET_RC5, P24, "standard.patch.yml");
  assert.equal(once.changed, true, "rc.5 形态必须命中，否则这条在候选树上就是 skipped");
  assert.ok(once.text.includes(MARKER));
  assert.ok(once.text.includes("fetch: true"), "原样保留 fetch: true");
  // 标记必须在 config 块里那行 timeout 之后，不能飘到下一个映射项前头去
  const lines = once.text.split("\n");
  const timeoutAt = lines.findIndex((l) => l.includes("searchTimeoutMs: 60000"));
  assert.ok(timeoutAt > 0);
  assert.equal(lines[timeoutAt + 1], "              " + "# " + MARKER.slice(MARKER.indexOf("[")), "标记必须紧跟 timeout 行");

  const twice = applyReplacementsToText(once.text, P24, "standard.patch.yml");
  assert.equal(twice.changed, false, "第二次应用不许再叠一行标记");
  assert.equal(twice.text.split(MARKER).length - 1, 1);
});

test("#24 老形态（0 缩进 fetch: false）照旧打开 fetch 并补标记", () => {
  const out = applyReplacementsToText(PRESET_OLD, P24, "agent.cordis.yml");
  assert.equal(out.changed, true);
  assert.ok(out.text.includes("    fetch: true"));
  assert.ok(!out.text.includes("fetch: false"));
  assert.ok(out.text.includes(MARKER));
});

test("#24 satisfiedBy：出厂 preset 整块已是目标态判 applied，老形态照旧 pending / skipped", () => {
  assert.equal(P24.satisfiedBy.length, 1);
  assert.ok(P24.satisfiedBy[0].includes("fetch: true"));
  // rc.3 / rc.5 出厂预设（14 空格缩进、fetch 已开）：这条对它们无事可做
  assert.equal(patchFileOutcome(PRESET_RC5, P24, "standard.patch.yml"), "applied");
  // 反向对照 1：0 缩进老形态里 fetch: false 还没开 → 如实报 pending
  assert.equal(patchFileOutcome(PRESET_OLD, P24, "agent.cordis.yml"), "pending");
  // 反向对照 2：S1/A5 的判据不许被绕过——0 缩进 + 4 空格 fetch: true（上游原句，无标记）→ skipped
  const upstreamOld = "- id: tool-web\n  name: '@deepseek-ai/dsh-tool-web'\n  config:\n    fetch: true\n    searchTimeoutMs: 60000\n";
  assert.equal(patchFileOutcome(upstreamOld, P24, "standard.patch.yml"), "skipped",
    "satisfiedBy 只认出厂 preset 的整块形态，不能退化成'只要 fetch: true 就算贴过'");
});

test("#24 markersWritten 不含上游原句；markers 仍然认得它（判据不收紧也不放松）", () => {
  assert.deepEqual(patchWrittenMarkers(P24), [MARKER]);
  assert.ok(P24.markers.includes("fetch: true"), "markers 里的上游原句是历史判据，不能删");
  assert.ok(!P24.markersWritten.includes("fetch: true"), "上游原句不该被算成我们的痕迹");
});

test("#62 / #100 / #101 / #102 的 markersWritten 只留本表真会写的那几条", () => {
  assert.deepEqual(patchWrittenMarkers(patchById(62)), [
    "[dsh-purge] no approval service → allow",
    "[dsh-purge] unavailable channel → allow",
  ]);
  assert.deepEqual(patchWrittenMarkers(patchById(100)), ["[dsh-purge-100] steer() stays next-step"]);
  assert.deepEqual(patchWrittenMarkers(patchById(101)), ["[dsh-purge-89]"]);
  assert.deepEqual(patchWrittenMarkers(patchById(102)), ["[dsh-purge-102]"]);
});

test("没声明 markersWritten 的补丁：patchWrittenMarkers 退回 markers，不改判据", () => {
  const p = patchById(43);
  assert.equal(p.markersWritten, undefined);
  assert.deepEqual(patchWrittenMarkers(p), p.markers);
});
