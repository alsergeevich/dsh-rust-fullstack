# Changelog

All notable changes to `@alsergeevich/dsh-rust-fullstack` are documented here.

## 0.1.1 — 2026-11-25

### Fixed

- Preserve the runtime-updated `versions.json` across plugin reloads. The global installer now only writes a generated freshness file when it is missing or when `force` is used, so a daily check is not silently reset to the bundled baseline.
- Keep the reported skill version aligned with the installed `SKILL.md` metadata (`0.1.1`).

## 0.1.0 — 2026-11-25

### Added

- Host-only DSH plugin for automatic Rust detection and skill activation.
- `rust-fullstack-elite` skill with 14 reference guides covering Rust, Axum, Leptos, Dioxus, SQLx, PostgreSQL, SQLite, architecture, testing, security, observability, deployment, checklists, and anti-patterns.
- Project-aware activation context: Cargo root, package, edition, MSRV, toolchain, workspace, frameworks, databases, lockfile versions, migrations, and Rust file count.
- Canonical `<skill_content>` injection through `agent/pre-step`, compatible with DSH's `/skill` invocation shape.
- Global skill installation at `$DSH_HOME/skills/rust-fullstack-elite` with bundled fallback and manifest hash tracking.
- Tools: `rust_skill_status`, `rust_skill_check`, `rust_skill_update`, `rust_docs`, `rust_project_scan`.
- Freshness checks for Rust, ten crates, PostgreSQL, SQLite, and optional official documentation URLs.
- GitHub-release skill pack updates with index validation, SHA-256 verification, size limits, atomic writes, and backups.
- `tools/pre-execute` approval guard for non-dry-run updates.
- Daily/weekly background freshness scheduler.
- English and Russian plugin metadata, icon, detail pages, CI and release workflows.
- Test suite using Node built-ins and temporary directories.

### Security

- Docs fetch allowlist, HTTPS-only, credential/port/path rejection.
- Skill pack path traversal and archive-size protections.
- No remote code execution and no self-replacement of plugin JavaScript.
- User edits to the global skill are preserved unless `force` is used.

### Known limitations

- `plugin_manager` cannot update a git install that is not pinned to a full 40-character commit.
- Background checks require outbound HTTPS; offline environments retain previous data.
- The activation heuristic is intentionally conservative and may need `activationThreshold` tuning for unusual prompts.
- The skill is a 2026-11-25 baseline; always re-check version-sensitive APIs with `rust_docs` or `rust_skill_check`.
