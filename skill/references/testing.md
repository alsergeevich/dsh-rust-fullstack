# Testing Rust Fullstack Applications

## Mental model

- Test the real edge: domain logic with pure unit tests, HTTP behavior through the actual router, persistence against a real database engine. Mocks are for third parties you cannot run (payment, email), not for your own database.
- Each test owns its state. Shared fixtures mutate across tests, break parallel execution, and hide ordering dependencies.
- A test asserts a contract: status code, error code, persisted rows, outbound request shape. Asserting log strings or internal function calls couples tests to implementation.
- Fast feedback is a design constraint. If the suite takes 20 minutes, it stops being run before commits; split unit and integration into different commands and run the full suite in CI.

## Unit tests

- `#[cfg(test)] mod tests` beside the code; test public behavior of the module, not private helpers unless the module is internal.
- Use `rstest` for table-driven cases (`#[case]`) so validation matrices stay readable.
- Use `proptest` for invariants (round-trip serialization, idempotent normalization, arithmetic bounds) where example-based tests only sample.
- Inject clocks (`Clock` trait) and randomness (`RngCore`) instead of calling `Utc::now()`/`rand::thread_rng()` inside logic; then `tokio::time::pause()` and `advance()` make timeout behavior testable.
- Keep domain tests free of async and I/O; they should run in milliseconds.

## HTTP integration tests

- Build the real `Router` with a test `AppState`, then use `tower::ServiceExt::oneshot`. This exercises extractors, middleware, and error mapping without binding a port.
- `axum-test` wraps the same idea with ergonomics: `TestServer::new(router)`, `.get("/users/1").await`, `.assert_status_ok()`, `.json::<User>()`. It is convenient for many routes but adds a dependency; `oneshot` is enough for a handful.
- Assert both status and body contract (`code` field), and assert the side effect (row exists, outbox row written) through the repository.
- For multipart and streaming uploads, send real bodies; do not stub the extractor.

```rust
#[tokio::test]
async fn create_user_rejects_duplicate_email() {
    let app = test_app().await; // router with migrated pool
    let req = Request::post("/api/v1/users")
        .header("content-type", "application/json")
        .body(Body::from(r#"{"email":"a@b.c"}"#))
        .unwrap();
    let res = app.oneshot(req).await.unwrap();
    assert_eq!(res.status(), StatusCode::CONFLICT);
}
```

## Database tests

- `#[sqlx::test]` gives each test a fresh database with migrations applied: `#[sqlx::test(migrations = "./migrations")] async fn t(pool: PgPool)`. Tests run in parallel and clean up after themselves.
- Alternative: one database per test suite plus transactions rolled back at the end. This breaks when code uses multiple connections; prefer `sqlx::test`.
- Seed with builders that take explicit values, not shared static fixtures. Unique values (UUID emails) avoid cross-test collisions.
- Test constraint behavior: unique violations map to 409, FK violations to a domain error, RLS hides other tenants' rows.
- For SQLite, run the same repository tests against `SqlitePool` to catch dialect drift, but do not pretend the concurrency behavior is identical.

## Snapshots and external services

- `insta` for response payloads, error bodies, and generated SQL: `assert_json_snapshot!`, review with `cargo insta review`, commit `.snap` files.
- Redact volatile fields (ids, timestamps, trace ids) with insta filters; otherwise snapshots churn on every run.
- `wiremock` for outbound HTTP: assert method, path, headers, and body; return canned responses including 500 and timeout cases.
- `mockall` for trait-object seams (mailer, storage). Do not mock `sqlx`; the query is the thing worth testing.

## Frontend and end-to-end

- Component tests with `wasm-bindgen-test` run in a headless browser; use them for interaction logic that cannot be extracted into plain functions.
- E2E with Playwright against a real server (`cargo leptos serve` or `dx serve --platform web`), a seeded database, and `data-testid` selectors. Keep the E2E set small: login, core CRUD, checkout.
- Run E2E on the main branch and before releases, not on every file save.
- Accessibility assertions (axe) in E2E catch missing labels cheaply.

## CI gates

- `cargo fmt --check`, `cargo clippy --all-targets --all-features -- -D warnings`, `cargo test --all-targets`.
- `cargo nextest run` for speed and per-test isolation; add `--retries 2` only for known-flaky external tests, with an issue tracking each.
- `cargo llvm-cov` with a floor for domain crates; coverage is a smoke alarm, not a target.
- `cargo sqlx prepare --check`, `cargo audit`, `cargo deny check`, and a release build of both server and WASM targets.
- Flaky tests get quarantined with an owner and a deadline; retries without a ticket hide real races.

## Verify

- `cargo test` passes from a clean checkout with only documented services running.
- Each route has at least one success and one failure test, including 401/403/404/409.
- `sqlx::test` suites run in parallel without deadlocks or shared-state failures.
- Snapshots contain no timestamps or random ids that change per run.
- E2E suite passes twice in a row locally (catches order dependence).

## Docs

- axum testing examples: https://github.com/tokio-rs/axum/tree/main/examples
- SQLx testing: https://docs.rs/sqlx/latest/sqlx/
- Tokio tutorial (time, tasks): https://tokio.rs/tokio/tutorial
- SQLite (for dialect tests): https://www.sqlite.org/docs.html
