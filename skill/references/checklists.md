# Checklists

Use these as literal gates, not inspiration. Copy the relevant list into the PR or release ticket and check items off; an unchecked item needs a written reason.

## Pre-commit

- [ ] `cargo fmt --all` run; no formatting-only noise left in the diff.
- [ ] `cargo clippy --all-targets --all-features -- -D warnings` is clean.
- [ ] `cargo test` (or `cargo nextest run`) passes locally, including new tests.
- [ ] Query changes are followed by `cargo sqlx prepare --workspace -- --all-targets` and the `.sqlx/` diff is committed.
- [ ] No `dbg!`, `println!`, commented-out blocks, or `TODO` without an issue link.
- [ ] No `unwrap`/`expect` added on request input, parsed config, or I/O in production paths.
- [ ] New env vars are documented in `.env.example` and the deployment config.
- [ ] `gitleaks`/secret scan reports no new findings.
- [ ] Commit message states the why, not only the what.

## Pull request

- [ ] Description covers behavior change, risk, rollout, and rollback.
- [ ] Diff is reviewable in one sitting; generated files and lockfile churn are called out.
- [ ] Tests cover success, validation failure, auth failure, and not-found paths.
- [ ] Error responses use the standard envelope with stable codes.
- [ ] New spans, metrics, or log lines exist for new failure modes.
- [ ] No N+1 queries: list endpoints fetch related rows in a bounded number of queries.
- [ ] Migrations are additive or expand/contract; locks and duration are estimated.
- [ ] OpenAPI/schema diff reviewed if the API changed.
- [ ] Frontend changes work without JS where SSR is promised, and hydration warnings are checked.
- [ ] Docs/CHANGELOG updated when behavior or operations change.

## Security review

- [ ] Every new route is authenticated by default and has an authorization test (other user, other tenant).
- [ ] Input is validated server-side; identifiers are whitelisted, never interpolated into SQL.
- [ ] Secrets, tokens, and PII are absent from logs, errors, and traces.
- [ ] `cargo audit` and `cargo deny check` pass; no new advisory ignored without a written exception.
- [ ] State-changing cookie-authenticated endpoints have CSRF protection.
- [ ] Rate limits cover login, registration, password reset, and expensive endpoints.
- [ ] Security headers and CSP are asserted by a test.
- [ ] File uploads validate size and type and are stored outside the web root.
- [ ] Any outbound URL from user input is allowlisted, and private/metadata IPs are blocked.
- [ ] Error messages do not disclose stack traces, SQL, or internal identifiers.

## Release

- [ ] Version bumped and changelog finalized; tag matches the artifact.
- [ ] CI green on the exact commit being deployed.
- [ ] Migration job ran and `_sqlx_migrations` shows the expected version.
- [ ] Image built with `--locked`, scanned, signed, and tagged by digest.
- [ ] Config and secrets verified in the target environment, not inherited from staging.
- [ ] Readiness passes in the new version and liveness stays green for ten minutes.
- [ ] Error rate, p99 latency, and saturation dashboards watched during rollout (canary or one replica first).
- [ ] Smoke test covers login, one read, one write, and asset loading.
- [ ] Previous image digest and rollback command are recorded in the release ticket.
- [ ] Runbook and on-call notes mention anything new that can page.

## Incident

- [ ] Acknowledge, assign a severity, and open one incident channel; keep side discussions out of it.
- [ ] State user impact in plain terms first; root cause can wait.
- [ ] Mitigate before diagnosing: roll back, disable the flag, shed load, or scale out.
- [ ] Post status updates on a fixed cadence even when there is no news.
- [ ] Preserve evidence: logs, traces, slow queries, `pg_stat_activity`, and a snapshot before destructive fixes.
- [ ] Prefer reversible mitigations; take a backup before any data repair.
- [ ] Record a timestamped timeline as you go, not from memory later.
- [ ] Verify recovery with the same signals that detected the incident.
- [ ] Schedule a blameless postmortem within 48 hours.
- [ ] File action items with owners and dates; monitoring gaps are first-class items.

## Verify

- [ ] These lists live in the repository (PR template, release template), not in a wiki nobody opens.
- [ ] CI enforces the machine-checkable items (fmt, clippy, tests, audit, sqlx prepare).
- [ ] The last three releases show every checklist item checked or justified.
- [ ] The last postmortem produced action items that are actually closed.

## Docs

- Cargo (build, lockfile, profiles): https://doc.rust-lang.org/cargo/
- axum (routing, graceful shutdown): https://docs.rs/axum/latest/axum/
- tower-http (headers, limits, tracing): https://docs.rs/tower-http/latest/tower_http/
- PostgreSQL operations: https://www.postgresql.org/docs/current/
- SQLite backup and integrity: https://www.sqlite.org/docs.html
