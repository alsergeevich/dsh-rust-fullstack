# Security

## Mental model

- Start from a threat model: assets (accounts, tenant data, payments), actors (anonymous, authenticated user, admin, compromised dependency), and trust boundaries (browser, edge proxy, app, database). Every control below maps to a boundary.
- Secrets and identity are the highest-value targets. Most real incidents are broken authorization, credential stuffing, leaked secrets, or an outdated dependency — not exotic crypto.
- Deny by default. New routes are authenticated and authorized unless explicitly marked public, and the test suite proves it.
- Defense in depth: validate at the edge, re-validate in the handler, enforce at the data layer with constraints and RLS.

## Passwords and sessions

- Use Argon2id via the `argon2` crate. `Argon2::default()` is Argon2id with m=19456 KiB, t=2, p=1, which matches current OWASP guidance; verify parameters against your version's docs and OWASP.
- Generate a fresh salt per password (`SaltString::generate(&mut OsRng)`), store the PHC string, and verify with `verify_password` (constant-time). Cap password length (for example 128 bytes) to prevent hashing DoS; enforce a minimum of 12.
- Never log passwords, tokens, or password reset links. Redact at the tracing layer.
- Sessions: 256-bit random opaque ids, stored hashed server-side, cookie `HttpOnly; Secure; SameSite=Lax; Path=/`. Rotate the session id on login and privilege change, enforce idle and absolute timeouts, and delete server-side on logout.
- Return the same response and comparable timing for "unknown user" and "wrong password" to avoid account enumeration; rate-limit both.
- Password reset tokens: single use, short TTL, high entropy, stored hashed, invalidated on password change.

## Transport and headers

- rustls, not OpenSSL. Require TLS 1.2+ (prefer 1.3), disable legacy ciphers, and automate certificate renewal. Terminate at the proxy if it already does TLS, and trust forwarded headers only from that proxy.
- HSTS only after all subdomains are HTTPS-ready; include `max-age`, `includeSubDomains`, and a preload decision made deliberately.
- Send on every response: `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY` or CSP `frame-ancestors 'none'`, and a `Permissions-Policy` that disables unused features.
- CSP: nonce- or hash-based scripts; avoid `unsafe-inline` and `unsafe-eval`. A strict CSP blocks most XSS payloads even when escaping fails.
- CORS: explicit origin allowlist, exact methods and headers, and never `Access-Control-Allow-Origin: *` with credentials. Do not reflect arbitrary `Origin` values.

## CSRF and rate limiting

- Cookie-authenticated state-changing requests need CSRF defense: `SameSite` plus a signed token (double-submit or per-session), and an `Origin`/`Sec-Fetch-Site` check for unsafe methods.
- Rate limit login, registration, password reset, and expensive endpoints by IP and by account. `tower-governor` works in-process; multi-replica deployments need a shared store (Redis) or edge limiting.
- Never trust `X-Forwarded-For` unless the request came from your proxy; otherwise clients spoof the key and bypass limits.
- Add global concurrency limits and request timeouts so a single abusive client cannot exhaust the pool or the worker set.

## One request path, many injection classes

- SQL: parameter binding only (`sqlx` macros/binds). Dynamic identifiers (sort columns, table names) must be whitelisted, never interpolated.
- XSS: rely on framework escaping; sanitize (`ammonia`) before any `inner_html`/raw HTML sink. Serve JSON with `application/json` plus `nosniff`, never as HTML.
- SSRF: for any user-supplied URL, allowlist schemes and hosts, resolve and reject private/link-local/metadata addresses (169.254.169.254, 10/8, 172.16/12, 192.168/16, ::1), disable automatic redirects or re-check each hop, and set short timeouts.
- Path traversal: canonicalize and verify the result stays under the intended root; prefer serving only known asset directories with `tower-http`'s `ServeDir`.
- Open redirect: allowlist return targets or use relative paths only.
- Uploads: enforce size limits, validate magic bytes, store outside the web root with random names, never execute.

## Supply chain and secrets

- `cargo audit` against the RUSTSEC database in CI, plus `cargo deny check` for advisories, licenses, banned crates, and trusted sources. Fail the build on advisories rather than reviewing a log.
- Minimize dependencies and features; a smaller tree is a smaller attack surface and a faster build. Use `cargo tree -d` to spot duplicate crypto stacks (two TLS implementations is a smell).
- Pin with `Cargo.lock`, build with `--locked`, and use a cooldown before adopting fresh releases in production.
- Secrets come from the environment or a secret manager at runtime, never from the repository or the image. Rotate on schedule and on staff departure; log access to production secrets.
- JWT: allowlist the algorithm, verify `iss`, `aud`, `exp`, and `nbf`, reject `none`, and rotate keys. Prefer opaque sessions for browser apps.

## Verify

- Every route has an authorization test: anonymous, wrong user, wrong tenant, admin.
- Cookie flags (`HttpOnly`, `Secure`, `SameSite`) and security headers are asserted in an integration test.
- `cargo audit` and `cargo deny check` pass in CI.
- Grep confirms no `format!`-built SQL and no raw HTML sinks with unsanitized input.
- Login and password reset are rate-limited; responses do not reveal account existence.
- SSRF and upload handlers reject private IPs and oversized payloads under test.

## Docs

- axum: https://docs.rs/axum/latest/axum/
- tower-http (CORS, headers, limits): https://docs.rs/tower-http/latest/tower_http/
- PostgreSQL RLS: https://www.postgresql.org/docs/current/
- Rust API guidelines (error and type safety): https://rust-lang.github.io/api-guidelines/
