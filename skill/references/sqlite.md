# SQLite

Baseline: SQLite 3.54.1. SQLite is a library, not a server: correctness depends on connection settings and on respecting its single-writer model. Verify pragmas and limits against the docs for the exact version.

## Mental model

- WAL mode is the production default. It lets many readers proceed concurrently with one writer; without WAL, a writer blocks all readers.
- There is exactly one write transaction at a time, database-wide. Writes serialize; the practical limit is transaction duration, not connection count.
- Every PRAGMA that matters for correctness (`foreign_keys`) is per-connection state, not stored in the file. A pool must apply it on every connection.
- SQLite is not client/server: there is no network protocol, no user accounts, no row-level security. File permissions and the application are the security boundary.
- WAL requires a local filesystem. Put the database on a network share or in a container overlay and locking semantics break.

## Configuration that must be explicit

- `journal_mode = WAL` persists in the file, but still set it at connect time.
- `busy_timeout` (for example 5000 ms) makes lock contention wait instead of returning `SQLITE_BUSY` immediately.
- `foreign_keys = ON` on every connection; SQLite keeps it off by default for backward compatibility.
- `synchronous = NORMAL` is the usual WAL trade-off: durable against process crash, a small window on power loss. Use `FULL` for financial data.
- Consider `journal_size_limit` and periodic `wal_checkpoint(TRUNCATE)` to bound WAL growth on busy databases.
- In sqlx, put these in `SqliteConnectOptions` (`.journal_mode(Wal)`, `.busy_timeout(...)`, `.foreign_keys(true)`, `.pragma("synchronous", "NORMAL")`) rather than issuing one-off PRAGMA statements that only hit one pooled connection.

## Concurrency and pooling

- Start write transactions with `BEGIN IMMEDIATE` (sqlx: acquire a transaction with `begin()` and run a write early) so the write lock is taken up front. A deferred transaction that reads then writes can fail with `SQLITE_BUSY` on upgrade.
- With a pool, either (a) cap `max_connections` so writes serialize on one connection, (b) dedicate one writer connection and a read pool, or (c) rely on `busy_timeout` plus short `IMMEDIATE` transactions. Do not mix long reads with writes in one transaction.
- Keep write transactions to milliseconds: no HTTP calls, no file I/O, no `await` on unrelated work inside the transaction.
- `SQLITE_BUSY` is normal under contention and must be retried with backoff; treating it as a fatal error turns load spikes into outages.
- `PRAGMA optimize` on connection close (or periodically) keeps the query planner statistics fresh.

## Schema and queries

- Use `STRICT` tables. They reject type mismatches instead of storing `'abc'` in an `INTEGER` column; allowed types are `INT`, `INTEGER`, `REAL`, `TEXT`, `BLOB`, `ANY`.
- Prefer `INTEGER PRIMARY KEY` (the rowid alias) unless the table is small and keyed by text; `WITHOUT ROWID` suits narrow tables with non-integer keys.
- Store timestamps as ISO-8601 `TEXT` (UTC) or integer epoch seconds, and be consistent. Never store local times without an offset.
- Use `CHECK` constraints for enums (`CHECK (status IN ('new','done'))`) since there is no enum type.
- FTS5 for search: `CREATE VIRTUAL TABLE docs USING fts5(title, body);` then `WHERE docs MATCH ?` and rank with `bm25(docs)`. Avoid `LIKE '%term%'` on large tables.
- JSON: use the built-in `json_extract`, `->`, `->>` with generated columns plus indexes for hot paths; there is no JSONB.
- Schema changes are limited: no `ALTER COLUMN`. Use the documented table-rebuild procedure, or make additive changes only.

## Operations

- Back up with `VACUUM INTO 'backup.db'` or the `.backup` CLI command; both produce a consistent snapshot while the database is live. Copying the `.db` file (or `.db` plus `-wal` and `-shm`) without care is not a backup.
- Run `PRAGMA integrity_check` on restores, and schedule `quick_check` on large databases.
- Track file size, WAL size, and `SQLITE_BUSY` counts as metrics. A growing WAL usually means a long-running read transaction is blocking checkpoints.
- Migrations: use sqlx migrations or `user_version`. For destructive changes, rebuild into a new table and rename inside one transaction.
- Do not run `VACUUM` on a hot path; it rewrites the file and needs free disk space equal to the database size.

## Pitfalls

- Foreign keys silently disabled in one connection lets orphan rows accumulate; verify with `PRAGMA foreign_keys`.
- `sqlx` with `max_connections > 1` and deferred transactions produces intermittent `database is locked` under load.
- WAL on a network share (NFS/SMB) risks corruption; SQLite does not support it.
- Long-lived read transactions prevent WAL checkpointing and grow the WAL without bound.
- Storing booleans as `'true'`/`'false'` text defeats `CHECK` and indexes; use 0/1.
- `AUTOINCREMENT` is usually unnecessary; plain `INTEGER PRIMARY KEY` reuses ids and is faster.

## Verify

- `PRAGMA journal_mode` returns `wal`, `PRAGMA foreign_keys` returns 1, on every pooled connection.
- Load test with concurrent writers produces retries but no `database is locked` surfaced to users.
- `PRAGMA integrity_check` passes on a restored backup.
- WAL file size stays bounded over a 24-hour soak.
- `EXPLAIN QUERY PLAN` shows index use for the top queries.

## Docs

- SQLite documentation: https://www.sqlite.org/docs.html
- WAL mode: https://www.sqlite.org/wal.html
- SQL syntax and pragmas: https://www.sqlite.org/lang.html
- SQLx driver notes: https://docs.rs/sqlx/latest/sqlx/
