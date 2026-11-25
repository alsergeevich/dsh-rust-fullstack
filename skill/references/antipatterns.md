# Antipatterns

Each entry names the smell, the cost, and the fix. Treat a hit during review as blocking unless there is a written reason.

## `unwrap`/`expect` in production paths

- Smell: `.unwrap()` on request parsing, env config, database results, or locks.
- Cost: one malformed request or missing variable panics the handler; the client sees a dropped connection.
- Fix: `?` into a typed error, `ok_or` with a domain error, and boundary validation. Reserve `expect` for startup invariants and say why in the message.

## Clone-everywhere to satisfy the borrow checker

- Smell: `data.clone()` in loops, cloning `String`/`Vec` per request, cloning `Arc` contents instead of the `Arc`.
- Cost: hidden O(n) allocations in hot paths; large payloads copied per task; latency and memory grow with load while the code looks innocent.
- Fix: shorten borrow scopes, pass `&T`, split structs so the mutable and read-only fields are separate, use `Arc<str>`/`Bytes` for shared immutable payloads. Optimize only after measuring.

## Blocking the async runtime

- Smell: `std::fs`, `std::thread::sleep`, `reqwest::blocking`, CPU-heavy parsing, or synchronous crypto inside an `async fn`.
- Cost: one blocked worker stalls every task scheduled on it; latency spikes across unrelated endpoints.
- Fix: `tokio::task::spawn_blocking` for blocking or CPU work, `tokio::time::sleep` for delays, streaming/chunked parsing for large inputs. Keep handlers `async` all the way down.

## Holding a lock across `.await`

- Smell: a `MutexGuard` alive while awaiting I/O, or `std::sync::Mutex` in an async function that awaits.
- Cost: the future becomes `!Send` (compile error at `spawn`) or the lock is held for the duration of network I/O, serializing every task.
- Fix: scope the guard, copy what you need, drop it, then await. Use `tokio::sync::Mutex` only when awaiting inside the critical section; prefer channels or `ArcSwap` for read-mostly state.

## N+1 queries

- Smell: fetching a list, then one query per item in a loop or in the serializer.
- Cost: latency scales with page size, the pool is saturated by round trips, and the database does thousands of tiny plans.
- Fix: one joined query or `WHERE id = ANY($1)` with an `IN`-style batch, then group in Rust. Add a query-count assertion in integration tests for list endpoints.

## SQL string concatenation

- Smell: `format!("SELECT ... WHERE id = {}", id)` or building `ORDER BY` from a query parameter.
- Cost: injection, broken quoting, no plan caching, and a bypassed query checker.
- Fix: bind parameters for values and whitelist dynamic identifiers (`match sort { "name" => "name", ... }`). Use `sqlx::query!` so the statement is checked at build time.

## Global mutable state

- Smell: `static mut`, `static Mutex<HashMap<...>>` caches, `lazy_static` singletons holding request data.
- Cost: tests interfere, shutdown is undefined, contention is invisible, and replicas duplicate state inconsistently.
- Fix: put state in `AppState` and pass it through, use the database or Redis for shared state, and scope caches per process with explicit invalidation.

## Over-abstraction

- Smell: a trait per struct with one implementation, generic parameters used once, a "repository factory" factory, layers that only forward calls.
- Cost: compile time, unreadable errors, indirection that hides the actual SQL or HTTP call, and changes that require edits in five files.
- Fix: concrete types until a second implementation or test seam exists. Abstract only where substitution matters (external I/O, clock, mailer), not around pure data.

## Spawn-and-forget tasks

- Smell: `tokio::spawn(...)` with the handle dropped, background work started inside a request, jobs that die with the process.
- Cost: panics and errors vanish, shutdown loses work, and there is no backpressure or retry.
- Fix: await or supervise handles, track join errors, and move durable work to a queue table or broker with retries and visibility timeouts.

## Unbounded channels and queues

- Smell: `unbounded_channel()` bridging producer and consumer, in-memory job queues.
- Cost: a slow consumer grows memory until OOM, which looks like a random crash under load.
- Fix: bounded channels with `try_send`/backpressure, explicit rejection when full, and queue depth as a metric.

## Stringly-typed errors

- Smell: `anyhow!("not found")` matched by substring, 500 for every failure, internal messages returned to clients.
- Cost: clients cannot branch on errors, alerts lose meaning, and internal details leak.
- Fix: a typed error enum with stable codes mapped once to status and JSON; `thiserror` in libraries, `anyhow` only at the top with context.

## `SELECT *` in application queries

- Smell: wildcard selects mapped into `FromRow` structs.
- Cost: a new column changes types or breaks decoding, extra data crosses the wire, and the contract is invisible.
- Fix: list columns explicitly; use compile-time macros so schema drift fails the build.

## `#[allow(...)]` sprawl

- Smell: `#[allow(dead_code)]`, `#[allow(clippy::too_many_arguments)]` repeated instead of fixed.
- Cost: real warnings get suppressed alongside the intended one; the lint baseline erodes.
- Fix: allow at the narrowest scope with a comment, prefer fixing (split the function, delete dead code), and keep `-D warnings` in CI.

## Verify

- `grep -R "unwrap()\|expect(" src` outside tests is explainable.
- No `std::sync::Mutex` guard lives across an `.await` (review async fns for guard scopes).
- `EXPLAIN`/query logs show a bounded query count for list endpoints.
- No SQL is built with `format!` except whitelisted identifiers.
- No `static mut` and no `lazy_static` holding mutable request state.

## Docs

- Clippy lints: https://rust-lang.github.io/rust-clippy/master/
- Rust API guidelines: https://rust-lang.github.io/api-guidelines/
- axum: https://docs.rs/axum/latest/axum/
- SQLx: https://docs.rs/sqlx/latest/sqlx/
