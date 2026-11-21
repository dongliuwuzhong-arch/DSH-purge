import path from "node:path";
import os from "node:os";

/**
 * 候选路径归一（V15 收 · F3）。
 *
 * 病：环境变量 / 配置文件 / 命令行里躺着**没展开的**占位符（%SystemDrive%、%INSTALL_DIR%、
 * $env:DSH_HOME ...）时，它会被 path.join / path.resolve 当成普通相对路径，于是往 cwd
 * 底下写出一个名字就叫 `%SystemDrive%` 的目录（实测：ProgramData 缓存被整棵复制进去）。
 * .gitignore 把这几行藏起来只是把症状盖住，病灶是"任何字符串都敢当路径用"。
 *
 * 这里的规矩：
 *   1 含 %VAR% / $env:VAR / $VAR 的段，能展开就展开（只认环境里真有的变量）；
 *   2 展不开的（%INSTALL_DIR% 这种我们自己的脱敏占位符、或用户写错的名字）**一律 reject**，
 *     返回空串而不是猜一个目录；
 *   3 reject 的原因要能说出来，别静默吞掉——调用方拿 reason 去打一行日志。
 *
 * 只做判定与展开，不碰文件系统：这个模块必须能在任何进程里被 import（包括纯 node CLI）。
 */

/**
 * 认三种占位形态：%NAME%、$env:NAME、${NAME}、$NAME。
 *
 * 裸 $NAME 只认全大写（$DSH_HOME / $USERPROFILE）：Windows 上还有 $Recycle.Bin 这种
 * **真目录名**，把任意 $xxx 都当占位符会误伤它们。
 */
const VAR_TOKEN = /%([A-Za-z_][A-Za-z0-9_().]*?)%|\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$env:([A-Za-z_][A-Za-z0-9_]*)|\$([A-Z][A-Z0-9_]*)/g;

/** 补几个 Windows 上常见但我们不一定从 env 里拿得到的值。 */
function ambientVars() {
  const out = {};
  try {
    out.USERPROFILE = os.homedir();
    out.HOME = os.homedir();
  } catch {
    /* ignore */
  }
  try {
    const root = path.parse(process.cwd()).root.replace(/[\\/]+$/, "");
    out.SystemDrive = root;
    out.HOMEDRIVE = root;
    out.ProgramData = path.join(root + path.sep, "ProgramData");
    out.ProgramFiles = path.join(root + path.sep, "Program Files");
    out["ProgramFiles(x86)"] = path.join(root + path.sep, "Program Files (x86)");
  } catch {
    /* ignore */
  }
  return out;
}

function envLookup(name, env) {
  if (!name) return "";
  if (Object.prototype.hasOwnProperty.call(env, name)) return String(env[name] ?? "");
  const lower = name.toLowerCase();
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === lower) return String(env[key] ?? "");
  }
  return "";
}

/**
 * 第一个没展开的占位符 token（没有就返回空串）。
 *
 * "展开成功"必须是**展开到底**：环境里如果写着 DSH_HOME="%USERPROFILE%\\.dsh"（用户在系统变量里
 * 套了一层），一次展开拿到的还是 %USERPROFILE% —— 那就仍然不是路径。所以这里做的是
 * "多轮展开之后还有没有 token"，而不是"环境里有没有这个键"。
 */
export function findUnresolvedVarToken(value, { env = process.env } = {}) {
  const text = String(value ?? "");
  if (!text) return "";
  const left = expandUntilStable(text, env);
  VAR_TOKEN.lastIndex = 0;
  const hit = VAR_TOKEN.exec(left);
  VAR_TOKEN.lastIndex = 0;
  return hit ? hit[0] : "";
}

/** 反复展开直到不再变化（最多 8 轮；值里互相指向时不会死循环）。 */
function expandUntilStable(text, env) {
  const ambient = ambientVars();
  let cur = String(text ?? "");
  for (let i = 0; i < 8; i += 1) {
    VAR_TOKEN.lastIndex = 0;
    const next = cur.replace(VAR_TOKEN, (whole, pct, brace, shell, bare) => {
      const name = pct || brace || shell || bare || "";
      const hit = envLookup(name, env) || envLookup(name, ambient);
      return hit || whole;
    });
    if (next === cur) return cur;
    cur = next;
  }
  return cur;
}

/** 这段字符串里还有没有占位符（不管能不能展开）。 */
export function hasVarToken(value) {
  const text = String(value ?? "");
  VAR_TOKEN.lastIndex = 0;
  const hit = VAR_TOKEN.test(text);
  VAR_TOKEN.lastIndex = 0;
  return hit;
}

/** 便利判定：含占位符且在环境里展不开 = 不能当路径用。 */
export function isUnresolvedVarPath(value, opts = {}) {
  return Boolean(findUnresolvedVarToken(value, opts));
}

/** 把能展开的占位符全部展开；展不开的原样留着（交给 resolveCandidatePath 去 reject）。 */
export function expandVarPath(value, { env = process.env } = {}) {
  return expandUntilStable(value, env);
}

/**
 * 把一个候选字符串归一成绝对路径。
 * 返回 { path, rejected, reason, token, expanded }：
 *   path 为空 + rejected=true 表示"这个候选不能用"，reason 是给人看的一句话。
 */
export function resolveCandidatePath(value, { env = process.env, cwd = "", allowRelative = true } = {}) {
  const raw = String(value ?? "").trim();
  if (!raw) return { path: "", rejected: true, reason: "empty", token: "", expanded: false };
  const token = findUnresolvedVarToken(raw, { env });
  if (token) {
    return {
      path: "",
      rejected: true,
      reason: "变量 " + token + " 没展开，不当路径用（脱敏占位符 / 拼错的变量名都走这条）",
      token,
      expanded: false,
    };
  }
  const expanded = expandVarPath(raw, { env });
  const expandedNow = expanded !== raw;
  const absolute = path.isAbsolute(expanded);
  if (!absolute && !allowRelative) {
    return { path: "", rejected: true, reason: "不是绝对路径：" + raw, token: "", expanded: expandedNow };
  }
  let base = cwd;
  if (!base) {
    try {
      base = process.cwd();
    } catch {
      base = "";
    }
  }
  const resolved = absolute || !base ? path.normalize(expanded) : path.resolve(base, expanded);
  const left = findUnresolvedVarToken(resolved, { env });
  if (left) {
    return { path: "", rejected: true, reason: "归一之后仍有没展开的变量（" + left + "）：" + resolved, token: left, expanded: expandedNow };
  }
  return { path: resolved, rejected: false, reason: "", token: "", expanded: expandedNow };
}

/**
 * 给"要直接递给 fs 的路径"用的严格版：**带任何占位符都 reject**，哪怕环境里能展开。
 *
 * 区别在语义，不在洁癖：%USERPROFILE%\\.dsh 这类串交给 fs.existsSync 也不会展开，
 * 它只是一个名字很怪、根本不存在的位置。猜一个目录出来比直接说不认识更危险。
 */
export function resolveLiteralPath(value, opts = {}) {
  const raw = String(value ?? "").trim();
  if (!raw) return { path: "", rejected: true, reason: "empty", token: "", expanded: false };
  if (hasVarToken(raw)) {
    VAR_TOKEN.lastIndex = 0;
    const hit = VAR_TOKEN.exec(raw);
    VAR_TOKEN.lastIndex = 0;
    const token = hit ? hit[0] : "";
    return {
      path: "",
      rejected: true,
      reason: "含占位符 " + (token || "（?）") + " 的串不能直接当路径用（fs 不会替你展开）",
      token,
      expanded: false,
    };
  }
  return resolveCandidatePath(raw, opts);
}

/** 批量版：只留能用的（顺带去重，大小写不敏感）。 */
export function filterCandidatePaths(list, opts = {}) {
  const out = [];
  const seen = new Set();
  for (const item of list || []) {
    const verdict = resolveCandidatePath(item, opts);
    if (verdict.rejected || !verdict.path) continue;
    const key = verdict.path.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(verdict.path);
  }
  return out;
}

/** reject 掉的那些，给日志用（"谁被挡了、为什么"）。 */
export function rejectedCandidatePaths(list, opts = {}) {
  const out = [];
  for (const item of list || []) {
    const verdict = resolveCandidatePath(item, opts);
    if (verdict.rejected && String(item ?? "").trim()) out.push({ value: String(item), reason: verdict.reason });
  }
  return out;
}
