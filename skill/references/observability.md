# Observability

## Mental model

- Logs, metrics, and traces answer different questions; the request id (and trace id) is the join key across all three.
- Instrument for unknown-unknowns. You cannot add logging after the incident if the deploy is already rolled back; spans on every boundary are cheap compared to a blind outage.
- Cardinality is the budget. Every unique label combination is a stored time series; route templates and status classes are fine, user ids and raw URLs are not.
- Alert on symptoms users feel (error rate, latency, saturation), not on causes (CPU of one pod). Causes go in dashboards.

## Logging and tracing

- Use `tracing` for both: spans represent units of work, events are facts inside them. `#[instrument(skip(state, payload), fields(user_id = %user.id))]` on handlers and service methods gives structure without leaking secrets or huge bodies.
- Log at boundaries, not on every line: request in/out (method, route template, status, latency), outbound calls, state transitions, and errors with their source chain.
- `tracing_subscriber::fmt().with_env_filter(EnvFilter::from_default_env())` for local development; `.json()` with `.with_ansi(false)` in production for machine parsing. Set per-module filters (`RUST_LOG=info,my_app::db=debug`) rather than one global level.
- Never log passwords, tokens, cookies, full request bodies, or PII. Redaction belongs in the field construction, not in a downstream log processor.
- Attach request ids: `SetRequestIdLayer` with a UUID generator plus `PropagateRequestIdLayer` so clients, logs, and traces share one id. Accept a client-supplied id only if it validates and rate-limited.
- `tower_http::trace::TraceLayer` produces a span per request and a response event with latency. Configure `make_span_with` to record method and matched route, and `on_response` to log status and latency at info.

## Metrics

- Instrument the RED signals for every service: request rate, error rate, duration histogram (not averages). Add saturation: pool in-use vs max, queue depth, task backlog.
- Prometheus naming: `http_requests_total{method,route,status}`, `http_request_duration_seconds_bucket{route}`. Use `route` templates (`/users/{id}`), never concrete paths.
- Export `/metrics` on an internal port or behind network policy, never on the public listener.
- Database: pool acquire time, active/idle connections, query duration histogram by operation, and error counts by SQLSTATE class.
- Business metrics matter too: signups, orders, jobs processed, queue lag. They catch failures that infrastructure metrics miss.
- Pick histogram buckets around your SLOs (for example 5 ms to 2 s); default Prometheus buckets are often wrong for low-latency Rust services.

## Distributed tracing

- `tracing-opentelemetry` bridges spans to OTLP; `opentelemetry-otlp` exports to a collector. Set `service.name`, `service.version`, and deployment environment as resource attributes.
- Propagate W3C `traceparent`/`tracestate` through outbound HTTP and queue messages; without propagation, traces stop at your edge.
- Sample: parent-based with a ratio in production (for example 5–10%), plus tail sampling at the collector for all errors and slow requests. Keep 100% in staging.
- Batch exporting with a bounded queue so telemetry never blocks request handling; flush and shut down the provider on SIGTERM.
- Spans around external calls (database, HTTP client, cache) carry target and status, not payload.

## Health, readiness, and shutdown

- `/healthz` is liveness: process is up, no dependencies. Making liveness check the database causes restart storms during a DB blip.
- `/readyz` is readiness: acquire a pooled connection with a short timeout, verify migrations are applied, and fail while shutting down so the load balancer drains the pod.
- Distinguish startup from readiness: run migrations before the listener accepts traffic, and let readiness fail until they finish.
- On shutdown, stop accepting, drain in-flight requests, flush telemetry, then close the pool. Log each phase with timings.

## Pitfalls

- Logging inside a tight loop floods storage and hides the signal; log once per batch with counts.
- Unbounded `tracing` fields (full query strings, headers) explode log cost and leak data.
- High-cardinality metric labels can take down the metrics backend; review every label before shipping.
- Tracing every `SELECT` at info level doubles log volume; sqlx query events belong at debug or behind sampling.
- Alerting on CPU or memory alone pages people for normal batch work.
- A missing trace id in async tasks breaks correlation; spawn tasks with the current span (`tracing::Span::current()` or `Instrument`).

## Verify

- A single request produces one log line with `request_id`, and its trace appears in the backend with child spans for DB and outbound calls.
- `/metrics` exposes the RED metrics and pool gauges; label cardinality is bounded (no ids in labels).
- `/healthz` passes with the database stopped; `/readyz` fails within its timeout.
- `RUST_LOG=debug` locally does not print secrets (grep the output for password/token patterns).
- SIGTERM produces drain, telemetry flush, and exit 0 in the logs.
- One dashboard answers "is the service healthy?" without ad-hoc queries.

## Docs

- tower-http `trace` and `request_id` layers: https://docs.rs/tower-http/latest/tower_http/
- Tokio (tasks, shutdown): https://tokio.rs/tokio/tutorial
- PostgreSQL monitoring views: https://www.postgresql.org/docs/current/
