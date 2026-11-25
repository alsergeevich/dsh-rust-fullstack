# Leptos 0.8

Baseline: leptos 0.8.23, MSRV 1.88, edition 2021. 0.9.0-rc1 is a pre-release; do not start new production work against it without an explicit decision. The reactive API changed significantly in 0.7 (`signal()`, `Resource::new`, async views), so confirm every symbol against docs for your exact version.

## Mental model

- UI is a function of fine-grained signals. Reading a signal inside a reactive scope subscribes that scope; writing schedules only the affected DOM nodes. There is no virtual DOM diff of whole components.
- Signals are `Copy` and cheap handles. `signal(0)` returns `(ReadSignal<i32>, WriteSignal<i32>)`; `RwSignal::new(0)` gives one handle with `.read()` and `.write()`. Call `.get()` for a copy of `Copy` values, `.with()` for a borrow without subscribing to a clone.
- Derived state belongs in `Memo`, not in a closure that recomputes on every read. `Memo` caches and only recomputes when dependencies change.
- Resources bridge async data into reactivity. Server functions (`#[server]`) are ordinary async fns whose body executes only on the server and whose client stub performs an RPC.
- SSR renders the component tree to HTML, then the same tree hydrates in WASM. Any divergence between server and client markup is a hydration bug, not a cosmetic warning.

## Patterns

- Structure a workspace as `app` (shared, with `ssr`/`hydrate`/`csr` features), `app-frontend` (WASM binary), and `app-server` (axum binary). Feature-gate server-only code with `#[cfg(feature = "ssr")]`.
- Server functions: return `Result<T, ServerFnError>`. Reach shared state with `use_context::<AppState>()` rather than globals, and provide that context in the axum router.
- Wire axum with `leptos_axum`: build `generate_route_list(App)`, then attach `leptos_routes` (and a file/error fallback handler) to your `Router`. Provide the database pool through `leptos_routes_with_context` or `provide_context` so `#[server]` bodies can see it. Function signatures here are the most version-sensitive part; copy them from the current axum integration example.
- Use `Action::new` for mutations: it tracks `pending()` and the last result, which drives disabled buttons and optimistic UI. `ServerAction::<MyFn>::new()` binds an action directly to a server function.
- Use `<Suspense>` for route-level loading and `<Transition>` when stale data should remain visible during refetch. Keep each boundary small so streaming SSR can flush early.
- `cargo-leptos` drives the build: configure `[package.metadata.leptos]` (`output-name`, `site-root`, `site-pkg-dir`, `assets-dir`, `style-file`, `site-addr`, `bin-features = ["ssr"]`, `lib-features = ["hydrate"]`) and use `cargo leptos watch` / `cargo leptos build --release`.
- CSR mode (`csr` feature, `mount_to_body`) is the right choice for dashboards behind auth with no SEO need; SSR is required for public, indexable pages and for fast first paint.
- Serve assets with content hashes and immutable cache headers; `cargo-leptos` fingerprints generated JS/WASM, but verify your own `public/` files are hashed or short-cached.

## Pitfalls

- Hydration mismatches: never render time, randomness, `js_sys` calls, `localStorage`, or `window`-dependent branches during SSR. Compute them in `Effect::new` or after mount.
- `cfg!(feature = "hydrate")` evaluated inside a view produces different trees on server and client. Gate at the component boundary instead.
- Invalid HTML nesting (block elements inside `<p>`, `<div>` inside `<a>`) is silently repaired by the browser, then hydration fails. Keep markup valid.
- Holding a `write()` guard across `.await` deadlocks or panics. Clone the needed value, then await.
- Recreating a resource inside a loop or conditionally can churn requests; create it once per component and key it by signal values.
- `Resource` reads in 0.8 are async-aware; using the wrong accessor yields a stale snapshot. Follow the `Suspense` examples for your version.
- Forgetting `bin-features`/`lib-features` in metadata produces a binary without SSR support or a WASM build without hydration.
- Testing only CSR hides SSR-only panics. Run `cargo leptos build --release` in CI, not just `cargo check`.

## Verify

- `cargo leptos build --release` succeeds with both `ssr` and `hydrate` feature sets.
- Browser console shows no hydration mismatch warnings on first load of every route.
- View source (not devtools DOM) contains real content for public pages.
- `cargo test --features ssr` covers server functions; `wasm-pack test --headless --chrome` covers client behavior if used.
- Request a page with JS disabled and confirm meaningful SSR HTML.

## Docs

- Leptos Book: https://book.leptos.dev/
- API docs: https://docs.rs/leptos/latest/leptos/
- Official examples (axum integration, SSR, server fns): https://github.com/leptos-rs/leptos/tree/main/examples
- axum: https://docs.rs/axum/latest/axum/
