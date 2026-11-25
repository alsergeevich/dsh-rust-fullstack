# Rust Core for Production Services

Version baseline: Rust stable 1.100.0 (2026-11-12). Verify exact toolchain and edition behavior against the official docs for the version you actually run.

## Mental model

- Ownership is the API contract, not an obstacle: a signature states who allocates, who mutates, and who frees. If a caller must keep a value, return it; if only reading is allowed, take `&T`; if ownership transfers, take `T`.
- Borrowing behaves like a compile-time reader/writer lock: many `&T` or one `&mut T`, never both. Design data flow so the mutable phase is short and ends before the next read.
- Lifetimes are constraints on references, not storage. Structs hold `String`, `Vec<T>`, `Arc<str>`, or `Bytes`; reserve lifetimes for zero-copy views (`&'a str`, `Cow<'a, str>`) at true boundaries such as parsers and request bodies.
- Traits are the substitution seam. Abstract over I/O (`tower::Service`, repository traits) at module boundaries; do not abstract over plain data. Prefer concrete types until a second implementation exists.
- `Send + Sync + 'static` is the price of `tokio::spawn`. If a future is not `Send`, the compiler names the offending field or guard; fix the state, do not reach for `LocalSet`.

## Patterns that hold up

- Errors: libraries and domain crates use `thiserror` enums with `#[from]` for boundaries; binaries and request handlers use `anyhow::Result` only at the top, then convert to a typed HTTP error. Never expose `anyhow` in a public library API.
- Use newtypes for identifiers (`UserId(Uuid)`) so two IDs cannot be swapped silently.
- Accept `impl AsRef<Path>` / `impl Into<String>` sparingly; each generic parameter increases monomorphization and compile time.
- Share immutable payloads with `Arc<str>` or `bytes::Bytes` instead of cloning `String` per task.
- In async code, keep critical sections short. Use `std::sync::Mutex` when no `.await` happens inside the lock and `tokio::sync::Mutex` only when it must; prefer channels or `ArcSwap` for read-mostly state.
- `#[instrument(skip(pool, password), fields(user_id = %id))]` gives structured spans with secrets excluded.
- Edition 2024 (stable since 1.85): `unsafe extern` blocks, `&raw` references, `gen` reserved, RPIT captures all in-scope lifetimes by default, and temporary-scope changes for `if let` and tail expressions. Confirm each with `cargo fix --edition` rather than assumptions.
- MSRV: set `rust-version` in every `Cargo.toml`, keep `edition = "2024"` with `resolver = "3"` so resolution respects MSRV, and test the floor in CI (`cargo +1.88 check`). Bump MSRV only in a minor release with a changelog note.
- Cargo lints: centralize in the workspace with `[workspace.lints.rust]` and `[workspace.lints.clippy]`, then `lints.workspace = true` per crate. `unsafe_code = "forbid"` in crates that need none.
- Supply chain: enforce a cooldown before adopting new dependency releases (hold updates for a few days) in your update bot, and pin with `Cargo.lock` committed for binaries. Cargo has no built-in cooldown knob; the policy lives in the bot.
- `const fn` for small pure constructors and lookup tables; keep it simple, since const evaluation rejects many operations. `unsafe` only with a `// SAFETY:` comment stating the invariant, plus Miri coverage.

## Pitfalls

- Cloning to silence the borrow checker hides O(n) copies in hot paths. Restructure scopes instead; measure before optimizing.
- Holding a `std::sync::MutexGuard` across `.await` makes the future `!Send`; the error usually appears at `tokio::spawn`, not at the lock.
- Calling blocking APIs (`std::fs`, `reqwest::blocking`, CPU-heavy code) on the runtime starves all tasks: use `tokio::task::spawn_blocking` or `spawn_blocking` offloads.
- `async fn` in traits is stable but not dyn-compatible; use `#[trait_variant::make]`, boxed futures, or generics. Verify the current story in the docs.
- `select!` drops the losing branch mid-flight. Only poll cancellation-safe futures there; otherwise use `join!` or a supervisor task.
- Ignoring `JoinHandle` results loses panics and errors. Await or log them.
- `static mut` and global `OnceLock<Mutex<...>>` caches are test-order hazards; prefer injected state.
- Overusing `Deref` and `From` impls creates implicit conversions that make call sites ambiguous at review time.

## Verify

- `cargo check --all-targets --all-features` and `cargo clippy --all-targets -- -D warnings` pass.
- `cargo test` plus `cargo miri test` for crates containing `unsafe`.
- `cargo tree -d` shows no unintended duplicate major versions.
- `cargo +<MSRV> check` succeeds on the declared floor.
- Every `unsafe` block has a `// SAFETY:` justification.

## Docs

- The Rust Book: https://doc.rust-lang.org/book/
- The Rust Reference (edition semantics): https://doc.rust-lang.org/reference/
- Cargo book (lints, resolver, MSRV): https://doc.rust-lang.org/cargo/
- Rust API guidelines: https://rust-lang.github.io/api-guidelines/
- Clippy lint list: https://rust-lang.github.io/rust-clippy/master/
