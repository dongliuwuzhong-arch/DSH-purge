import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  upgradeMarkerPath, legacyUpgradeMarkerPath, upgradeMarkerExists, clearUpgradeMarker,
} from "../lib/official-update.js";

// 1.1.100 · 2026-10-30 真升级实测之后
// NSIS 升级会把整个安装目录清一遍，标记写在 resources 里等于没写：
// 刚落下就被同一场清空吞掉，下次启动看不到，自愈链等于没跑。

function fakeInstall() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "purge-upd-"));
  const exe = path.join(root, "DeepSeek Harness.exe");
  fs.writeFileSync(exe, "");
  fs.mkdirSync(path.join(root, "resources"), { recursive: true });
  return { root, exe };
}

test("升级标记不能在安装目录里", () => {
  const { root, exe } = fakeInstall();
  const marker = upgradeMarkerPath(exe);
  assert.ok(marker, "应该给得出路径");
  assert.equal(marker.toLowerCase().startsWith(root.toLowerCase()), false, "标记落在了安装目录里：" + marker);
  fs.rmSync(root, { recursive: true, force: true });
});

test("DSH_HOME 指哪儿，标记就落哪儿", () => {
  const { root, exe } = fakeInstall();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "purge-home-"));
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    const marker = upgradeMarkerPath(exe);
    assert.equal(marker.toLowerCase(), path.join(home, "dsh-purge", "reapply-asar.pending").toLowerCase());
  } finally {
    if (prev === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prev;
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("老标记（安装目录里那份）仍然认得，且能一起清掉", () => {
  const { root, exe } = fakeInstall();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "purge-home-"));
  const prev = process.env.DSH_HOME;
  process.env.DSH_HOME = home;
  try {
    const legacy = legacyUpgradeMarkerPath(exe);
    fs.writeFileSync(legacy, "1");
    assert.equal(upgradeMarkerExists(exe), true, "老位置的标记必须仍然生效");

    const fresh = upgradeMarkerPath(exe);
    fs.mkdirSync(path.dirname(fresh), { recursive: true });
    fs.writeFileSync(fresh, "1");
    assert.equal(upgradeMarkerExists(exe), true);

    clearUpgradeMarker(exe);
    assert.equal(fs.existsSync(fresh), false, "新标记应被清掉");
    assert.equal(fs.existsSync(legacy), false, "老标记也应被清掉");
    assert.equal(upgradeMarkerExists(exe), false);
  } finally {
    if (prev === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = prev;
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test("不是官方 Harness 的 exe 一律不给标记路径", () => {
  assert.equal(upgradeMarkerPath("C:/x/other.exe"), "");
  assert.equal(upgradeMarkerExists("C:/x/other.exe"), false);
});
