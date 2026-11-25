# Deployment

## Mental model

- Build once, deploy the same artifact everywhere; configuration comes from the environment at run time, never from a different binary per environment.
- Treat release as three steps: build (compile, test, scan), release (tag, sign, publish image + SBOM), run (pull and start). Mixing them is how "works on staging" happens.
- The process is disposable: it must start without local state, log to stdout, read config from env, and shut down gracefully on SIGTERM without losing in-flight requests.
- Migrations and code roll out as separate, ordered steps; every deploy must be rollback-safe with the previous image.

## Multi-stage image with cargo-chef

```dockerfile
FROM rust:1.100-slim-bookworm AS chef
RUN cargo install cargo-chef --locked
WORKDIR /app

FROM chef AS planner
COPY . .
RUN cargo chef prepare --recipe-path recipe.json

FROM chef AS builder
COPY --from=planner /app/recipe.json recipe.json
RUN cargo chef cook --release --recipe-path recipe.json
COPY . .
ENV SQLX_OFFLINE=true
RUN cargo build --release --locked --bin api

FROM gcr.io/distroless/cc-debian12
COPY --from=builder /app/target/release/api /usr/local/bin/api
USER nonroot
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/api"]
```

- `cargo-chef` caches the dependency layer, so code-only changes skip a full dependency rebuild. Mount BuildKit caches for the registry and `target` to make CI builds fast.
- Use `--locked` and commit `Cargo.lock`; an unpinned CI build is not reproducible. Set `SQLX_OFFLINE=true` and commit `.sqlx/` so the image builds without a database.
- Distroless or `debian:*-slim` with rustls. Alpine/musl changes the allocator and DNS behavior; measure before adopting it, and keep a debug image variant with a shell for incident work.
- Run as non-root, with a read-only root filesystem, no-new-privileges, and all capabilities dropped. The binary needs no writable paths except `/tmp` if you use it.
- Add `.dockerignore` for `target`, `.git`, and local env files; otherwise build context dominates build time.

## Build profile

- Release profile: `lto = "thin"`, `codegen-units = 1`, `strip = "symbols"`, and consider `panic = "abort"` (it removes unwind tables but breaks `catch_unwind`-based panic isolation).
- Keep `debug = 1` or line tables only if you need meaningful backtraces or profiling; fully stripped binaries make production crashes opaque.
- For multi-core services, evaluate jemalloc or mimalloc; the system allocator can be a bottleneck under many threads. Measure with a realistic load test.
- Pin the toolchain (`rust-toolchain.toml`) so the image and developers compile with the same compiler. Bump it deliberately, not implicitly via a floating `rust:latest`.

## Migrations and rollout order

- Run migrations as a separate one-shot job (Kubernetes Job, ECS task) before the new deployment, not from every replica's boot. SQLx guards concurrent runs, but a fixed order is easier to reason about and to roll back.
- Expand/contract: deploy additive schema and code that tolerates both shapes, backfill, then remove old columns in a later release. Never ship a migration that the previous image cannot run against.
- Long operations (`CREATE INDEX CONCURRENTLY`, large backfills) run outside the deploy window with their own monitoring.
- Keep at least two previous images deployable and know the exact rollback command; test rollback in staging, not first in production.

## Graceful shutdown and probes

- Handle SIGTERM: stop accepting connections, drain with a deadline shorter than `terminationGracePeriodSeconds`, flush telemetry, close the pool, exit 0. Log each phase with timing.
- In Kubernetes, add a `preStop` sleep (or a readiness flip) so the load balancer stops routing before the process stops accepting; otherwise clients see connection resets.
- `startupProbe` for slow boots, `livenessProbe` with no dependency checks, `readinessProbe` that verifies DB connectivity and migration state.
- Set `terminationGracePeriodSeconds` above your drain timeout plus a margin.

## Runtime configuration

- Parse all env vars into a typed struct at boot and fail fast with a message naming the missing variable. Do not default secrets.
- Secrets from a secret manager or mounted secret, injected as env or a file read at boot; never in the image, never in `docker history`.
- Set `TOKIO_WORKER_THREADS` deliberately in containers with CPU limits; the default is cores, which may not match cgroup limits. Same for pool size: app instances × pool size must stay under the database's `max_connections`.
- Log JSON to stdout and let the platform ship it. Do not write application logs to files inside the container.
- Frontend assets: fingerprint and serve with immutable caching, either embedded in the binary (`rust-embed`) or from a CDN/object store. Ensure `application/wasm`, correct content encoding, and SPA fallback that excludes `/api`.

## Verify

- `docker build` from a clean checkout succeeds with no network database access.
- Image runs as non-root (`docker run --rm image id`), has no shell in the final stage, and starts with `--read-only`.
- SIGTERM under load drains cleanly: zero 5xx, exit 0, within the grace period.
- A rollback to the previous image works against the migrated database.
- Config is fully env-driven: the same image runs in staging and production with only env differences.
- Image size and build time are tracked; a sudden jump signals a lost cache layer.

## Docs

- Cargo book (profiles, `--locked`): https://doc.rust-lang.org/cargo/
- axum (graceful shutdown, serve): https://docs.rs/axum/latest/axum/
- tower-http (ServeDir, compression, headers): https://docs.rs/tower-http/latest/tower_http/
- Tokio (runtime configuration): https://tokio.rs/tokio/tutorial
- PostgreSQL backup/restore: https://www.postgresql.org/docs/current/
