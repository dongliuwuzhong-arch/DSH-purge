# dsh-purge

**DSH 0.2.1-rc.3 compatibility fork · 1.1.97-dsh**

- Upstream: [YuJunZhiXue/dsh-purge](https://github.com/YuJunZhiXue/dsh-purge)
- This fork: [dongliuwuzhong-arch/dsh-purge-021rc2](https://github.com/dongliuwuzhong-arch/dsh-purge-021rc2)

`dsh-purge` is a prompt and host-patch plugin for a local DeepSeek Harness install. It adds a **Clean** dock beside the session title for managing prompts, rule sets, skills, and host patches. Nothing is written to the host until you explicitly apply it.

This repository is a compatibility fork of the upstream project, tracking DSH **0.2.1-rc.2 / rc.3**. It keeps the upstream patch system and injection flow, and maintains the host-version mappings, desktop path handling, backup/revert checks, and install notes. It is not a from-scratch replacement, and it does not hide where it came from.

## What it actually includes

### Session dock

The **dsh-purge** button beside the session title opens a right-hand dock. It currently has one page: **Clean**.

| Area | What it does |
| --- | --- |
| Patches | Grouped patch status, Apply, Restore, Uninstall |
| Prompt | Edit `prompt-inject.md` as the session override |
| Rule sets | Manage `AGENTS.md` / `CLAUDE.md` sets; enabling one writes under the current `$DSH_HOME` |
| Skills | Import a zip or folder into this host's official `skills/<id>/SKILL.md`; DSH owns matching and loading |
| Own servers | Register one IP or exact hostname per line in `net-scope-allow.txt` |
| Rewind | Undo one turn / undo the last round via the official `session.fork({ atSeq })` behavior; also `/rewind` |

### Prompt and rules

- The default inject text ships with the plugin and is embedded at build time. The host's prompt file on disk is not read.
- `prompt-inject.md` is a user file. Revert and uninstall keep it by default.
- Rule sets can be switched; they are written under `$DSH_HOME/rules/`.
- Workspace policy supports `strict` / `fallback` / `always`, controlling whether DSH's workspace baseline section is kept.
- Skills stay out of the inject section and do not replace the prompt. Uninstalling the plugin does not delete user-imported skills.

### Patches

- The patch table currently defines **82 patches**. Actual status is matched against the current host surface and reported as applied, pending, or skipped.
- Before the first apply, each target is backed up as `<file>.dshpurge.bak`; repeated applies are idempotent.
- **Restore** copies backups back and removes them. If a backup is missing, at least the plugin's shim lines are stripped.
- **Uninstall** restores applied patches first, then removes the inject file, rule library, and the plugin itself.
- If a target already carries patch markers, the plugin refuses to create a fake “identical” backup and names the file in status output.

### CLI and chat entry points

```sh
dsh-purge --status
dsh-purge --apply
dsh-purge --revert
dsh-purge --uninstall
dsh-purge --edit
dsh-purge --sync
```

```text
/purge status | apply | revert | uninstall | edit | help
/rules list | use <id> | create <id> | delete <id> | reset | help
/skills list | import <zip-or-folder> | create <id> [description] | delete <id> | help
/rewind
```

Model tools: `purge_status`, `purge_apply`, `purge_revert`.

## Compatibility

- Official desktop: DeepSeek Harness **0.2.1-rc.2 / 0.2.1-rc.3**
- Official Web: the 0.2 line of `dsh web`
- Node.js **>= 18**; **Node >= 22** is recommended on Windows to avoid console flashes
- Web and desktop are installed and applied separately, each with its own profile and `$DSH_HOME`
- 0.1.x is not supported; use the matching older upstream release for 0.1.7
- Community Desktop is not maintained

## Install

> This package is not on npm. `add dsh-purge` returns 404. Install from the repository archive, a local directory, or a manual copy.

### Official desktop

The ordinary `dsh` CLI refuses `--profile desktop`. Use the desktop CLI shipped inside the install directory:

```sh
NODE="<DSH install>/resources/runtime/primary-runtime/dependencies/node/bin/node.exe"
CLI="<DSH install>/resources/app/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js"

"$NODE" "$CLI" plugin --profile desktop add <this repo archive or main.tar.gz URL>
```

If the install still has `resources/app.asar`, replace `resources/app/` with `resources/app.asar/` in the paths above.

### Official Web

```sh
dsh plugin --profile web add <this repo archive or main.tar.gz URL>
```

### Manual install

1. Find the `$DSH_HOME` the running host actually uses. It must contain `profiles/`, and `profiles/<web|desktop>/package.json` must have `"name": "dsh-profile-web"` or `"dsh-profile-desktop"`.
2. Put the plugin at `$DSH_HOME/plugins/dsh-purge`. Both the folder name and `package.json` `"name"` must be `dsh-purge`.
3. Edit only that profile's `package.json`:
   - Add `"dsh-purge": "file:../../plugins/dsh-purge"` to `dependencies`.
   - Append `"dsh-purge"` to `dsh.profile.bundles`.
4. In that profile directory, run:

```sh
pnpm install
```

5. Fully quit and reopen the host, then click **dsh-purge → Clean → Apply**.

After install, the dock button should appear, and `/purge status` should print the current `DSH_HOME` and patch status.

## Order of use

1. Install and restart the host.
2. Open **dsh-purge → Clean** and check the patch groups and status.
3. Edit the prompt or rule set first if needed.
4. Click **Apply**. A successful apply restarts the host once so the patches enter the running process.
5. Start a new chat. Existing sessions do not automatically reload an older prompt.

> Adding the plugin to a profile does not patch the host by itself. **Apply** is explicit; the default configuration does not click it for you.

## Data and state

Runtime files live under `$DSH_HOME`:

- `prompt-inject.md` — user prompt
- `rules/` — rule sets
- `skills/` — user skills
- `net-scope-allow.txt` — own-server list
- `dsh-purge/` — plugin state, backup index, restart guard files

Plugin source lives at `$DSH_HOME/plugins/dsh-purge`. A profile's `node_modules/dsh-purge` is an install-time copy, not a link to the source; after editing source, run `dsh-purge --sync` or reinstall to update the runtime copy.

## Patch counts

There can be two sets of numbers, and that is not a bug:

- The desktop dock counts patches available on the desktop surface.
- `dsh-purge --status` defaults to the Web surface, where more patch definitions match.

Compare numbers only within one surface. When an optional package is not installed, its patches show as skipped and do not block the apply. A few `skipped` / `missing_file` rows on the current host are normal; the important number is **pending = 0**.

## Known boundaries

- It only touches local official `@deepseek-ai` packages, the local profile, and user override files under the harness home. It is not a public scanner and ships no attack payload.
- It does not edit third-party plugin source repos; for installed doctor / market / liangshen / mnemon it only makes best-effort runtime compatibility changes.
- The desktop app does not depend on the `dsh.cmd` shim; `original` or `missing` shim status does not affect chat.
- After a host upgrade, patches whose original text no longer matches show as skipped and are left unchanged.

## Upstream and license

- Upstream project: [YuJunZhiXue/dsh-purge](https://github.com/YuJunZhiXue/dsh-purge)
- This branch starts from upstream **1.1.71** and tracks compatibility with DSH 0.2.1-rc.2 / rc.3
- License: MIT, see [LICENSE](LICENSE)
- Copyright for upstream work remains with its authors and contributors; this repository is responsible only for the compatibility changes

If this fork saves you time, star the upstream project too.
