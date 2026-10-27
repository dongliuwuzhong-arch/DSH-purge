import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const BAK_SUFFIX = ".dshpurge.bak";

function stampName(now = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/**
 * 卸载后宿主不该还留着一个指向空气的破甲预设：.agent-presets/redteam 里的
 * anchor-gate.mjs / agent.cordis.yml 都是插件带来的。只改名不删除，反悔就挪回来。
 * 停用（disable）不走这里 —— 停用是暂时的，预设得留着。
 */
export function relocateRedteamPreset(dshHome, now = new Date()) {
  const presetsDir = path.join(dshHome, ".agent-presets");
  const from = path.join(presetsDir, "redteam");
  if (!fs.existsSync(from)) return { moved: false, reason: "absent", from };
  const disabledDir = path.join(presetsDir, ".disabled");
  fs.mkdirSync(disabledDir, { recursive: true });
  let to = path.join(disabledDir, "redteam");
  if (fs.existsSync(to)) to = path.join(disabledDir, "redteam-" + stampName(now));
  fs.renameSync(from, to);
  return { moved: true, from, to };
}

/**
 * 卸载时把还剩下的 *.dshpurge.bak 记成清单。插件没了这份清单也看得懂：
 * 哪个原文件、多大、什么时候、sha256 多少 —— 将来要还原或要清理都有据可查。
 * 只写清单，不动文件。
 */
export function writeBakManifest(aiBase, dshHome, extra = {}) {
  const out = path.join(dshHome, "dsh-purge-bak-manifest.json");
  const rows = [];
  const walk = (dir, depth) => {
    if (depth > 10) return;
    let ents = [];
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      if (e.isDirectory()) {
        if (e.name === "node_modules" || e.name === ".git") continue;
        walk(path.join(dir, e.name), depth + 1);
        continue;
      }
      if (!e.name.endsWith(BAK_SUFFIX)) continue;
      const bak = path.join(dir, e.name);
      const row = {
        original: bak.slice(0, -BAK_SUFFIX.length),
        bak,
        size: null,
        mtime: null,
        sha256: null,
      };
      row.originalExists = fs.existsSync(row.original);
      try {
        const st = fs.statSync(bak);
        row.size = st.size;
        row.mtime = st.mtime.toISOString();
      } catch {
        /* 读不到就留 null，清单照样生成 */
      }
      try {
        row.sha256 = crypto.createHash("sha256").update(fs.readFileSync(bak)).digest("hex");
      } catch {
        /* 同上 */
      }
      rows.push(row);
    }
  };
  if (aiBase && fs.existsSync(aiBase)) walk(aiBase, 0);
  const payload = { generatedAt: new Date().toISOString(), aiBase: aiBase || null, count: rows.length, ...extra, backups: rows };
  fs.writeFileSync(out, JSON.stringify(payload, null, 2));
  return { path: out, count: rows.length };
}
