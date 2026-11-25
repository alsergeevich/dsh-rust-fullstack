# Rust Fullstack Elite

`@alsergeevich/dsh-rust-fullstack` turns DeepSeek Harness into a Rust full-stack specialist when Rust work is detected.

## Why install it

- The elite `rust-fullstack-elite` skill is activated automatically — no `/skill` command, no repeated explanation.
- It knows the project: Cargo root, edition, MSRV, toolchain, frameworks, databases, dependency versions, migrations.
- It is docs-first: version-sensitive claims are checked against official sources, with a bounded `rust_docs` tool.
- It stays current: `rust_skill_check` refreshes a timestamped version baseline; `rust_skill_update` installs a verified skill pack from GitHub.
- Your edits survive: the global skill is editable and protected by manifest hashes, with backups before forced updates.

## Install

From a local checkout:

```text
plugin_manager install_bundle target=F:\path\to\dsh-rust-fullstack
```

From GitHub (reproducible):

```text
https://github.com/alsergeevich/dsh-rust-fullstack.git#<full-40-char-commit>
```

Host-only, no build step, no DSH runtime imports. After install, ask for an Axum + SQLx endpoint and the activation preamble should appear.

## Tools

| Tool | What it does |
|---|---|
| `rust_skill_status` | Skill/global drift, freshness, project summary |
| `rust_skill_check` | Refresh official version data and docs reachability |
| `rust_skill_update` | Validate and apply a GitHub skill pack (approval required) |
| `rust_docs` | Fetch an allowlisted official documentation page |
| `rust_project_scan` | Scan a Cargo project |

## Safety

Only allowlisted official docs hosts are fetched. Skill packs are index-validated, SHA-256 verified, size-limited, and written atomically. Remote code is never executed. The plugin never replaces its own JavaScript; update the package with `plugin_manager`.

## Links

- Repository: https://github.com/alsergeevich/dsh-rust-fullstack
- Issues: https://github.com/alsergeevich/dsh-rust-fullstack/issues
- License: MIT
