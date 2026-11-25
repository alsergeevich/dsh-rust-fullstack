# Rust Fullstack Elite for DSH

A Host-only DeepSeek Harness plugin that detects when you are working in Rust and automatically activates an elite, docs-first Rust full-stack skill covering **Rust, Axum, Leptos, Dioxus, SQLx, PostgreSQL, and SQLite**.

The skill is bundled with the plugin, installed into the global DSH skills directory, and can be refreshed from official sources. It is intentionally a working standard, not a pile of links: architecture defaults, version/MSRV rules, production checklists, review rubric, and anti-patterns are all included.

## What it does

- **Language-aware activation** — scores the user request and tool activity for Rust evidence (`.rs` paths, `Cargo.toml`, `cargo` commands, Rust syntax, Axum/Leptos/Dioxus/SQLx mentions, project context). Activates once per session at a configurable threshold.
- **Automatic skill injection** — appends a canonical `<skill_content name="rust-fullstack-elite">` message in `agent/pre-step`, after other pre-step handlers, using the same durable shape as DSH's `/skill` invocation.
- **Project awareness** — injects a compact `<rust_project_context>` block: Cargo root, package, edition, `rust-version`, toolchain, workspace members, frameworks, databases, lockfile versions, migrations, and Rust file count.
- **Global + bundled skill** — installs the skill into `$DSH_HOME/skills/rust-fullstack-elite` (editable), while retaining a bundled copy for recovery and installs where the global directory is unavailable.
- **Freshness checks** — queries official sources (crates.io, GitHub releases, PostgreSQL, SQLite) and writes `versions.json` / `versions.md`; stale data is surfaced in status and can be refreshed on a daily schedule.
- **Self-updating skill pack** — downloads a signed-by-index skill pack from a GitHub release, validates path safety, size limits, and SHA-256 for every file, backs up the current global skill, and refuses to overwrite user edits unless forced.
- **Five tools** for the model: status, freshness check, skill-pack update, official-docs fetch, and Cargo project scan.
- **No DSH imports, no build step** — the plugin uses only Node built-ins and registered DSH services/events, so it works in the profile and desktop installations.

## Requirements

- DeepSeek Harness `>=0.2.0-rc.1 <0.3.0-0` (tested against `0.2.2-rc.5`).
- Node `^22.19.0 || >=24.0.0` (whatever the running DSH uses).
- `git` and `pnpm` are required only for installing from GitHub; local-directory installs need neither.

## Install

### From GitHub (recommended for other PCs / Desktop DSH)

Current release: [`v0.1.2`](https://github.com/alsergeevich/dsh-rust-fullstack/releases/tag/v0.1.2).

Use a full 40-character commit SHA so the installed artifact is reproducible and updatable:

```text
https://github.com/alsergeevich/dsh-rust-fullstack.git#<40-char-commit>
```

In DSH, install with `plugin_manager` action `install_bundle` and that spec as `target`. A repo URL without a commit is accepted for installation but **cannot be updated** by `plugin_manager`; prefer the pinned form.

### From a local checkout (development)

```text
plugin_manager install_bundle target=F:\path\to\dsh-rust-fullstack
```

The plugin is Host-only. After installation, DSH applies it live when HMR is available; otherwise restart DSH.

### Verify

1. The plugin appears in the plugin list with the Rust Fullstack Elite title.
2. Ask: `Implement an Axum + SQLx endpoint in src/main.rs`.
3. The response should include a short “Rust work detected … rust-fullstack-elite is now active” preamble and the skill content.
4. Run `rust_skill_status` to inspect the global skill, freshness data, and project scan.

## Configuration

The bundle patch sets defaults; override them in the plugin row's `config` in the profile patch (or via your DSH plugin configuration surface). Do not hand-edit unrelated profile files.

| Key | Default | Meaning |
|---|---|---|
| `autoActivate` | `true` | Enable automatic skill activation. |
| `activationThreshold` | `60` | Score 1–100 required for activation. Higher = more conservative. |
| `installGlobalSkill` | `true` | Copy the bundled skill into `$DSH_HOME/skills/rust-fullstack-elite`. |
| `autoCheck` | `"daily"` | `off`, `daily`, or `weekly` background freshness check. |
| `autoUpdate` | `"skill"` | `off` or `skill` (only the skill pack; the plugin's JavaScript is never self-replaced). |
| `checkTtlHours` | `24` | Freshness TTL, 1–720 hours. |
| `maxInjectionChars` | `24000` | Cap for the activation payload, 4000–200000. |
| `githubRepo` | `alsergeevich/dsh-rust-fullstack` | Release and raw-pack source. |
| `skillName` | `rust-fullstack-elite` | Must stay kebab-case; changing it also changes the global directory. |
| `globalSkillDir` | `""` | Optional absolute override for the global skill directory. |
| `docsCacheTtlHours` | `24` | `rust_docs` cache TTL. |

## Tools

| Tool | Side effects | Purpose |
|---|---|---|
| `rust_skill_status` | Read-only | Plugin/skill/global drift, freshness, current project. |
| `rust_skill_check` | Writes `versions.json`/`versions.md` | Check official version sources; optionally verify docs URLs. |
| `rust_skill_update` | Writes global skill (asks first) | Validate and apply a skill pack from a GitHub release. |
| `rust_docs` | Writes a bounded cache | Fetch an allowlisted official documentation page. |
| `rust_project_scan` | Read-only | Scan a Cargo project. |

`rust_skill_update` is guarded by `tools/pre-execute`: non-dry-run calls require approval. Remote content is restricted to `SKILL.md`, Markdown, JSON, and text-like files; the pack index rejects absolute paths, `..`, backslashes, colons, control characters, oversized files, and more than 200 files / 8 MiB total.

## The skill

`skill/SKILL.md` is the entry point. It contains:

- a docs-first operating protocol and version contract;
- non-negotiables (error handling, I/O timeouts, SQL parameterization, migrations, secrets, `unsafe`, tests);
- a 2026-11-25 version/MSRV baseline;
- stack decisions and a routing table;
- architecture, Axum, persistence, UI, security, observability, testing, and deployment guidance;
- a review rubric and anti-pattern list.

References (loaded selectively):

```text
skill/references/
  rust-core.md              axum.md                  leptos.md
  dioxus.md                 sqlx.md                  postgres.md
  sqlite.md                 fullstack-architecture.md
  testing.md                security.md              observability.md
  deployment.md             checklists.md            antipatterns.md
```

`skill/sources.md` lists the official documentation used for each area. `skill/versions.json` is generated by `rust_skill_check`; `skill/versions.md` renders the same data.

### Editing the skill

The global copy at `$DSH_HOME/skills/rust-fullstack-elite` is yours to edit. The plugin detects modified files (against its manifest hashes) and will not silently overwrite them:

- `ensureGlobalSkill` skips user-modified files; `force` creates a timestamped backup under `$DSH_HOME/rust-fullstack/backups/` first.
- `rust_skill_update` skips user-modified files unless `force: true`.
- Regenerating versions updates `versions.json` and `versions.md` automatically.

If you edit the bundled copy inside the installed package, a plugin reinstall may replace it. Keep durable customizations in the global copy, or fork the repository.

## Freshness and self-update

`rust_skill_check` checks:

- Rust stable from `rust-lang/rust` GitHub releases;
- Axum, Leptos, Dioxus, SQLx, Tokio, Tower-HTTP, `cargo-leptos`, `trunk`, `dioxus-cli`, `sqlx-cli` from crates.io;
- PostgreSQL from `postgresql.org/versions.json`;
- SQLite from `sqlite.org/download.html`;
- optional official docs URLs.

`rust_skill_update` downloads `skill/skill-index.json` and every file from the GitHub release tag, verifies SHA-256, and writes atomically. It never executes downloaded code. It does not update the plugin's own JavaScript; use DSH `plugin_manager` for that.

The daily scheduler performs the check after a 15-second startup delay, then once per interval. It uses unref'd timers and is cleaned up with the plugin effect.

## Privacy and safety

- The plugin reads Cargo project metadata and user/tool content **locally** to score Rust evidence.
- Network access is limited to the configured GitHub repository, crates.io, `api.github.com` for Rust releases, PostgreSQL, SQLite, and the `rust_docs` allowlist:
  `doc.rust-lang.org`, `docs.rs`, `leptos.dev`, `book.leptos.dev`, `dioxuslabs.com`, `www.postgresql.org`, `www.sqlite.org`, `tokio.rs`, `rust-lang.github.io`.
- Docs fetching rejects credentials, non-HTTPS URLs, non-443 ports, and non-allowlisted hosts/paths.
- The global skill directory is outside the workspace; writes are intentional and reported by the tools.

## Development

```bash
npm test                 # node --test
npm run build:index      # regenerate skill/skill-index.json
npm run validate         # manifest, skill, hashes, no DSH imports
npm run pack:check       # inspect the npm tarball
npm run verify           # all of the above
```

The test suite uses only Node built-ins and temporary directories. It covers config normalization, Cargo project parsing, Rust detection, skill-store conflict handling, freshness parsing with mocked responses, docs URL/text handling, render output, tools, and the `agent/pre-step` activation path.

## Publishing a release

1. Update versions in `package.json` and `skill/SKILL.md` (`metadata.version`, `metadata.pack`).
2. Run `npm run build:index` and `npm run verify`.
3. Commit, tag `vX.Y.Z`, push.
4. Create a GitHub release. CI can run the same verify steps.
5. Install on other machines with the full commit SHA, not a moving branch.

The self-update path expects `skill/skill-index.json` to be committed at the tag. Do not attach an index that differs from the files in the tag.

## Troubleshooting

- **Skill not activated** — the request may score below the threshold, or the session may already have an activation. Check `rust_skill_status`; lower `activationThreshold` if needed.
- **Global skill missing** — `installGlobalSkill` is off, or the profile cannot write `$DSH_HOME`. The bundled copy still activates.
- **Freshness check fails** — corporate proxy/offline environment. The previous versions are preserved and marked; the skill still works.
- **Update refuses to overwrite** — a file was edited locally. Inspect `rust_skill_status`, then use `rust_skill_update` with `force: true` after reviewing the backup.
- **“Update the plugin with plugin_manager”** — the skill pack updated, but the plugin JavaScript did not. This is deliberate.

## License

MIT © 2026 alsergeevich. The bundled skill text is original; official documentation is linked, not copied at length.
