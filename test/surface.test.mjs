import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  SURFACES,
  adapterFor,
  detectSurface,
  isCommunityElectronHost,
  isDesktopSurface,
  pathLooksDesktop,
} from "../lib/surface.js";

const ELECTRON = { electron: "30.0.0" };

test("官方桌面端照旧判 desktop", () => {
  assert.equal(detectSurface({ execPath: "C:/Software/DSH/DSH Desktop.exe", env: {}, versions: ELECTRON, argv: [] }), "desktop");

  // resources 目录下有 app/dsh 才判 desktop —— 用临时目录造，不依赖跑测试的机器上装没装宿主。
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-surface-"));
  try {
    const resources = path.join(tmp, "resources");
    fs.mkdirSync(path.join(resources, "app", "dsh"), { recursive: true });
    assert.equal(
      detectSurface({ execPath: "/usr/bin/node", resourcesPath: resources, env: {}, versions: ELECTRON, argv: [] }),
      "desktop",
      "resources 目录下真有 app/dsh 也该判 desktop",
    );
    const empty = path.join(tmp, "empty-resources");
    fs.mkdirSync(empty, { recursive: true });
    assert.equal(
      detectSurface({ execPath: "/usr/bin/node", resourcesPath: empty, env: {}, versions: ELECTRON, argv: [] }),
      "web",
      "空 resources 目录不该判 desktop",
    );
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("社区 Electron 端认得出来（ds-bot / dsh-next / deepseek-bot）", () => {
  for (const [execPath, resourcesPath] of [
    ["C:/x/dsh-next.exe", ""],
    ["C:/x/dsbot.exe", ""],
    ["C:/Program Files/DeepSeek Bot/DeepSeek Bot.exe", ""],
    ["/usr/bin/node", "C:/x/dsh-next/resources"],
  ]) {
    const input = { execPath, resourcesPath, env: {}, versions: ELECTRON, argv: [] };
    assert.equal(isCommunityElectronHost(input), true, execPath + " 应被认成社区端");
    assert.equal(detectSurface(input), "desktop", execPath + " 应判 desktop");
  }
});

test("宽判据只在 electron 存在时生效——纯 node 拿社区路径仍判 web", () => {
  const input = { execPath: "C:/x/dsh-next.exe", env: {}, versions: { node: "24.21.0" }, argv: [] };
  assert.equal(isCommunityElectronHost(input), false);
  assert.equal(isDesktopSurface(input), false);
  assert.equal(detectSurface(input), "web");
});

test("DSH_SURFACE 仍然优先于一切路径判据", () => {
  assert.equal(detectSurface({ execPath: "C:/Software/DSH/DSH Desktop.exe", env: { DSH_SURFACE: "web" }, versions: ELECTRON, argv: [] }), "web");
  assert.equal(detectSurface({ execPath: "/usr/bin/node", env: { DSH_SURFACE: "desktop" }, versions: {}, argv: [] }), "desktop");
  assert.equal(detectSurface({ execPath: "/usr/bin/node", env: { DSH_SURFACE: "tui" }, versions: {}, argv: [] }), "tui");
  assert.equal(detectSurface({ execPath: "/usr/bin/node", env: { DSH_SURFACE: "nonsense" }, versions: {}, argv: [] }), "web");
});

test("adapterFor 只给 desktop 开 desktop 适配，gui/tui 回退 web", () => {
  assert.equal(adapterFor("desktop"), "desktop");
  for (const k of ["web", "gui", "tui", "", undefined]) assert.equal(adapterFor(k), "web");
  assert.deepEqual([...SURFACES], ["web", "desktop", "gui", "tui"]);
});

test("pathLooksDesktop 不把源码仓库当安装目录", () => {
  assert.equal(pathLooksDesktop("C:/Users/x/code/deepseek-harness/lib/core.js"), false);
  assert.equal(pathLooksDesktop("C:/Users/x/code/deepseek-harness/resources/app/dsh"), true);
  assert.equal(pathLooksDesktop("C:/Software/DSH/resources/app/dsh"), false, "DSH 这个目录名本身不带 harness，靠 exe/resources 才判");
});
