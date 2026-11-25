# SQLx 0.9

Baseline: sqlx 0.9.1, MSRV 1.94.0, edition 2021. That MSRV is aggressive: if your toolchain is older, pin 0.8.6 and record the decision in `rust-toolchain.toml` plus the changelog. Verify feature names against docs for the exact version.

## Mental model

- `Pool` is an `Arc`-style handle to a bounded set of connections; cloning is cheap and expected. Configure max size, acquire timeout, and idle/lifetime limits up front instead of at incident time.
- The compile-time macros (`query!`, `query_as!`, `query_scalar!`) ask the live database to describe your statement, then generate a typed struct or tuple. They need either `DATABASE_URL` at build time or a committed `.sqlx` cache.
- A transaction is a connection borrowed from the pool. `pool.begin()` takes it; `commit()` returns it; dropping the `Transaction` rolls back.
- `sqlx::test` provisions an isolated database per test and runs migrations, so tests can run in parallel without truncation hacks.

## Patterns

- Connection options carry the safety settings. For SQLite, set journal mode, busy timeout, foreign keys, and synchronous mode explicitly at connect time; a later `PRAGMA` only affects one pooled connection.
- Keep one query type per row: `#[derive(sqlx::FromRow)] struct User { id: Uuid, email: String }`, then `sqlx::query_as!(User, "SELECT id, email FROM users WHERE id = $1", id).fetch_one(&pool).await?`.
- Use `query_file!`/`query_as!` with `.sql` files for long statements; they stay compile-checked and keep Rust files readable.
- Migrations: `sqlx migrate add -r create_users` creates up/down files. Apply them in a dedicated deploy step, not on every replica boot. Use `-- no-transaction` at the top of a migration that must run outside a transaction (for example `CREATE INDEX CONCURRENTLY`).
- Offline builds: run `cargo sqlx prepare --workspace -- --all-targets` against a migrated database, commit `.sqlx/`, and set `SQLX_OFFLINE=true` in CI and Docker. Add `cargo sqlx prepare --check` to CI so a query change without refreshed metadata fails fast.
- Transactions: bind `let mut tx = pool.begin().await?;`, pass `&mut *tx` to each query, and call `tx.commit().await?` explicitly. A missing commit silently rolls back in reviews.
- Map errors at the boundary: `sqlx::Error::RowNotFound` to 404, `err.as_database_error().is_unique_violation()` (Postgres 23505) to 409, constraint names to domain messages. Do not string-match messages.
- Postgres-only helpers are worth using: `PgListener` for `LISTEN/NOTIFY`, advisory locks for singleton jobs, `COPY` for bulk loads, `Json<T>` for JSONB round-tripping.
- Behind PgBouncer in transaction pooling mode, disable prepared statement caching (`statement_cache_capacity(0)`) or use session pooling; otherwise you will see "prepared statement does not exist".

## Postgres vs SQLite differences that bite

- Placeholders differ (`$1` vs `?`), but the macros rewrite them, so prefer macros if you support both.
- SQLite lacks arrays, real JSONB, `ILIKE`, and concurrent writers. Model JSON as `TEXT` with `json_extract`, and search with FTS5 rather than `LIKE '%x%'`.
- Booleans and timestamps are storage classes, not distinct types; sqlx maps them by declared type. Be explicit in DDL (`INTEGER NOT NULL CHECK (flag IN (0,1))`).
- `RETURNING` works on modern SQLite, but bulk update semantics and locking differ. Do not assume Postgres isolation behavior.
- SQLite has one writer at a time; long write transactions serialize the whole app. Keep them short and use `BEGIN IMMEDIATE` for write transactions.

## Pitfalls

- A stale `.sqlx` cache produces "no cached data for this query" at build time; regenerate after every schema/query change.
- `query!` against a database with unapplied migrations fails confusingly; migrate before prepare.
- Forgetting `sqlx::test`'s migration path runs tests against an empty schema.
- `fetch_one` on a query that can return zero rows is a runtime 404 shaped as a 500 unless mapped.
- Long-held transactions exhaust the pool under load; monitor `pool.size()` and acquire timeouts.
- `SELECT *` in a compile-time query changes type when a column is added; list columns explicitly.
- Dynamic `ORDER BY`/table names cannot be bound; whitelist them in code.
- SQLx 0.9's MSRV 1.94 breaks older CI images; pin the toolchain before upgrading.

## Verify

- `cargo build` succeeds with `SQLX_OFFLINE=true` in a clean container.
- `cargo sqlx prepare --check` passes in CI.
- Every migration has a tested down path or a documented "no rollback" rationale.
- `#[sqlx::test]` covers each repository function's happy path and not-found path.
- Pool settings are explicit; shutdown calls `pool.close().await`.

## Docs

- SQLx API docs: https://docs.rs/sqlx/latest/sqlx/
- Official examples: https://github.com/launchbadge/sqlx/tree/main/examples
- PostgreSQL docs: https://www.postgresql.org/docs/current/
- SQLite docs: https://www.sqlite.org/docs.html
