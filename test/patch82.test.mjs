import test from "node:test";
import assert from "node:assert/strict";

import { ALL_PATCHES, applyReplacementsToText } from "../lib/core.js";

const PATCH = ALL_PATCHES.find((p) => p.id === 82);

// #82 的 pattern 曾经绑了一个不该绑的尾部锚点：
//   import { REMOTE_STREAM_MUX_PATH, ... } from "@deepseek-ai/dsh-api-gateway/stream-protocol";
//   //#region ../../packages/util/home-paths/lib/index.js
// 0.2.2 起，那行 import 后面跟的是 mime 的 region（home-paths 挪到 1700 多行去了），
// 于是整条补丁 0 命中。它是 optional:true + skipIfMarked，所以只表现成 na，不报错 ——
// 面板上看着"没事"，实际上「双击 exe 缺 DSH_PROFILE → cordis 不加载」这个坑没兜住。
//
// 这一条测的就是：pattern 只锚 import 行本身，不依赖它后面跟什么。

const IMPORT_LINE =
  'import { REMOTE_STREAM_MUX_PATH, parseRemoteStreamServerMessage } from "@deepseek-ai/dsh-api-gateway/stream-protocol";\n';

test("#82 pattern 只认 import 行，不绑后面跟的 region 注释", () => {
  const pattern = PATCH.replacements[0].pattern;
  assert.equal(typeof pattern, "string");
  assert.ok(pattern.startsWith(IMPORT_LINE), "pattern 必须以那行 import + 换行开头");
  assert.ok(
    !pattern.includes("home-paths"),
    "pattern 里不该再出现 home-paths —— 那是 0.2.1 的排布，0.2.2 里它跑到别处去了",
  );
});

test("#82 在 0.2.2 的排布上能命中（import 后面跟 mime region）", () => {
  const fake = [
    'import WebSocket from "ws";',
    IMPORT_LINE.trimEnd(),
    "//#region ../../node_modules/.pnpm/mime@4.1.1/node_modules/mime/dist/types/other.js",
    "const types$3 = {",
    '\t"application/prs.cww": ["cww"],',
    "};",
    "",
  ].join("\n");

  const out = applyReplacementsToText(fake, PATCH, "main.js");
  assert.equal(out.changed, true, "应当命中");

  // 注入的那行必须有
  assert.ok(
    out.text.includes('if (typeof process !== "undefined" && process.env && !process.env.DSH_PROFILE) process.env.DSH_PROFILE = "desktop";'),
    "DSH_PROFILE 兜底没写进去",
  );
  // 标记必须有（判 applied 靠它）
  assert.ok(out.text.includes("[dsh-purge-82]"), "标记没写进去，面板会一直显示 na");
  // 后面那个 region 必须原样保留，不能被吃掉
  assert.ok(
    out.text.includes("//#region ../../node_modules/.pnpm/mime@4.1.1/node_modules/mime/dist/types/other.js"),
    "原本跟在后面的 mime region 被吃掉了",
  );
  // 原文的 import 行还在（自匹配型，替换产物以它开头）
  assert.ok(out.text.includes(IMPORT_LINE.trimEnd()), "import 行本身丢了");
});

test("#82 幂等：打第二遍不变", () => {
  const fake = ["import WebSocket from \"ws\";\n", IMPORT_LINE, "const x = 1;\n"].join("");
  const once = applyReplacementsToText(fake, PATCH, "main.js");
  assert.equal(once.changed, true);
  const twice = applyReplacementsToText(once.text, PATCH, "main.js");
  assert.equal(twice.changed, false, "第二遍不该再动");
  assert.equal(twice.text, once.text);
});

test("#82 产物是合法 JS（插在 import 区里不能把语法搞坏）", async () => {
  const fs = await import("node:fs");
  const os = await import("node:os");
  const path = await import("node:path");
  const { execFileSync } = await import("node:child_process");

  const fake = [
    'import { createRequire } from "node:module";',
    IMPORT_LINE.trimEnd(),
    "//#region ../../packages/util/home-paths/lib/index.js",
    "const x = 1;",
    "export { x };",
    "",
  ].join("\n");

  const out = applyReplacementsToText(fake, PATCH, "main.js");
  assert.equal(out.changed, true);

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-p82-"));
  const fp = path.join(dir, "sample.mjs");
  try {
    fs.writeFileSync(fp, out.text, "utf8");
    // 真跑 node --check，不是靠断言糊过去
    assert.doesNotThrow(() => execFileSync(process.execPath, ["--check", fp], { stdio: "pipe" }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
