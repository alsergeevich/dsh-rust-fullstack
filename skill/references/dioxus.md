# Dioxus 0.7

Baseline: dioxus 0.7.10, MSRV 1.83, edition 2021. 0.8.0-alpha.3 is alpha; stay on 0.7 for production. Dioxus evolves quickly, so treat hook and router names as version-sensitive and check the 0.7 docs for the exact version.

## Mental model

- Components are functions returning `Element` (a `Result`-like node handle) built with the `rsx!` macro. There is no separate template file and no manual diffing: signals track reads and schedule re-renders of the components that read them.
- Hooks are positional and must run unconditionally in the same order every render, at the top of the component. A hook inside `if` or a loop corrupts state silently.
- `Signal<T>` is `Copy`: pass it into closures and child components by value. Read with `count()` (the `Fn` impl) or `.read()` for a guard; write with `.set(v)`, `.write()`, or `count += 1` for numeric types.
- `use_resource` returns a `Resource<T>` whose state tracks a future. It re-runs when signals read inside its closure change, which is how reactive data fetching works.
- Fullstack mode compiles one app for web/native and attaches server functions as RPC endpoints; `#[server]` fns run only on the server and are stubs on the client.

## Patterns

- App shell: `fn main() { dioxus::launch(App); }` and `#[component] fn App() -> Element { rsx! { Router::<Route> {} } }`.
- Components take typed props: `#[component] fn Card(title: String, #[props(default)] compact: bool) -> Element`. Prefer `ReadOnlySignal<T>` or `Signal<T>` props for live values to avoid re-rendering parents.
- Routing: derive `Routable` on an enum and annotate variants with `#[route("/path/:id")]`; include a catch-all `#[route("/:..segments")] NotFound { segments: Vec<String> }`. `Router::<Route> {}` renders it, and `Link { to: Route::Home {} }` navigates.
- Server functions: `#[server] async fn save_todo(input: Todo) -> Result<Todo, ServerFnError>`. Validate input on the server even when the client already validated it. Return typed errors, not strings.
- Assets: reference files with `asset!("/assets/logo.svg")` so they are fingerprinted and bundled; inject CSS with `document::Stylesheet { href: asset!("/assets/main.css") }`. Do not hardcode `/assets/...` URLs that bypass hashing.
- Desktop and web share components; platform-specific code goes behind `#[cfg(feature = "desktop")]` / `web`. Use `dx serve --platform web` and `dx build --platform desktop` for each target instead of assuming one binary serves both.
- Long work belongs in `spawn(async move { ... })` from an event handler or `use_future`; keep rendering paths cheap and synchronous.
- Style with `dx fmt` in CI to keep `rsx!` diffs reviewable.

## Pitfalls

- Holding a `write()` guard across `.await` blocks other readers and can deadlock. Copy the value out, drop the guard, then await.
- Reading a signal outside a reactive scope (for example in a plain helper before the component runs) does not subscribe; it returns a stale snapshot.
- `use_resource` dependencies are implicit: any signal read in the async closure re-triggers the fetch. Read only what the request actually depends on.
- `for` loops over dynamic lists need stable `key: "{item.id}"` values; index keys reorder DOM incorrectly.
- Calling `use_context` where the provider is not an ancestor panics at runtime. Provide context at the router/layout level.
- Conditional hooks are the most common crash: an early `return` before a hook changes hook order on re-render.
- Web and desktop asset paths differ; absolute filesystem paths break the web build, and relative URLs break desktop bundles.
- Server functions that take large or untrusted payloads need explicit size limits on the server side; the client-side type does not enforce them.
- Debug builds are far slower than `--release`; performance conclusions from `dx serve` default builds are misleading.

## Verify

- `dx build --platform web --release` and `dx build --platform desktop --release` both succeed in CI.
- `dx serve` shows no hook-order panics when toggling routes and auth state.
- Every server function has server-side validation and returns typed errors.
- Dynamic lists use stable keys and survive reorder/insert/delete without lost input focus.
- `dx fmt --check` passes and no `unwrap()` sits in a render path.

## Docs

- Dioxus 0.7 learn guide: https://dioxuslabs.com/learn/0.7/
- API docs: https://docs.rs/dioxus/latest/dioxus/
- Fullstack/server functions and router sections of the guide (most version-sensitive)
- axum integration docs: https://docs.rs/axum/latest/axum/
