# Official sources and verification

The skill is docs-first. Use these canonical sources before relying on memory. The `rust_docs` tool is restricted to the first-party hosts below; it refuses credentials, non-HTTPS URLs, unusual ports, and unknown hosts.

**Baseline checked: 2026-11-25.** Re-check with `rust_skill_check` (versions) and `rust_docs` (pages). A URL being reachable does not mean the API on the page matches the project's crate version; always prefer a version-pinned docs.rs path.

## Rust

- The Rust Programming Language: https://doc.rust-lang.org/book/
- Standard library: https://doc.rust-lang.org/std/
- Reference: https://doc.rust-lang.org/reference/
- Cargo book: https://doc.rust-lang.org/cargo/
- Edition guide: https://doc.rust-lang.org/edition-guide/
- Clippy lints: https://rust-lang.github.io/rust-clippy/master/
- Rust API guidelines: https://rust-lang.github.io/api-guidelines/
- RustSec advisory database: https://rustsec.org/
- Releases: https://github.com/rust-lang/rust/releases

## Axum

- API docs (latest): https://docs.rs/axum/latest/axum/
- Version-pinned example: https://docs.rs/axum/0.8.9/axum/
- Examples: https://github.com/tokio-rs/axum/tree/main/examples
- Changelog: https://github.com/tokio-rs/axum/blob/main/axum/CHANGELOG.md

Axum 0.8 uses `/{id}` path parameters, not `/:id`. Verify the project's minor version before giving upgrade advice.

## Leptos

- Leptos book: https://book.leptos.dev/
- API docs: https://docs.rs/leptos/latest/leptos/
- Examples: https://github.com/leptos-rs/leptos/tree/main/examples
- Server functions and SSR: see the book's server/SSR chapters

Leptos 0.8 is the stable baseline; 0.9 is a release candidate. Do not present 0.9-only APIs as stable without saying so.

## Dioxus

- Learn Dioxus 0.7: https://dioxuslabs.com/learn/0.7/
- API docs: https://docs.rs/dioxus/latest/dioxus/
- Examples: https://github.com/DioxusLabs/dioxus/tree/main/examples
- CLI: https://dioxuslabs.com/learn/0.7/getting_started/

Dioxus 0.7 is the stable baseline; 0.8 is alpha. Desktop, web, and fullstack features have different dependency and transport requirements.

## SQLx

- API docs (latest): https://docs.rs/sqlx/latest/sqlx/
- Version-pinned example: https://docs.rs/sqlx/0.9.1/sqlx/
- Repository and examples: https://github.com/launchbadge/sqlx
- Migrations: https://docs.rs/sqlx/latest/sqlx/macro.migrate.html
- Offline mode: https://docs.rs/sqlx/latest/sqlx/#offline-mode

SQLx 0.9.1 has MSRV 1.94.0. If the project's toolchain is older, pin 0.8.6 and state the trade-off.

## PostgreSQL

- Current documentation: https://www.postgresql.org/docs/current/
- Version 19 documentation: https://www.postgresql.org/docs/19/
- Versioning policy: https://www.postgresql.org/support/versioning/
- Releases: https://www.postgresql.org/versions.json

PostgreSQL 19 is current; 15–19 are supported; 14 reached end of life on 2026-11-12. Use `EXPLAIN (ANALYZE, BUFFERS)` and `pg_stat_statements` rather than guessing about performance.

## SQLite

- Documentation: https://www.sqlite.org/docs.html
- SQL syntax: https://www.sqlite.org/lang.html
- WAL mode: https://www.sqlite.org/wal.html
- STRICT tables: https://www.sqlite.org/stricttables.html
- Backup API: https://www.sqlite.org/backup.html
- Download/version: https://www.sqlite.org/download.html

SQLite 3.54.1 is the baseline. Enable WAL, `busy_timeout`, and foreign keys; serialize writers. Do not copy a live database file or its WAL while writes are in flight.

## Tokio and Tower

- Tokio tutorial: https://tokio.rs/tokio/tutorial
- Tokio API: https://docs.rs/tokio/latest/tokio/
- Tower: https://docs.rs/tower/latest/tower/
- Tower-HTTP: https://docs.rs/tower-http/latest/tower_http/
- Axum + Tower middleware: https://docs.rs/axum/latest/axum/middleware/

Use `tower-http` for trace, compression, CORS, timeout, request ID, and static files. Do not hand-roll middleware that already exists and is maintained.

## Security and operational references

- OWASP Cheat Sheet Series: https://cheatsheetseries.owasp.org/
- OWASP ASVS: https://owasp.org/www-project-application-security-verification-standard/
- Argon2 RFC 9106: https://www.rfc-editor.org/rfc/rfc9106
- RustSec advisories: https://rustsec.org/
- `cargo audit`: https://github.com/rustsec/rustsec/tree/main/cargo-audit

## Version lookup endpoints

- crates.io: `https://crates.io/api/v1/crates/<crate>` (`crate.max_stable_version`, `crate.max_version`, per-version `rust_version`, `edition`)
- Rust releases: `https://api.github.com/repos/rust-lang/rust/releases/latest`
- PostgreSQL: `https://www.postgresql.org/versions.json`
- SQLite: `https://www.sqlite.org/download.html`

Always send a descriptive `User-Agent` when scripting these endpoints. Cache results; do not hammer registries in a loop.

## How to cite in an answer

State the version and the source, for example:

> Axum 0.8 path parameters use `/{id}` (Axum 0.8.9 docs: https://docs.rs/axum/0.8.9/axum/).

If the project pins a different version, cite that version's docs. If you could not verify, say **“unverified”** and explain what would settle it.
