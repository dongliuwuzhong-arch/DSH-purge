import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// 2026-11-22（V15 收 · 文档审计 S1-2）：
// `install-offline --verify` 以前只认"链接"形态（realpath(node_modules/dsh-purge) ===
// realpath(plugins/dsh-purge)），而同一套文档自己写着"profile 里的 node_modules/dsh-purge
// 是安装期**副本**，不是链接"。于是实体副本的机器上 --verify 必红，红的原因还写着
// "link points elsewhere"，指向一个不存在的错误。
// 现在的判据：链接形态 → 指向别处才红；实体副本 → 是完整可用的一份 dsh-purge 就通过。

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, "..", "scripts", "install-offline.mjs");
const NODE = process.execPath;

function write(file, body) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body, "utf8");
}

/** 一份最小可用的 dsh-purge 目录（verify 只核这几个文件 + package.json）。 */
function putPlugin(dir, version = "1.5.0") {
  write(path.join(dir, "package.json"), JSON.stringify({ name: "dsh-purge", version, main: "lib/index.js" }));
  write(path.join(dir, "cordis.patch.yml"), "# patch table\n");
  write(path.join(dir, "client.js"), "export const client = true;\n");
  write(path.join(dir, "lib", "index.js"), "export const loaded = true;\n");
  write(path.join(dir, "lib", "core.js"), "export const core = true;\n");
}

function sandbox(tag) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "purge-verify-" + tag + "-"));
  putPlugin(path.join(home, "plugins", "dsh-purge"));
  const profile = path.join(home, "profiles", "desktop");
  write(path.join(profile, "package.json"), JSON.stringify({
    name: "profile-desktop",
    dependencies: { "dsh-purge": "file:../../plugins/dsh-purge" },
    dsh: { profile: { bundles: ["dsh-purge"] } },
  }));
  return { home, profile, plugin: path.join(home, "plugins", "dsh-purge") };
}

function runVerify(home) {
  const env = { ...process.env, DSH_HOME: home };
  delete env.DSH_SURFACE;
  delete env.DSH_DESKTOP_INSTALL;
  const res = spawnSync(NODE, [SCRIPT, "--verify", "--dsh-home", home], { encoding: "utf8", env, timeout: 120000 });
  return { code: res.status, out: String(res.stdout || "") + String(res.stderr || "") };
}

test("实体副本（本机真实形态）：--verify 通过，并明说「实体副本 / copy」", () => {
  const box = sandbox("copy");
  try {
    const modulePath = path.join(box.profile, "node_modules", "dsh-purge");
    fs.mkdirSync(path.dirname(modulePath), { recursive: true });
    fs.cpSync(box.plugin, modulePath, { recursive: true });

    const res = runVerify(box.home);
    assert.equal(res.code, 0, res.out);
    assert.match(res.out, /verified 1\.5\.0/);
    assert.match(res.out, /实体副本 \/ copy/);
    assert.match(res.out, /plugin: /);
    assert.match(res.out, /profile: /);
  } finally {
    fs.rmSync(box.home, { recursive: true, force: true });
  }
});

test("副本版本落后时仍然通过，但把差异说出来（对齐是 sync-runtime 的事，不是装坏了）", () => {
  const box = sandbox("drift");
  try {
    const modulePath = path.join(box.profile, "node_modules", "dsh-purge");
    fs.cpSync(box.plugin, modulePath, { recursive: true });
    putPlugin(modulePath, "1.4.4");

    const res = runVerify(box.home);
    assert.equal(res.code, 0, res.out);
    assert.match(res.out, /副本 1\.4\.4/);
    assert.match(res.out, /源码 1\.5\.0/);
  } finally {
    fs.rmSync(box.home, { recursive: true, force: true });
  }
});

test("副本缺必需文件 → 红（「是副本」不等于「随便一个目录都算」）", () => {
  const box = sandbox("broken");
  try {
    const modulePath = path.join(box.profile, "node_modules", "dsh-purge");
    fs.cpSync(box.plugin, modulePath, { recursive: true });
    fs.rmSync(path.join(modulePath, "lib", "index.js"), { force: true });

    const res = runVerify(box.home);
    assert.equal(res.code, 1, res.out);
    assert.match(res.out, /缺文件|missing/);
  } finally {
    fs.rmSync(box.home, { recursive: true, force: true });
  }
});

test("链接指向别处 → 红（这才是真错，措辞要说清是链接不是副本）", () => {
  const box = sandbox("link");
  const other = fs.mkdtempSync(path.join(os.tmpdir(), "purge-verify-other-"));
  try {
    putPlugin(other);
    const modulePath = path.join(box.profile, "node_modules", "dsh-purge");
    fs.mkdirSync(path.dirname(modulePath), { recursive: true });
    fs.symlinkSync(other, modulePath, process.platform === "win32" ? "junction" : "dir");

    const res = runVerify(box.home);
    assert.equal(res.code, 1, res.out);
    assert.match(res.out, /链接指向别处|link points elsewhere/);
  } finally {
    fs.rmSync(box.home, { recursive: true, force: true });
    fs.rmSync(other, { recursive: true, force: true });
  }
});

test("链接指向源码（正常安装）→ 通过", () => {
  const box = sandbox("selflink");
  try {
    const modulePath = path.join(box.profile, "node_modules", "dsh-purge");
    fs.mkdirSync(path.dirname(modulePath), { recursive: true });
    fs.symlinkSync(box.plugin, modulePath, process.platform === "win32" ? "junction" : "dir");

    const res = runVerify(box.home);
    assert.equal(res.code, 0, res.out);
    assert.match(res.out, /链接 \/ link/);
  } finally {
    fs.rmSync(box.home, { recursive: true, force: true });
  }
});

test("--check-deps：只读自检，输出 files ok / result ok", () => {
  const box = sandbox("deps");
  try {
    const env = { ...process.env, DSH_HOME: box.home };
    const res = spawnSync(NODE, [SCRIPT, "--check-deps", "--dsh-home", box.home], { encoding: "utf8", env, timeout: 120000 });
    const out = String(res.stdout || "") + String(res.stderr || "");
    assert.equal(res.status, 0, out);
    assert.match(out, /check-deps/);
    assert.match(out, /files   ok/);
    assert.match(out, /result  ok/);
  } finally {
    fs.rmSync(box.home, { recursive: true, force: true });
  }
});
