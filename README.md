# dsh-purge

**Prompt and host-patch plugin for DeepSeek Harness · 1.5.4**

Fork point `YuJunZhiXue/dsh-purge` 1.1.71 (MIT, repository no longer reachable); everything after it is maintained here

> 📚 **Chinese docs: [docs/zh/README.md](docs/zh/README.md)** — three books: handbook (do this), deep-dive (why), history (how it was verified back then, all numbers expired).

| Item | Value |
| --- | --- |
| Plugin version | 1.5.4 |
| Host baseline (pinned) | DSH 0.2.2-rc.5 |
| Patch table | 77 patches, max id 105 (plus 4 archived entries outside the count) |
| Tests | 356 tests |
| Fork point (repository no longer reachable) | `YuJunZhiXue/dsh-purge` 1.1.71 — credited for origin only |
| This repository | [dongliuwuzhong-arch/DSH-purge](https://github.com/dongliuwuzhong-arch/DSH-purge) |

## What it does

- **Dock page `Clean`**: grouped patch status, Apply / Restore / Uninstall, prompt override, rule sets, skill import, own-server list, rewind one turn.
- **Host patches**: 77 text replacements, all idempotent. Each target is backed up as `<file>.dshpurge.bak` before the first apply.
- **Persona injection**: the default inject text ships embedded in a sealed slot; `prompt-inject.md` is a user file and survives revert/uninstall.
- **Entry points**: `dsh-purge --status|--apply|--revert|--uninstall|--edit|--sync`, chat commands `/purge`, `/rules`, `/skills`, `/rewind`, and model tools `purge_status`, `purge_apply`, `purge_revert`.

## What it does not do

- **Not a network tool.** It only touches local official `@deepseek-ai` packages, the local profile, and override files under `$DSH_HOME`. No scanner, no payloads.
- **It does not edit third-party plugin repositories.** For installed doctor / market / liangshen / mnemon it only makes best-effort runtime compatibility changes.
- **It never clicks Apply for you.** Installing the plugin into a profile does not patch the host.
- **No patch table for old hosts.** 0.1.x is not supported by this repository; Community Desktop is not maintained.
- **No cross-surface arithmetic.** Web and desktop are installed and applied separately, each with its own profile and `$DSH_HOME`.

> 🔴 **Applied is not the same as effective.**
>
> The official desktop build seals host code in `resources\app.asar`, while patches can only be written into the unpacked `resources\app\`. Electron resolves `app.asar` → `app` → `default_app.asar`, so **while the asar exists the directory is never reached**.
>
> The only check that matters: does status still print an `app.asar` line saying 「还在。补丁写在解开目录，当前进程读不到」? That line means everything is idle. (The panel strings are Chinese-only; the harder check is `check-paths.mjs` — its first line must say 「宿主读的是解包目录」.)
> Self-heal after an upgrade has been automatic since 1.2.1 — see [handbook/04](docs/zh/handbook/04-宿主换包与解包态.md) (Chinese) and the mechanism essay in [history/SEALED-ASAR.md](docs/zh/history/SEALED-ASAR.md).

## Four gates — all must be green before you commit

| Gate | Command | What "correct" looks like |
| --- | --- | --- |
| Patch table | `node scripts/assert-patches.mjs` | `✓ 补丁表自检通过` |
| Persona layer | `node scripts/assert-soul-guard.mjs` | `soul-guard ok`, digest matches `soul-guard.lock` |
| Versions | `node scripts/assert-versions.mjs` | `✓ 四处一致：1.5.4` |
| Docs | `node scripts/assert-docs.mjs` | six numeric classes plus the class-7 command smoke. All green → **last** line `七类全绿。` (all three smoke commands really ran); if any smoke step was skipped the last line says `六类全绿；第 7 类命令冒烟跳过 N 条（未核）` — skipped is not passed. The second-to-last line tells you which smoke commands ran |

These are what make a wrong doc go red: banned words, drifted line references, patch counts, test counts, five version sites. Boundaries of each gate: [deep-dive/03](docs/zh/deep-dive/03-工程与发版.md).

## Install — pick one of three ways

> This package is not on npm; `add dsh-purge` returns 404. Install from the repository archive, a local directory, or a manual copy.

### 1. Offline installer (recommended)

No pnpm, no network, no automatic apply:

```bash
node scripts/install-offline.mjs --profile desktop --dsh-home "$HOME/.dsh" --dry-run
node scripts/install-offline.mjs --profile desktop --dsh-home "$HOME/.dsh"
node scripts/install-offline.mjs --verify --profile desktop --dsh-home "$HOME/.dsh"
```

What correct looks like: `--dry-run` prints five `[dry-run]` lines (source / target / profile / would-copy / would-write) when the profile already lists the plugin, and six on a first install — the extra one is `would update package.json`. Nothing is written either way. The real run backs the profile up first and says so — `profile backup: <profile package.json>.dsh-purge.<ts>.bak` — then `installed dsh-purge@<version>` plus four lines (plugin / profile / node_modules link / not running pnpm…).

`--verify` accepts **both** forms and exits 0 for both; its first line is always `verified <plugin version>`. A junction must resolve to the plugin source — pointing elsewhere fails with `链接指向别处 / link points elsewhere` and exits 1. A real copy (`--sync` filled a real directory) is checked as itself: package name `dsh-purge`, the required files, its own version. A copy whose version trails the source only turns the second line into `实体副本 / copy（副本 A，源码 B …）` instead of `（与源码同版本 B）` — a `sync-runtime --apply` reminder, not a broken install.

It does five things: validate the package, copy to `$DSH_HOME/plugins/dsh-purge`, update the profile `package.json`, link `node_modules/dsh-purge`, write `desktop-install.txt`. It does **not** run pnpm, Apply, or restart the host.

### 2. Official CLI (needs network)

The ordinary `dsh` CLI refuses `--profile desktop`; use the desktop CLI shipped inside the install directory:

```bash
NODE="<DSH install>/resources/runtime/primary-runtime/dependencies/node/bin/node.exe"
CLI="<DSH install>/resources/app/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js"

"$NODE" "$CLI" plugin --profile desktop add <repo archive or main.tar.gz URL>
```

For the web surface: `dsh plugin --profile web add <same>`. If the install still has `resources/app.asar`, replace `resources/app/` with `resources/app.asar/` in the paths above.

### 3. Manual

1. Find the `$DSH_HOME` the running host actually uses: it must contain `profiles/`, and `profiles/<web|desktop>/package.json` must have `"name": "dsh-profile-web"` or `"dsh-profile-desktop"`.
2. Put the plugin at `$DSH_HOME/plugins/dsh-purge`; folder name and `package.json` `"name"` must both be `dsh-purge`.
3. Edit only that profile's `package.json`: add `"dsh-purge": "file:../../plugins/dsh-purge"` to `dependencies`, append `"dsh-purge"` to `dsh.profile.bundles`.
4. Create the link on Windows:

```powershell
New-Item -ItemType Junction -Path "$env:USERPROFILE\.dsh\profiles\desktop\node_modules\dsh-purge" -Target "$env:USERPROFILE\.dsh\plugins\dsh-purge"
```

5. Fully quit and reopen the host, then click **dsh-purge → Clean → Apply**.

What correct looks like: the dock button appears, and `/purge status` prints the current `$DSH_HOME` plus patch status.

## Where things live

| Path | Contents |
| --- | --- |
| `docs/zh/handbook/` | Operations manual: install, verify, daily checks, backup, revert, host swap, persona injection, troubleshooting, one-page runbook |
| `docs/zh/deep-dive/` | Mechanism: [patch table](docs/zh/deep-dive/01-补丁表.md), [judgments and state machine](docs/zh/deep-dive/02-判据与状态机.md), [engineering and release](docs/zh/deep-dive/03-工程与发版.md), [per-patch inventory (77 rows)](docs/zh/deep-dive/04-补丁清单.md), [the web surface](docs/zh/deep-dive/05-web面.md) |
| `docs/zh/history/` | Archive: nine audits, the 0.2.1 compatibility effort, the sealed-asar essay, the old patch doc. **Every number there is expired** |
| `lib/` | Implementation: `patches.js` (main table), `patches-legacy.js` (archive), `core.js` (judgments and IO), `sealed-heal.js` (self-heal decision) |
| `scripts/` | Gates and tools: four `assert-*` gates, `preflight-upgrade.mjs`, `install-offline.mjs` |
| `test/` | 53 test files, 356 tests |

## Three lessons that actually bite

1. **A backup can be eaten by its own judgment.** Before 1.3.3, `inspectStaleBaks` could refresh a `.dshpurge.bak` into the *patched* bytes; revert then decided "nothing changed" and skipped — the panel looked complete and nothing could be rolled back.
2. **`applied` is not the same as effective.** The target of #17 sits behind `disabled: true` in the host's own config, so the plugin never assembles; #73 once faked `applied` by sharing a marker with #70.
3. **Wait for the host to exit before unsealing.** Renaming `app.asar` while the host runs always hits EBUSY, and a hard kill leaves a child-process handle behind.

## Data and state

Runtime files under `$DSH_HOME`: `prompt-inject.md`, `rules/`, `skills/`, `net-scope-allow.txt`, `dsh-purge/` (plugin state, backup index, `exclude-patches.json`, `asar-swap.json`).

Plugin source lives at `$DSH_HOME/plugins/dsh-purge`; a profile's `node_modules/dsh-purge` is either a junction (created by the offline installer) or a real copy (`--sync` fills a real directory). `--verify` passes for both — a junction must point at the source, a real copy is judged as itself. When you want byte-level sameness rather than install validity, use `sync-runtime` + `check-paths`.

## Source and license

- **Fork point**: `YuJunZhiXue/dsh-purge` **1.1.71** (MIT). That repository is **no longer reachable**; the fork point is recorded here for provenance.
- **License**: MIT — see [LICENSE](LICENSE). Original copyright stays with the authors and contributors of the work above; this repository is responsible only for its own changes.
- **This repository is now the source of truth.** As of 1.5.4 there is no external release to follow: the host baseline, the patch table, the judgments and the doc split are all decided here, and the docs describe exactly this tree.
