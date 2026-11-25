# PostgreSQL

Baseline: PostgreSQL 19 is current; supported majors are 15–19. PostgreSQL 14 reached EOL on 2026-11-12, so any 14 instance is a finding. Verify version-specific syntax and defaults against the docs for the exact major.

## Mental model

- MVCC: readers never block writers and writers never block readers. Every `UPDATE` writes a new row version; old versions are reclaimed by `VACUUM`. Long transactions and abandoned snapshots hold back cleanup and bloat tables.
- The planner is cost-based and stats-driven. `ANALYZE` freshness matters more than most tuning knobs; an index that exists is not necessarily an index that is used.
- Every index accelerates reads and taxes writes plus cache. Index deliberately: primary key, foreign keys used in joins, and the exact predicates your top queries use.
- WAL gives durability and point-in-time recovery. `synchronous_commit = off` trades a small durability window for throughput; only for data you can rebuild.

## Indexing

- B-tree is the default and handles equality, ranges, and `ORDER BY`. Column order in a composite index matters: equality columns first, range/sort column last.
- Covering indexes (`INCLUDE`) enable index-only scans; partial indexes (`WHERE deleted_at IS NULL`) shrink hot indexes dramatically.
- GIN serves JSONB containment, array membership, and full-text search. Use `jsonb_path_ops` when you only need `@>`. For a single hot key, a B-tree expression index on `((data->>'status'))` is far cheaper than a whole-document GIN.
- BRIN for naturally ordered, append-only data (time-series tables) where a tiny index beats a huge B-tree.
- `CREATE INDEX CONCURRENTLY` avoids blocking writes but cannot run inside a transaction, takes longer, and can leave an `INVALID` index on failure. Check `pg_index.indisvalid` and drop/recreate invalid ones.
- Find unused indexes with `pg_stat_user_indexes.idx_scan` over a representative window before dropping; find missing ones in slow query plans.

## Reading plans

- Always use `EXPLAIN (ANALYZE, BUFFERS)` on real data. `ANALYZE` executes the statement, so wrap writes in a rolled-back transaction.
- Compare estimated rows to actual rows at each node. A 1000x misestimate means stale stats, correlated columns (consider extended statistics), or an unmodeled expression.
- Read buffers: high `read` counts mean cache misses; high `hit` counts with slow time mean CPU or row volume. `loops` in nested loops multiplies inner-node cost.
- A sequential scan is correct for small tables or large fractions of a table. Do not force indexes with `enable_seqscan = off` as a fix.
- `auto_explain` with `log_min_duration_statement` captures production plans without manual reproduction.

## Correctness under concurrency

- Default isolation is READ COMMITTED: each statement sees a fresh snapshot. Use REPEATABLE READ for multi-statement consistency, SERIALIZABLE when invariants span rows.
- Serializable transactions abort with SQLSTATE 40001. Retry the whole transaction with jittered backoff; never retry a single statement.
- Set `lock_timeout` (seconds) and `statement_timeout` per role or transaction so a stuck lock fails fast instead of piling up.
- Set `idle_in_transaction_session_timeout` to kill leaked transactions from buggy pools.
- `SELECT ... FOR UPDATE SKIP LOCKED` builds job queues; plain `FOR UPDATE` on a hot row serializes workers.

## JSONB, RLS, pooling

- Prefer columns for anything you filter, join, or constrain; JSONB is for genuinely schemaless attributes. Keep a `CHECK (jsonb_typeof(data) = 'object')` and validate shape in the app.
- RLS: `ENABLE ROW LEVEL SECURITY`, then policies using `current_setting('app.tenant_id')::uuid`. Use `FORCE ROW LEVEL SECURITY` so the table owner is also constrained, and `SET LOCAL` inside a transaction so pooled connections cannot leak tenant context.
- Pool: PgBouncer in transaction mode for many app replicas. Keep app pool small (roughly 2–4× cores across all instances), and disable prepared-statement caching in clients when using transaction pooling.
- Monitor `pg_stat_activity` (long queries, idle in transaction), `pg_stat_statements` (top by `total_exec_time`), and `pg_locks` during incidents.

## Backups and migrations

- Logical: `pg_dump -Fc`, restore with `pg_restore -j`. Physical/PITR: `pg_basebackup` plus continuous WAL archiving to object storage. Test restores on a schedule; an untested backup is a hypothesis.
- Expand/contract migrations: add nullable columns and new code, backfill in batches, switch reads, then drop old columns in a later release. Never combine a schema change and a data rewrite in one deploy window.
- Add constraints as `NOT VALID`, then `VALIDATE CONSTRAINT`, to avoid full-table locks. Adding a column with a constant default is fast on modern versions, but verify for your major.

## Verify

- `EXPLAIN (ANALYZE, BUFFERS)` for the top five queries shows no unexplained row misestimates.
- `pg_stat_statements` is installed and reviewed weekly; slowest query has an owner.
- Every `CREATE INDEX CONCURRENTLY` migration has a recovery plan for invalid indexes.
- RLS is enabled on every tenant-scoped table and tested with a non-owner role.
- A restore from backup succeeds into a scratch instance within the RTO.

## Docs

- PostgreSQL manual: https://www.postgresql.org/docs/current/
- Performance tips: https://www.postgresql.org/docs/current/performance-tips.html
- SQLx Postgres driver notes: https://docs.rs/sqlx/latest/sqlx/
