# Axum 0.8

Baseline: axum 0.8.9, MSRV 1.80, edition 2021. In 0.8 path parameters use `/{id}` (and `/{*rest}` for wildcards); the old `:id` / `*rest` syntax is gone. Verify feature flags and MSRV against the docs for the exact patch version.

## Mental model

- `Router` is a tree of `tower::Service`s that maps a request to a response. `route` adds an endpoint, `nest` mounts a subtree under a prefix, `merge` unions routers, `layer` wraps everything, `route_layer` wraps only matched routes (not the fallback).
- A handler is an `async fn` whose arguments are extractors. All extractors except the last must implement `FromRequestParts`; at most one may consume the body (`Json`, `Form`, `String`, `Bytes`, `Multipart`) and it must be last.
- `State<S>` is cloned per request, so `S` should be cheap: `Arc<AppState>` containing the pool, config, and trait objects.
- Layers run outside-in on requests and inside-out on responses. Put `TraceLayer` outermost so it sees timeouts and auth failures, and put body-size and timeouts before anything that buffers bodies.

## Patterns

- Compose routers from per-module functions returning `Router<AppState>`, then call `.with_state(state)` once in `main`. Handlers then take `State<Arc<AppState>>`.
- Type every payload: `Query<Pagination>`, `Path<UserId>`, `Json<CreateUser>`. Validate after deserialization and return 422 for semantic failures, 400 for malformed syntax.
- Map errors in one place: an `AppError` enum implementing `IntoResponse`. Return `(StatusCode, Json<ErrorBody>)` with a stable machine-readable `code`, a safe message, and a request id. Log 5xx with `tracing::error!`; never echo database text to clients.
- Map known database states explicitly: `RowNotFound` to 404, unique violation (SQLSTATE 23505) to 409, foreign-key violation (23503) to 409/422.
- Body limits: axum applies a 2 MB `DefaultBodyLimit`; raise it only on upload routes with `.layer(DefaultBodyLimit::max(n))`. If you use `RequestBodyLimitLayer`, call `DefaultBodyLimit::disable()` to avoid double-limiting.
- Graceful shutdown: `axum::serve(listener, app).with_graceful_shutdown(shutdown_signal())`, where the signal future awaits SIGTERM and Ctrl-C. Add a drain timeout so in-flight work cannot block deploys forever.
- 0.8 removed the `async_trait` requirement from extractor traits; implementations can be plain `async fn`. Use `#[debug_handler]` when a handler fails to satisfy `Handler`.
- Test with `tower::ServiceExt::oneshot` against the real router, sending `Request` values and collecting the body. This exercises extractors, layers, and error mapping without a socket.

```rust
use tower::ServiceExt; // for `oneshot`
let app = app().await;
let res = app
    .oneshot(Request::builder().uri("/users/1").body(Body::empty()).unwrap())
    .await
    .unwrap();
assert_eq!(res.status(), StatusCode::OK);
```

## Pitfalls

- `Json` must be the final argument. A handler declared as `async fn h(Json(b): Json<T>, State(s): State<S>)` does not compile; swap the order.
- Forgetting `Content-Type: application/json` yields 415 from `Json`. Send it from clients and tests.
- `Option<T>` extractors swallow rejection reasons, so a malformed query becomes `None`. Accept `Result<Query<T>, QueryRejection>` when the distinction matters.
- State type mismatches surface as long `Handler` trait errors. Usually the router is still `Router<AppState>` when you call `oneshot`, or `with_state` was applied twice.
- A panic in a handler aborts that connection task. Add `tower_http::catch_panic::CatchPanicLayer` and treat panics as 500s with alerts.
- Wildcards in `nest` need `{*rest}` in 0.8; a bare `*rest` panics at startup.
- Overlapping routes panic at router construction, which is good: fail at boot, not on first request.
- CPU-heavy or blocking work inside a handler starves the runtime. Use `spawn_blocking`.
- Applying `TraceLayer` after an auth layer hides rejected requests from traces.

## Verify

- `cargo test` includes at least one `oneshot` test per route module covering success, 400/422, 404, and 500 paths.
- Every handler returns `Result<_, AppError>` or an explicit status; no `unwrap` on request data.
- `curl -sv` against a running instance shows security and trace headers, and oversized bodies return 413.
- SIGTERM drains: send SIGTERM under load, confirm no dropped responses and a clean exit.
- 0.8 paths match `/{id}`; no `:id` remains (`grep -R ':[a-z_]*}' src`).

## Docs

- axum API docs: https://docs.rs/axum/latest/axum/
- Official examples: https://github.com/tokio-rs/axum/tree/main/examples
- tower-http layers: https://docs.rs/tower-http/latest/tower_http/
- Tokio tutorial (runtime, spawn, shutdown): https://tokio.rs/tokio/tutorial
