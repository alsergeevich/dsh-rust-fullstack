# Fullstack Architecture

## Mental model

- A Rust fullstack app is one repository, often one deployable, with a hard internal boundary between server and client code. The boundary is a type-level contract: request/response DTOs, error codes, and auth semantics.
- The server owns truth: validation, authorization, and persistence. The client owns presentation and optimistic updates. Any rule enforced only in the browser is not enforced.
- SSR and CSR are deployment modes of the same codebase, not separate applications. Code shared by both must compile for both targets and must not touch `window` or the database at the wrong time.
- Start as a modular monolith. Extract a service only when a module needs an independent scaling profile, deploy cadence, or team ownership — not because the diagram looks cleaner.

## Workspace layout

```text
apps/api/        axum binary: routing, extractors, wiring
apps/web/        leptos or dioxus binary: WASM entry, SSR shell
crates/domain/   entities, value objects, use cases; no axum, no sqlx
crates/db/       sqlx repositories, migrations, row mapping
crates/api-types/ DTOs shared by server and client, serde + validation
crates/config/   typed configuration loaded at boot
```

- Keep `domain` dependency-free of transport and storage. Repositories are traits defined in `domain` and implemented in `db`.
- `api-types` contains DTOs, not database rows. This prevents schema changes from silently changing the public contract.
- Compile time is architecture: fewer generic parameters across crate boundaries and fewer feature combinations keep `cargo check` fast.

## API boundaries

- Version the path (`/api/v1`) and treat the JSON shape as public. Renaming a field is a breaking change even in a monorepo, because mobile clients and integrations lag.
- Use a single error envelope for every non-2xx response: `{"code": "user_not_found", "message": "...", "details": {...}, "trace_id": "..."}`. Codes are stable strings clients branch on; messages are for humans and may change.
- Validation errors return 422 with per-field details keyed by field path, so forms can render inline errors without string parsing.
- Paginate with cursors, not offsets, for any list that can grow. Return `next_cursor: Option<String>` and document ordering stability.
- Mutating POSTs accept an `Idempotency-Key` header and store the result keyed by it; retries after timeouts must not double-charge or double-create.
- Serve OpenAPI from the router (`utoipa` plus a Swagger/Redoc UI in non-production) and generate it in CI. If you cannot generate the spec, the boundary is undocumented.
- Separate transport DTOs from domain types with explicit `From` impls; this is where you decide what is exposed.

## Auth and authorization

- Browser sessions: an opaque, high-entropy session id in an `HttpOnly; Secure; SameSite=Lax` cookie, backed by a server-side record so logout and revocation actually work. Stateless JWTs are for machine clients where revocation latency is acceptable.
- Cookie-authenticated mutations need CSRF protection: `SameSite` plus a token checked on state-changing requests. Bearer-token APIs are not CSRF-exposed but must check `Origin` where browsers are involved.
- Authorize in the handler and again at the data layer (tenant predicate or RLS). A single missed `WHERE tenant_id = $1` is a cross-tenant breach.
- Put `user_id` and `tenant_id` into request-scoped tracing spans so every log line and error report is attributable.

## Rendering and assets

- SSR public pages for SEO and first paint; CSR authenticated dashboards where cacheability does not matter. Hybrid per route is normal: SSR the marketing site, CSR the app shell.
- Hydration requires deterministic markup. No timestamps, randomness, or browser-only branches during SSR.
- Content-hash every asset and serve hashes with `Cache-Control: public, max-age=31536000, immutable`; serve HTML with `no-cache`. Compress with brotli and pre-compress at build time.
- SPA fallback must not swallow `/api/*`: return 404 JSON for unknown API paths, index.html only for navigation routes.
- Serve WASM with `application/wasm` and enable streaming compilation (`Content-Encoding: br` or gzip is fine; wasm must not be double-compressed incorrectly).

## Operations baked into the shape

- Health endpoints: `/healthz` for liveness (no dependencies), `/readyz` for readiness (checks pool acquire and migrations applied).
- Graceful shutdown drains HTTP, then closes the pool; background jobs check a shutdown token.
- Configuration is environment-driven and parsed into a typed struct at boot; unknown or missing values abort startup with a clear message.
- Background work (email, webhooks) goes through a durable queue table or an external broker, not `tokio::spawn`, which dies with the process.

## Verify

- `cargo check --workspace --all-targets` passes for both server and WASM targets.
- OpenAPI is generated in CI and the diff is reviewed with contract changes.
- Every route has an authorization test: unauthenticated, wrong tenant, insufficient role.
- Error responses conform to the single envelope; a snapshot test asserts it.
- Asset URLs in production HTML are hashed; HTML responses are not cached immutably.
- A fresh clone builds with documented commands only (no hidden local state).

## Docs

- Rust API guidelines: https://rust-lang.github.io/api-guidelines/
- axum: https://docs.rs/axum/latest/axum/
- Leptos book: https://book.leptos.dev/
- Dioxus guide: https://dioxuslabs.com/learn/0.7/
- PostgreSQL manual (RLS, constraints): https://www.postgresql.org/docs/current/
