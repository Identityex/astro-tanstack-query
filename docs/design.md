# `astro-tanstack-query` — design

**What this is.** The design for a publishable Astro integration that makes
one TanStack Query cache ambient across every island on a page — React,
Svelte, Vue, Solid, Preact, Alpine, a vanilla `<script>`, and htmx — with
explicit server prefetch with automatic dehydration/hydration, and per-request isolation
on the server enforced by construction. `example/` is its framework-neutral
consumer fixture. This document records the package design and the reasoning
behind it; the [README](../README.md) is the user guide.

> This is a community project. It is not affiliated with, or endorsed by, the
> Astro or TanStack teams.

**Verified against:** `astro` 7.3.5 · `@tanstack/query-core` 5.103.2 ·
`nanostores` 1.5.4 · `@nanostores/react` 2.0.1 · `@nanostores/vue` 1.1.0 ·
`svelte` 5.57 · `react` 19.3 · `vue` 3.5 · `solid-js` 1.9 ·
`htmx.org` 2.0.11 · `devalue` 5.9.4 · Node 24.
Every claim marked _verified_ was read from the installed source or
measured in the spike; nothing here rests on documentation from memory.

**Status vocabulary.** DECIDED — settled, reopen only with a note in §13.
VERIFIED — proven in the spike or read from source. OPEN — known, not yet
resolved. ACCEPTED — a risk taken knowingly, mitigation written down.

---

## 0. Why, in one paragraph

Astro renders islands as independent mounts. Every existing way to use
TanStack Query in Astro therefore gives each island its own cache: N islands
make N requests for the same data, an invalidation in one island is
invisible to the rest, and two islands in different frameworks cannot share
anything at all. The well-known workaround — a module-scoped `QueryClient`
passed into `@tanstack/react-query` hooks — needs a TanStack adapter per
framework (there is none for Alpine, Lit, or a plain script), risks two
copies of `query-core` in one page, and silently loses the adapter-level
optimisations (tracked re-renders, focus/online refetch) unless each island
re-implements them. Worse, the same module-scoped client on the server is
shared across requests: the spike served Alice's prefetched data to Bob and
Carol the moment a `staleTime` was set — a latent leak that only appears
once the cache starts doing its job. This package fixes all of that with
one bridge (`QueryObserver` → nanostore) instead of N adapters, one lazily
created client per page, one per-request client on the server that stores
reach through `AsyncLocalStorage`, and an integration that wires it so a
consumer writes zero plumbing.

---

## 1. What the spike proved — VERIFIED

Throwaway Astro 7.3.2 project, production `astro build`, `@astrojs/node`.

| Claim                                                                                    | Evidence                                                                                                                              |
| ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| One cache across React, Svelte, Vue, Solid **and** a vanilla page script                 | `moduleEvaluations: 1`, `distinctClients: 1`, **1 network request for 5 consumers**                                                   |
| Rollup hoists the shared module into one chunk with no aliasing                          | all five entry chunks import the same chunk; only one chunk defines `QueryCache`                                                      |
| Invalidation from one framework reaches every other                                      | click in React → all five show the new value; **1 refetch, not 5**                                                                    |
| `client:only` behaves like `client:load`                                                 | identical numbers                                                                                                                     |
| Module-scoped server client leaks across requests                                        | `user=bob` → `secret-for-alice` once `staleTime: 60_000` is set; invisible at `staleTime: 0`                                          |
| Per-request client on `locals` does not leak                                             | `user=bob` → `secret-for-bob`                                                                                                         |
| `AsyncLocalStorage` scope reaches islands **during their SSR render**, under concurrency | 6 interleaved requests, 3 users, 120 ms overlap: every React and Svelte island saw its own request's client                           |
| htmx can be served from the cache                                                        | `onEvent('htmx:beforeRequest')` returning `false` aborts the request; `htmx.swap()` renders the cached fragment; 3 clicks → 1 request |
| Svelte needs no adapter                                                                  | `@nanostores/svelte` does not exist; nanostores satisfy the Svelte store contract, `$store` auto-subscribes                           |
| The bridge is small                                                                      | `client.ts` 22 lines + `bridge.ts` 27 lines                                                                                           |

Measured cost, minified + gzip (esbuild, production):

| Piece                                                        | gzip    | brotli  |
| ------------------------------------------------------------ | ------- | ------- |
| `query-core`: `QueryClient` + `QueryObserver`                | 9.1 KB  | 8.3 KB  |
| + `hydrate`                                                  | 9.5 KB  | 8.7 KB  |
| + `InfiniteQueryObserver` + `MutationObserver` + `dehydrate` | 10.4 KB | 9.5 KB  |
| `nanostores`: `atom` + `onMount`                             | 0.7 KB  | 0.66 KB |
| `nanostores`: + `computed`                                   | 0.95 KB | 0.86 KB |
| `devalue` `parse` only                                       | 2.2 KB  | 1.96 KB |

`query-core` has ~1.3 KB of internal tree-shaking headroom, because a
`QueryClient` always constructs both caches. The wins that matter are
structural (§7): a page with no stores ships nothing, and optional pieces
sit behind their own entry points.

---

## 2. Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Status  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| D1  | The package is **`astro-tanstack-query`**, published from its own repository. The example app exercises the public package API.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | DECIDED |
| D2  | **One bridge, no per-framework adapters.** `@tanstack/query-core` `QueryObserver` → a nanostore. Every framework Astro renders reads it through the nanostores adapter it already has (`@nanostores/react`, `/vue`, `/preact`, `/alpine`, `/lit`; Svelte natively; Solid through its core `from(store, store.get())`; vanilla via `subscribe()`). Solid does not use `@nanostores/solid`: its `useStore` reconciles each update into the previous value, which is query-core's tracked result, so it writes one key's data into another key's cached object, and reconciling reads every property, which turns off tracked re-renders (D8) for every consumer of that store (_verified_ against 1.1.1). The package never depends on `@tanstack/react-query` or any UI framework.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | DECIDED |
| D3  | **Browser: one `QueryClient` per page, created lazily** on first import of the store module — never injected page-wide — `mount()`ed once, hydrated from a DOM blob at creation, re-hydrated on `astro:before-swap`, and from each server island's id-less state element as Astro inserts it (a `MutationObserver` on `document`, started with the client, plus one drain at creation). Pages with no stores ship zero bytes of this package.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | DECIDED |
| D4  | **Server: one `QueryClient` per request**, created by injected middleware, exposed on `Astro.locals.queryClient` and inside an `AsyncLocalStorage` scope that stores read during SSR. Server code can only reach a client through the request; no importable server singleton exists.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | DECIDED |
| D5  | **Stores never fetch on the server.** During SSR, `get()`/`subscribe()` return a snapshot of the request client (`getCurrentResult()` on a transient observer created with `_optimisticResults: 'optimistic'`, so the snapshot reports what a mount would do, but never fetches). Prefetching is explicit: `await $store.prefetch()` in frontmatter. A prefetch must be awaited before any island that reads its key renders. An unawaited one either loses its result (still in flight when the state is written: it is not emitted, and development and prerendering warn) or causes an SSR/hydration mismatch if it settles mid-render. To keep the head streaming, start the prefetch early (`const p = $x.prefetch()` in the layout or page) and `await p` in a nested component that wraps the island.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | DECIDED |
| D6  | **Dehydrated state is emitted automatically** by the middleware as `<script type="application/json" id="astro-tq">` before the document's final `</body>`, via a streaming transform on uncompressed UTF-8 `text/html` responses only, at stream flush (after every awaited prefetch has finished; a query still pending then is never emitted). A `</body>` followed by anything other than whitespace and `</html>` is content and streams on. Then `queryClient.clear()`. A fragment (no `<!doctype`, `<html` or `<body` tag) gets no state element. The one exception is the server-island route (`routePattern === "/_server-islands/[name]"`, exported as `SERVER_ISLAND_ROUTE`): its response gets `<script type="application/json" class="astro-tq">` with no id, appended at its end, so it can never shadow the page's `#astro-tq`. The branch is keyed on the route, not on "is a fragment", so htmx partials stay excluded. A `<QueryState />` component is the explicit alternative (`emit: 'component'`); it captures prefetches awaited in page or layout frontmatter, not those in component frontmatter that Astro renders concurrently with it, and takes the same server-island branch via `Astro.routePattern`. In both modes the middleware releases the request client exactly once per response: a response with a body (a page, a JSON endpoint, a stream) at stream flush or cancel, a response with no body at once. | DECIDED |
| D7  | **Hydration ordering is enforced by the browser query module.** It awaits document parser readiness before evaluating query consumers, so streamed end-of-body state exists before an island’s first read. The wait ends when `document.readyState` leaves `loading`, before `DOMContentLoaded`, which a deferred module must not await (§3.1).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | DECIDED |
| D8  | **Tracked queries are on by default** through `QueryObserver.trackResult()`: the store's value is the Proxy, so any framework reading `.data` gets notified only when the props it read change. `notifyOnChangeProps` is passed through; `'all'` disables tracking.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | DECIDED |
| D9  | **Serialization defaults to JSON with XSS-safe escaping** (`<`, `>`, `&`, U+2028/2029) — zero dependencies. `devalue` (Date, Map, Set, `undefined`, BigInt) is opt-in via `serializer: 'devalue'` and its own entry point, because it is 1.7 KB gzip — about a seventh of the whole runtime. That figure is `parse` alone, and it only holds because the serializer ships as two independently-importable halves: a `reader` the browser loads and a `writer` only the server does (§7). Fused into one object it would be 4.0 KB, since a property cannot be shaken off a live object.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | DECIDED |
| D10 | **Reactive parameters use nanostores idiom**, not magic: `createQuery(optionsOrStore)` accepts a `ReadableAtom` of options (compose with `computed`, or `derived` when a store from this package is one of the sources — §4.2); the observer's `setOptions` follows it. `family(fn)` memoises stores by `hashKey` for imperative cases and drops an entry once it has gone unmounted for nanostores' unmount delay, counted from its creation or its last unmount. The entry goes whether or not it ever mounted, so members used only for `prefetch`/`setData`/`invalidate`/`refetch`/`key` do not live for the page client's life. A held member that first mounts after eviction puts itself back.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | DECIDED |
| D11 | **Astro Actions are the typed transport; Query is the cache.** The helpers take Astro's own `ActionClient`. `actionMutation(action)` and `actionQuery(action, input?)` expose `ActionErrorOf<A> \| DefaultError`: the Action's `ActionError<TInput>`, or the plain `Error` a failed request rejects with, since `.orThrow()` fetches and a failed fetch never becomes an `ActionError`. The package's `isActionError(error)` narrows to `ActionError<TInput>`, so `isActionError(error) && isInputError(error)` types `fields` by the schema. `actionQuery` is `createQuery(actionQueryOptions(action, input?))`, whose `DataTag`-typed key composes with `family`, options stores and `getQueryData`. The input is optional exactly when the Action accepts `undefined`. Both use `.orThrow()` in the browser; on the server `actionQuery` uses the request’s `callAction`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | DECIDED |
| D12 | **htmx ships as a separate entry** (`astro-tanstack-query/htmx`): read-through cache for `hx-get`, `setQueryData` on response, and invalidation surfaced as a DOM event (`tanstack-query:invalidated` on `document.body`) that elements opt into with `hx-trigger` — no DOM registry, no re-implemented swap.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | DECIDED |
| D13 | **Devtools are the framework-agnostic `@tanstack/query-devtools`** (Solid inside, bundled; no framework peer), mounted by a dev-only `<QueryDevtools />` component that lazy-imports it. Optional peer.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | DECIDED |
| D14 | **Every optional piece is its own entry point** with an enforced size budget (§7). Root export is the integration, matching `@astrojs/*` convention.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | DECIDED |
| D15 | **Isomorphic store module, runtime-checked** (`typeof window === 'undefined'`), not package `exports` conditions. Each check is written inline as `(!browserBuild && isServer())`: the virtual config sets `browserBuild` only in a client build, so Vite deletes the server branch there (measured at 200–365 B gzip per page), while SSR, prerender and tests keep the runtime check. Export-condition resolution across Node/workerd/edge-light/browser is a known footgun, and the flag recovers those bytes without it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | DECIDED |
| D16 | **TanStack Router and typed URL state are out of scope.** A Router SPA island simply passes `getQueryClient()` into its router context; a recipe, not a feature.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | DECIDED |
| D17 | Astro peer `^7.3.0`; `@tanstack/query-core ^5.90.0`; `nanostores ^1.0.0`. Widen supported Astro versions only after their consumer fixtures pass. Current ranges are declared in the package’s `package.json`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | DECIDED |

---

## 3. Runtime model

```
                 ┌─────────────────────── browser (one page) ───────────────────────┐
                 │  astro-tanstack-query/query  (module singleton, lazy)             │
                 │    QueryClient ── mount() ── hydrate(<#astro-tq>) ── before-swap  │
                 │        ▲                                                          │
                 │   QueryObserver ──trackResult──▶ nanostore ─▶ @nanostores/react   │
                 │   QueryObserver ──trackResult──▶ nanostore ─▶ $store (Svelte)     │
                 │   QueryObserver ──trackResult──▶ nanostore ─▶ @nanostores/vue     │
                 │   QueryObserver ──trackResult──▶ nanostore ─▶ subscribe() vanilla │
                 │   htmx extension ─────────────▶ getQueryData / setQueryData        │
                 └───────────────────────────────────────────────────────────────────┘
                                          ▲  <script id="astro-tq" type="application/json">
                                          │  (end of body, emitted at stream flush)
┌──────────────────────────────── server (one request) ────────────────────────────────┐
│ middleware (order:'pre')                                                             │
│   client = new QueryClient(defaults)                                                 │
│   locals.queryClient = client                                                        │
│   scope.run({ client, url, callAction }, next)  ── AsyncLocalStorage                 │
│       frontmatter:  await $thing.prefetch()  ──▶ client.prefetchQuery($thing.options)│
│       island SSR:   $thing.get()  ──▶ new QueryObserver(scope.client).getCurrentResult()│
│   response.body.pipeThrough(inject(dehydrate(client)))  →  client.clear()            │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.1 Browser lifecycle — VERIFIED where marked

1. Importing `astro-tanstack-query/query` in the browser first awaits document parser
   readiness. The first query consumer then creates the page `QueryClient` lazily with
   the configured defaults, calls `mount()` once, reads `script#astro-tq` (§8), and
   hydrates before its observer reads the result. `mount()` connects focus and online
   managers. Waiting for `interactive` rather than `DOMContentLoaded` allows a deferred
   importing module to finish without deadlocking the document event.
2. A store's `onMount` (first listener) subscribes its one `QueryObserver`
   through `notifyManager.batchCalls`; each notification stores
   `observer.trackResult(result)`. The observer decides whether to notify
   (_verified_: `queryObserver.ts:761-786` uses `#trackedProps` when
   `notifyOnChangeProps` is unset).
3. Last listener leaves → nanostores waits `STORE_UNMOUNT_DELAY` (1 s,
   _verified_) → unsubscribe → the observer `destroy()`s itself
   (_verified_: `destroy()` sets no dead flag; re-subscribing re-adds it,
   so one observer per store is reused across mount cycles) → the Query's
   `gcTime` timer starts.
4. `get()` on an unmounted store mounts it (_verified_: nanostores `get()`
   calls `listen(()=>{})()`), so a vanilla `$thing.get()` starts the fetch.
   The value returned is the current snapshot; results arrive on the
   next `notifyManager` tick (`systemSetTimeoutZero`, _verified_). The
   server snapshot uses optimistic results (§3.2(3)), so `status`,
   `isPending`, `isLoading`, `isFetching` and `fetchStatus` on the first
   client render equal the server render, as in React Query: a query that
   will fetch on mount reports `fetchStatus: 'fetching'` on both sides.
   With the default `ssr.staleTime` of 60 s, hydrated data is fresh and no
   refetch starts. The only remaining divergence is time-based: staleness
   is computed at render time on the server and at hydration in the
   browser, so HTML cached (ISR/CDN) for longer than `ssr.staleTime` can
   still differ on `isFetching`. Errored prefetches are not dehydrated
   (§3.2(4)), so for a query that fetches on mount both sides render them
   as pending and loading, not as an error. One that does not
   (`enabled: false`, or `retryOnMount: false`: query-core's
   `shouldFetchOnMount` is false for an errored query then) keeps
   `status: 'error'` in the server snapshot, while the browser starts from
   a fresh pending query: a mismatch. The shared cache adds one case no
   snapshot can match: an island that hydrates after another island or a
   script has already fetched an un-prefetched query reads data where the
   server rendered pending.
5. `astro:before-swap` (View Transitions): read `event.newDocument`'s
   `script#astro-tq`, `hydrate()` into the existing client. Safe by
   construction: `hydrate` only overwrites when `dataUpdatedAt` is newer
   (_verified_: `hydration.ts:314-316`). Module scripts are not re-run
   across navigations, so the cache persists — the site behaves like an
   SPA cache on an MPA.
6. Server islands: Astro inserts a `server:defer` response with a single
   `before(createContextualFragment(html))` call
   (`runtime/server/render/server-islands.js`). The page client's
   `MutationObserver` (`childList` + `subtree` on `document`) then drains
   every `.astro-tq` element. For each, it drops the class and, only when
   the element is a `<script>` (§8), checks `data-serializer` (a mismatch
   throws, as in §9) and calls `hydrate()`.
   The observer's microtask is queued at insertion, before any nested
   `astro-island` finishes the awaited import that precedes its
   hydration, so the nested island's first read sees the state (D7). A
   drain also runs when the client is created, for a page whose first
   store read comes from inside an island that has already arrived.
   Nothing is checked on the read path: a live collection walks the
   document again after every DOM change, and reads run on every render.
   The cost is one document walk per mutation batch. Known limit: a
   browser fetch already in flight for the same key is not cancelled;
   `hydrate()` only fills the data.

### 3.2 Server lifecycle

1. Middleware (`order: 'pre'`) first throws `window-on-server` if a global
   `window` exists (§8). It then creates the request client with
   `defaultOptions` merged from config plus `staleTime` from the integration
   option (`ssr.staleTime`, default 60 s — TanStack's own SSR guidance; a
   `queries.staleTime` in the config wins, and the page client takes the
   same defaults), puts it on `locals.queryClient`, and wraps `next()` in
   `scope.run()`. With `ssr.origin` set, the scope URL is
   `new URL(pathname + search, ssr.origin)`. `Infinity` is only the server
   default for `gcTime` (_verified_: `removable.ts:24-29`). An explicit
   `gcTime`, from the `config` module or on a store, arms an eviction timer
   for each query, including a query that a server store read merely adds
   (`removable.ts:14-21` never checks for a server). The end-of-request
   `clear()` cancels those timers, which is why every response must reach
   it (item 4).

   `Astro.rewrite()` re-enters the middleware inside the outer pass's
   scope. A pass that finds a scope (`currentScope()`) reuses its client,
   enters a new scope with the rewritten `context.url`, and returns its
   response untouched; only the outermost pass calls `injectState`, so D4
   (one client per request) and D6 (one emission) hold across a rewrite.
   Re-entry is keyed on the ALS scope, not on `locals`, because Astro
   renders an error page with the failed render's `locals` object (the
   Vercel adapter always passes one) but outside its scope. A render that
   rejects before responding clears the outermost client, since it never
   reaches `injectState`.

2. Frontmatter prefetches: `await $thing.prefetch()`; an optional
   server-only fetcher may be passed (`prefetch(() => db.select(...))`) so
   database code never enters a module islands import.
3. Island SSR reads a store: `get()` → resolve the scope → transient
   observer → `getCurrentResult()`. No `subscribe`, so no fetch
   (_verified_: fetching happens in `onSubscribe`, `queryObserver.ts:110-116`).
   The query and infinite query factories give that observer
   `_optimisticResults: 'optimistic'`, as the official React, Vue, Svelte
   and Solid adapters do, so the result reports the fetch a mount would
   start (`isLoading`/`isFetching`, `fetchStatus: 'fetching'`) without
   starting it. The cache entry's own `fetchStatus` stays `idle`. Mutation
   stores do not take the flag; their options have no such field.
   `subscribe(cb)` on the server calls `cb(snapshot)` once and returns a
   no-op; `listen` is a no-op. This satisfies every adapter's server path
   (_verified_: React and Vue read `store.get()`; Solid's server `from`
   calls `subscribe`, which emits the snapshot synchronously; Svelte uses
   `subscribe`).
4. Response: `injectState(response, client, writer, { warn, island })`. If
   `content-type` is HTML, the body is a stream, and it is neither
   compressed (`content-encoding` other than `identity`) nor declared in a
   charset other than UTF-8, pipe it through a `TransformStream`. The
   transform holds back a `</body>` candidate for as long as only
   whitespace and `</html>` can follow it. On `flush` it calls
   `stateScript()` and writes the element before the document's final
   `</body>`, or appends it when there is no `</body>` or content follows
   it. A fragment gets no state element, except on the server-island
   route, where the state is appended as the id-less `class="astro-tq"`
   element (D6). In development, a fragment that drops successfully
   prefetched queries logs one warning per process, naming their query
   hashes only. Then `client.clear()`, in a `finally`. The transformer's
   `cancel` also clears: on a client disconnect, Astro's node writer
   cancels the reader and `flush` never runs. A response with no body (a
   redirect, an empty response) is cleared at once and returned as the
   same object, which Astro's handling of a bodiless reroute relies on.
   Every other response goes through a byte-identity stream that clears
   only at flush or cancel: a non-HTML body (a JSON endpoint, a stream), a
   page in `emit: 'component'`, where the middleware passes a `null`
   writer, and a compressed or legacy-charset page, which also gets one
   dev warning per process pointing to `emit: 'component'`. `next()`
   resolves once the frontmatter has run, and Astro renders components as
   the body is read, `<QueryState />` among them in component mode, so no
   response with a body may lose its client before its stream ends.

   `stateScript()` dehydrates with the config's
   `dehydrate.shouldDehydrateQuery` (default `defaultShouldDehydrateQuery`,
   _verified_), ANDed with `status !== 'pending'`, and skips emission if the
   result is empty. The default keeps `success` only, which is the whole
   reason an error never reaches the blob — `shouldRedactErrors` has no
   default and is consulted only for a _pending_ query's promise, so it is
   not the guard here. A pending query is never emitted, even under a user
   predicate: one end-of-body blob cannot resume a promise, and query-core
   attaches one to every pending query it dehydrates (under JSON it arrived
   as `{}` and `hydrate()` threw; under devalue `stringify()` threw on the
   server). Overriding `shouldDehydrateQuery` gives up the error guard, not
   the pending one. If `writer.stringify` throws, each query is serialized
   alone; those that fail are dropped and one `console.error` names their
   hashes and the serializer's message (never data); if none survive, no
   element is written, and the response always completes. With `warn` (the
   middleware and `<QueryState />` set it in development and while
   prerendering), one `console.warn` per request names queries still
   fetching and queries in `error`.

5. No `AsyncLocalStorage` (exotic runtime): stores return a pending,
   loading result during SSR (`isLoading: true`, matching the browser's
   first read, which fetches because nothing was dehydrated). The
   placeholder is shaped by a throwaway client built with the request and
   page clients' defaults (the config's `defaultOptions` and
   `ssr.staleTime`), so a default that decides whether a mount fetches,
   such as `enabled` or `refetchOnMount`, reads the same on both sides.
   `locals.queryClient` still works, the blob still emits, and dev logs
   one `console.warn`. ACCEPTED: Cloudflare and Vercel Edge lose ALS
   context across _non-native_ thenables; Astro's render pipeline uses
   native promises, and the fallback path exists.

---

## 4. Public API

### 4.1 `astro-tanstack-query` — the integration (root export)

```ts
// astro.config.mjs
import { defineConfig } from "astro/config";
import tanstackQuery from "astro-tanstack-query";
export default defineConfig({
  integrations: [
    tanstackQuery({
      config: "./src/query.config.ts", // optional: exports { defaultOptions }
      serializer: "json", // or "devalue"
      emit: "middleware", // or "component"
      ssr: {
        staleTime: 60_000, // default staleTime of the request and page clients
        origin: "https://example.com", // optional, no default: what server absoluteUrl() resolves against
      },
      devtools: true, // dev only; also adds a toolbar app
    }),
  ],
});
```

### 4.2 `astro-tanstack-query/query` — the isomorphic store API

```ts
import {
  createQuery,
  createInfiniteQuery,
  createMutation,
  createIsFetching,
  createIsMutating,
  derived,
  family,
  queryOptions,
  getQueryClient,
  absoluteUrl,
} from "astro-tanstack-query/query";

export const $thing = createQuery({
  queryKey: ["thing"],
  queryFn: async ({ signal }) => (await fetch(absoluteUrl("/api/thing"), { signal })).json(),
});

// reactive parameters: options as a store. `computed` is safe here: its source is a plain
// atom, and every change to a plain atom is a store write — which is exactly what invalidates
// computed's cache. Deriving from a store of *this* package is the unsafe case; use `derived`.
export const $posts = createQuery(
  computed($page, (page) =>
    queryOptions({ queryKey: ["posts", page], queryFn: () => fetchPosts(page) }),
  ),
);

// imperative families
export const $post = family((slug: string) =>
  queryOptions({ queryKey: ["post", slug], queryFn: () => fetchPost(slug) }),
);

// derived values: `derived`, never nanostores' `computed` — see below
export const $thingValue = derived($thing, (result) => result.data?.value ?? "…");
```

A `QueryStore` is a read-only nanostore whose value is a
`QueryObserverResult`, plus:

| Member                     | Meaning                                                                                                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `options`                  | the resolved options (`queryKey`, `queryFn`, …); `queryKey` is typed as a `DataTag`, so `getQueryClient().getQueryData(options.queryKey)` infers the cached type |
| `prefetch(serverQueryFn?)` | server: `prefetchQuery` on the request client; browser: on the page client                                                                                       |
| `refetch(options?)`        | browser only; re-syncs the observer to the current options first, then `observer.refetch(options)` (`RefetchOptions`)                                            |
| `invalidate(options?)`     | `invalidateQueries({ queryKey, exact: true }, options)` (`InvalidateOptions`) on the right client                                                                |
| `setData(updater)`         | `setQueryData` on the right client                                                                                                                               |
| `key`                      | `hashKey(queryKey)`                                                                                                                                              |

`QueryStore` takes a trailing result-type parameter; `createQuery`,
`queryOptions` and `family` have a first overload for options whose
`initialData` is always defined and return `DefinedQueryStore` (value
`DefinedQueryObserverResult`, so `data` is never `undefined`), as the
official adapters do. `createInfiniteQuery` does the same with
`DefinedInfiniteQueryStore`. The runtime already guarantees it: every client
a store reads builds the Query from `initialData`.

`createInfiniteQuery` mirrors it over `InfiniteQueryObserverResult` — same
`key`, `options`, `prefetch`, `refetch`, `invalidate`, `setData`. Its
`prefetch(serverQueryFn?)` takes a server-only fetcher and calls
`prefetchInfiniteQuery`, and its `options.queryKey` is tagged with
`InfiniteData<TQueryFnData, TPageParam>`. Paging is not among them:
`fetchNextPage`/`fetchPreviousPage` live on the result, as in every Query
adapter, so it reads `$pages.get().fetchNextPage()`.

`createMutation` yields a store of `MutationObserverResult` plus
`mutate`/`mutateAsync`/`reset`. Each call holds a store listener until it
settles, because `MutationObserver` fires per-call callbacks only while it
has listeners. Per-call callbacks therefore fire for callers that never
subscribe, and after the calling island has unmounted.

`createIsFetching(filters?)` and `createIsMutating(filters?)` are the
`useIsFetching`/`useIsMutating` equivalents. Each is a read-only
`ReadableAtom<number>` that counts the page client's fetching queries or
pending mutations across every island. They are cache-subscription stores,
not observer stores, so D2's one-observer bridge is unaffected. The filters
are plain values fixed at creation. `onMount` reaches `pageClient()` and
subscribes to its query or mutation cache through
`notifyManager.batchCalls`, so the page client is still created only on
first use (D3). On the server each returns a constant `atom(0)` before any
`onMount`: it never reads `requestScope()`, so no request client reaches a
module-level atom (D4). Nothing fetches or mutates during SSR (D5), so 0 is
the correct snapshot. It matches upstream's `getServerSnapshot`, and it
means the first browser value can differ from the SSR HTML.

`getQueryClient()` returns the page client in the browser and the request
client on the server (throws a clear error when called on the server
outside a request). Everything else — `select`, `placeholderData`,
`initialData`, `enabled`, `refetchInterval`, `retry`, `networkMode`,
`staleTime`, `gcTime`, `structuralSharing` — is `QueryObserverOptions`,
passed through untouched, except `throwOnError` and `suspense`, which
`QueryStoreOptions` leaves out (D2: they need an error boundary or
Suspense; query-core only tracks `error` for `throwOnError`, and `suspense`
stops an errored query refetching on a key change). `MutationStoreOptions`
leaves out `throwOnError`.

`derived($source, fn)` is how a value is read off one of these stores — a
title, a formatted count, a filtered list. Use it rather than nanostores'
`computed`: **a bare `computed()` over a query store is not request-isolated
during SSR.** `computed` caches its value against a module-global epoch
counter and returns the cached one while that counter is unchanged
(_verified_: `computed/index.js` returns early while
`currentEpoch === nanostoresGlobal.epoch`, and only `notify()` — a store
_write_ — increments it, on a counter that hangs off `globalThis`). A store
from this package never writes on the server: its value is a snapshot taken
per read (§3.2, D5). So a `computed` over one keeps request one's derived
value and serves it to request two — the leak per-request isolation exists to
prevent (D4) — and it does so intermittently, because any unrelated store
write bumps the epoch and hides it. Advancing the epoch deliberately would
not fix it either: the cache is module-scoped, so concurrent requests share it
regardless. `derived` recomputes on every read on the server, exactly as the
query stores do, and is `computed` unchanged in the browser. It takes one
store or an array of them, mirroring `computed`.

The mirror-image rule holds on the source side, and neither helper can fix
it: a module-global atom like `$window` above is shared by every request in
the isolate, so write one from the browser only. `$window.set(…)` in
frontmatter is a cross-request leak in its own right, whatever derives from
it — per-request parameters belong in the options at the call site, or in a
`family(…)` key.

Consumption, per framework, with no package-specific code:

```tsx
const { data } = useStore($thing); // React / Preact
```

```svelte
{$thing.data}                                <!-- Svelte, natively -->
```

```vue
const thing = useStore($thing); // Vue
```

```tsx
const thing = from($thing, $thing.get()); // Solid, from solid-js core
```

```ts
$thing.subscribe((r) => (el.textContent = r.data)); // .astro <script>, web components
```

### 4.3 `astro-tanstack-query/actions`

```ts
import { actions } from "astro:actions";
import { actionMutation, actionQuery, actionQueryOptions } from "astro-tanstack-query/actions";
import { family } from "astro-tanstack-query/query";

export const $addTodo = actionMutation(actions.addTodo, { onSuccess: () => $todos.invalidate() });
export const $todos = actionQuery(actions.listTodos); // key: ['action', getActionPath(action), input]
export const $todo = family((id: string) => actionQueryOptions(actions.getTodo, { id }));
```

`actionMutation` and `actionQuery` both expose `ActionErrorOf<A> | DefaultError`:
the Action's `ActionError<TInput>`, or the plain `Error` that `.orThrow()`
rejects with when the request itself fails (offline, a dropped connection).
The package's `isActionError(error)` narrows to `ActionError<TInput>`, so
`isActionError(error) && isInputError(error)` reads schema-typed `fields`.
Astro's own `isActionError` narrows to an untyped `ActionError`, and
`instanceof ActionError` cannot keep the type either, because the class's
parameter defaults to `Record<string, any>`; `isInputError` alone, on the
union, takes its untyped overload. `actionQueryOptions` is the options form,
and `ActionErrorOf<A>` names an Action's own error type. The browser wrappers call
`.orThrow()`; on the server, `actionQuery` uses the request's `callAction`,
held in the middleware scope.

### 4.4 `astro-tanstack-query/htmx`

```html
<script>
  import "astro-tanstack-query/htmx";
</script>
<button
  hx-get="/fragments/todos"
  hx-ext="tanstack-query"
  hx-trigger="click, tanstack-query:invalidated[detail.key[0]==='todos'] from:body"
></button>
```

- `hx-get`: key `["htmx", url]`; fresh cached fragment → `htmx.swap()` with
  the element's `hx-swap` style and `hx-select`, request aborted. Response
  → `setQueryData`. Caching a fragment is **opt-in**: an un-annotated `hx-get`
  always revalidates, and `hx-tq-stale-time` is the only way to make one
  cacheable. It is read with `closest()`, so marking a container opts in every
  fragment inside it — the same inheritance `hx-tq-invalidate` and htmx's own
  attributes use. It deliberately does not inherit the query client's
  default `staleTime` — that default exists for the hydration handoff, and a
  fragment has none, so inheriting it would silently serve minute-old HTML for
  every `hx-get` nobody annotated.
- Non-GET: after the response, `invalidateQueries` for keys declared in
  `hx-tq-invalidate='[["todos"]]'`.
- Every `invalidated` cache event dispatches `tanstack-query:invalidated`
  on `document.body` with `detail.key` — declarative re-fetch via
  `hx-trigger`, no registry.

### 4.5 `astro-tanstack-query/devtools/client`, `/devtools/toolbar`, `/components`

`<QueryDevtools buttonPosition="bottom-right" />` (`.astro`; renders nothing in
production; lazy-imports `@tanstack/query-devtools` and mounts it with the
page client). The toolbar app imports that same `/devtools/client` module,
and with it the query runtime and the panel, only the first time the app is
opened: Astro loads every toolbar app on every dev page and calls its `init`
when the browser is idle, so mounting there would cost each page the devtools
whether or not anyone opened them. Once mounted, the panel stays when the app
is toggled off, so it keeps its own state. `<QueryState />` emits the blob explicitly when
`emit: 'component'`. It does not clear the request client, because Astro
renders its later siblings concurrently and they still read it; the
middleware releases the client once the response has streamed. In
development it calls `warnOnLatePrefetch` (exported from `/server`), which
warns once when a query is fetched after `<QueryState />` has rendered.

### 4.6 `astro-tanstack-query/testing` — the bridge under Vitest

```ts
// vitest.config.ts
import { defineConfig } from "vitest/config";
import { installTestQueryConfig } from "astro-tanstack-query/testing";
export default defineConfig({ plugins: [installTestQueryConfig()] });
```

`installTestQueryConfig(options?)` returns the Vite plugin that serves
`virtual:astro-tanstack-query/config` to a test run. It is
`virtualConfigPlugin` — the integration's own — taking the integration's
own options minus `devtools`, so a consumer's tests cannot be configured
differently from their pages; its `config` hook adds the `ssr.noExternal`
and `resolve.dedupe` §5 explains. `resetTestQueryClient()` forgets the page
client between DOM-environment tests; `runInTestRequest(fn, init?)` runs
`fn` inside a request scope, the only door to a server client (D4);
`init.isPrerendered` sets the scope's `isPrerendered`, as the middleware
does from Astro's `context.isPrerendered`. That is the route's `prerender`
flag (_verified_: `core/fetch/fetch-state.js` sets it from
`routeData.prerender`), true for a prerendered route in `astro dev` and
`astro build` alike, so every route under `output: "static"`; code that
means the build alone checks `isPrerendered && !import.meta.env.DEV`. The
plugin fixes the virtual config's `browserBuild` to `false`, so a
DOM-environment test file, which Vitest loads as client code, still decides
its side by `window` at run time.

Nothing in this entry may reach the virtual config at load time: a
consumer's `vitest.config.ts` imports it _before_ anything can resolve that
id, so `resetTestQueryClient()` reaches the page client through a deferred
import and is async for that reason alone.

---

## 5. Integration behaviour

| Hook                 | What it does                                                                                                                                                                                                                                                           |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `astro:config:setup` | `addMiddleware({ entrypoint: "astro-tanstack-query/middleware", order: "pre" })`; `updateConfig({ vite: { resolve: { dedupe: ["@tanstack/query-core", "nanostores"] }, plugins: [virtualConfig] } })`; `addDevToolbarApp(...)` when `devtools` and `command === "dev"` |
| `astro:config:done`  | `injectTypes` for `App.Locals.queryClient` and the `virtual:astro-tanstack-query/config` module                                                                                                                                                                        |

`resolve.dedupe` is insurance, not a requirement — the spike deduped
without it — against pnpm/monorepo layouts that could otherwise ship two
`query-core` copies. The virtual config module resolves to the user's
`config` file or to an empty default, so the client module carries no
config plumbing and the user's `defaultOptions` (functions included) reach
both the page client and the request client without serialisation. It also
exports `settings` (`emit`, `ssrStaleTime`, and `origin` only when
`ssr.origin` is set, since the page client imports it too and every key
reaches the browser) and `browserBuild`, true only when Vite loads the
module for a client build (D15).

---

## 6. Which Query optimisations survive, and how

| Optimisation                                                      | Preserved by                                                                                                                                                                       | Status                             |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| Request deduplication                                             | one `QueryClient`, many observers                                                                                                                                                  | VERIFIED (1 request / 5 consumers) |
| Structural sharing (`replaceEqualDeep`)                           | core default; `data` reference stable when deep-equal, so `derived($q, (r) => r.data)` and `useMemo` behave                                                                        | VERIFIED in source                 |
| Tracked re-renders                                                | `trackResult` Proxy as the store value (D8)                                                                                                                                        | VERIFIED in source                 |
| Batched notifications                                             | `notifyManager.batchCalls` around the listener                                                                                                                                     | VERIFIED in source                 |
| `staleTime` / stale-while-revalidate                              | core                                                                                                                                                                               | VERIFIED                           |
| `gcTime` garbage collection                                       | observers detach on unmount (+1 s), timers start then; on the server `Infinity` by default, and any timers an explicit `gcTime` arms are cancelled by the end-of-request `clear()` | VERIFIED                           |
| `refetchOnWindowFocus` / `refetchOnReconnect`                     | `mount()` once per page client (D3)                                                                                                                                                | VERIFIED — was dead in the spike   |
| `refetchOnMount`, `refetchInterval`                               | run only while a consumer is mounted                                                                                                                                               | VERIFIED (`onSubscribe`)           |
| Retry with backoff, `networkMode`                                 | core `retryer`                                                                                                                                                                     | source                             |
| Cancellation (`signal`)                                           | last observer leaves → fetch cancelled if the `signal` was consumed; delayed ≤ 1 s by nanostores                                                                                   | source                             |
| `select`, `placeholderData`, `keepPreviousData`                   | observer options passthrough                                                                                                                                                       | source                             |
| Hydration freshness                                               | `dataUpdatedAt` comparison in `hydrate`                                                                                                                                            | VERIFIED                           |
| Errors kept out of the dehydrated blob                            | `defaultShouldDehydrateQuery` keeps `success` only; `shouldRedactErrors` has no default                                                                                            | VERIFIED                           |
| Infinite queries, mutations, paused mutations resume on reconnect | `InfiniteQueryObserver`, `MutationObserver`, `mount()`                                                                                                                             | source                             |
| Persisters (`@tanstack/query-persist-client-core`)                | any client; not bundled                                                                                                                                                            | compatible, out of v1              |

The structural-sharing row names `derived` and not `computed` on purpose. The
reference stability itself is unchanged and still claimed; it is the idiom
that changes, because nanostores' `computed` over a store from this package
is not request-isolated during SSR (§4.2). Derive with `derived` from
`astro-tanstack-query/query`.

The package ships no Suspense API and no other adapter-specific ergonomics
such as `useSuspenseQuery`; they are per-framework by definition (D2). Their
options are removed from the types too: `QueryStoreOptions`,
`InfiniteQueryStoreOptions` and `MutationStoreOptions` leave out
`throwOnError` (and `suspense` for queries), so the tracked-props hint
query-core adds for `throwOnError` never applies; `notifyOnChangeProps` still
covers `error` (D8). A third-party hook, `@nanostores/react`'s
`useLoadingStore`, can suspend on these stores in the browser; the README FAQ
gives the only safe way to use it.

---

## 7. Tree-shaking and size

| Entry                                                                                                   | Contains                                                                                                | Budget (gzip)    |
| ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ---------------- |
| `astro-tanstack-query`                                                                                  | integration only; Node; never bundled for the browser                                                   | n/a              |
| `/query`                                                                                                | store bridge + `query-core` (`QueryClient`, `QueryObserver`, `hydrate`) + `nanostores` `atom`/`onMount` | ≤ 12 KB          |
| `/query` when `createInfiniteQuery`/`createMutation`/`createIsFetching`/`createIsMutating` are imported | + those observers and the activity stores (+83 B)                                                       | ≤ 13.5 KB        |
| `/actions`                                                                                              | thin wrappers + the store bridge they re-export                                                         | ≤ 2.05 KB on top |
| `/htmx`                                                                                                 | extension                                                                                               | ≤ 1.65 KB on top |
| `/serializer/devalue` `reader`                                                                          | `devalue` `parse` — the only half a browser loads                                                       | ≤ 2.3 KB on top  |
| `/serializer/devalue` `writer`                                                                          | `devalue` `stringify` — server only, never shipped to a browser                                         | ≤ 3.2 KB         |
| `/devtools/client`, `/devtools/toolbar`                                                                 | lazy import; **0 B in production**                                                                      | 0                |
| `/middleware`, `/server`                                                                                | server only                                                                                             | n/a              |
| A page that imports no store                                                                            | nothing (D3)                                                                                            | **0 B**          |

Two rows are larger than the entry's own code, and the budget is the measured
truth rather than the aspiration — a gate nobody can meet is a gate nobody
reads:

- `/serializer/devalue` is split into a `reader` (`parse`) and a `writer`
  (`stringify`), because a property cannot be tree-shaken off a live object:
  while both lived on one `devalueSerializer`, a browser that only ever calls
  `parse` while hydrating still downloaded `stringify`, which runs solely on
  the server in `stateScript()`. Measured gzip with devalue 5.9: the browser's
  `reader` **1.69 kB**, against 3.96 kB for the old single object and a 1.67
  kB floor for `devalue`'s `parse` alone — so the split recovers **2.27 kB**
  and lands within ~25 B of the floor. The server-only `writer` is 2.78 kB and
  never reaches a browser. `__tests__/support/treeshake.test.ts` bundles a devalue-configured
  browser entry and fails if the halves are re-fused.
- `/actions` measures **2.0 kB** because the budget externalises the
  third-party peers but not this package's own `/query` entry, so the row
  re-bundles the `createQuery`/`createMutation` bridge the wrappers import. The
  marginal cost of adding `/actions` to a page that already loads `/query` —
  the only page that would import it — is ~0.2 kB, measured by diffing a
  bundle of both against `/query` alone.

The budgets are an upper bound. `size-limit` bundles with esbuild, which
minifies less tightly than Vite 8's Rolldown and keeps the server branches
that Vite deletes (D15): `createQuery` measures 11.3 kB there against 10.7 kB
from Vite's own `build()`, and all stores 12.3 kB against 11.6 kB.
`__tests__/support/treeshake.test.ts` runs that Vite build and holds it to the
same budgets.

Exact byte counts live beside each row in `.size-limit.js`, where a regression
changes them.

Rules that make the table true:

- ESM only. `package.json` declares `./dist/htmx/index.js` in `sideEffects` for its
  extension registration. Query consumers load client code through normal imports;
  a page with no query imports does not acquire a page client or query runtime.
- No barrel re-exports across entries; each entry imports only what it
  needs from `query-core` (itself `sideEffects: false`, _verified_).
- The dist is bundled per entry, which is tsdown's default.
  `tsdown.config.ts` lists in `deps.neverBundle` only what `package.json`
  cannot declare, because tsdown already leaves every dependency and peer
  unbundled. `unbundle: true` was measured and declined. In multi-entry
  Rolldown builds (the gzip of each page's static-import closure), it saves a
  page that does not use a feature 0.47–1.2 kB: a `createQuery` page beside
  an `/actions` page −0.47 kB, a `family`+`derived` page −1.0 kB, an
  infinite-only page −1.2 kB. But the page that does use the split-out
  feature pays +0.34 to +0.57 kB. A visitor who loads every page pays
  +0.33 kB (2 pages) to +0.54 kB (4 pages) more in total. A `createQuery`
  page can grow about 118 B when no other entry shares its store module. The
  gain exists only for Rolldown/Vite 8 (Astro 7) consumers; esbuild's code
  splitting follows the barrels and gains nothing. Single-entry sizes are the
  same either way, so the budgets above do not decide it.
- No `import.meta.env` or `process.env` in shipped code except behind
  the server checks; no `node:` imports in the isomorphic module — the
  middleware publishes the scope on `globalThis` (D15).
- Every server check reads `typeof window` through `isServer()`, but only as
  the inline `(!browserBuild && isServer())`. `browserBuild` is the virtual
  config's constant, true only in a client build, so there the check folds to
  false and the branch behind it, `requestScope()` included, leaves the
  bundle. A helper function around it would defeat the fold, because neither
  esbuild nor Rolldown inlines one. In a multi-entry build `isServer`,
  `requestScope` and the scope key can survive as dead exports of a shared
  chunk, about 40 B gzip in a two-page Vite build: Rolldown fixes a chunk's
  exports before constant inlining removes their last uses.
- Budgets are enforced in CI with `size-limit`, and a tree-shaking test
  bundles each entry with esbuild and asserts that marker strings from the
  other entries are absent. The same test builds `createQuery` and all stores
  with Vite and asserts that no server-only marker survives the fold.
- `publint` and `@arethetypeswrong/cli` run in repository CI. The package `release`
  script builds and invokes Changesets publishing; it does not rerun those checks.
  Release only from a revision whose required CI checks have passed.

---

## 8. Security

- **Per-request isolation is structural (D4).** There is no exported
  server client; the only server paths are `locals.queryClient` and the
  ALS scope, both created and torn down per request. A regression test
  replays the Alice/Bob/Carol leak with `staleTime` set and asserts it
  cannot happen.
- **Derived values use `derived`, not `computed` (§4.2).** nanostores caches
  a `computed` behind a module-global epoch counter that only a store write
  advances; a server store never writes, because its value is a per-read
  snapshot — so a `computed` over one serves request one's derived value to
  request two. That is the D4 leak one hop further out, and a unit test
  replays it the way the Alice/Bob/Carol test replays the client leak.
- **The blob is JSON inside `<script type="application/json">`** with
  `<`, `>`, `&`, U+2028 and U+2029 escaped (D9), so a value containing
  `</script>` cannot break out. `devalue` output is safe by its own
  contract when opted in.
- **By default, only prefetched, successful queries are dehydrated.**
  `dehydrate`'s default `shouldDehydrateQuery` keeps `status === "success"` alone, so a
  failed query's error never reaches the state; `shouldRedactErrors` is not
  what does this. An override of `shouldDehydrateQuery` gives up the error
  guard, but a pending query is never emitted even then. A query whose data
  the serializer cannot write is left out and reported by `console.error`
  with its query hash and the serializer's message only. The error object is
  never logged, because a `DevalueError` carries the offending value. Nothing
  a page did not put in the request client can reach the HTML, and `clear()`
  runs once every response has ended, in both emit modes: a response with a
  body (a page, a JSON endpoint, a stream) at stream flush or cancel (after
  `<QueryState />` has emitted, in component mode), a response with no body,
  such as a redirect, at once.
- **Only a `<script>` is read as state.** The page client finds the page's
  state with `querySelector("script#astro-tq")`, not `getElementById`, and
  hydrates a `.astro-tq` element only when it is a `<script>`; any element
  with the class loses the class either way, so it is not looked at again.
  HTML sanitizers keep `id`, `class` and `data-*` attributes and strip
  `<script>`, so user content rendered into the page, even ahead of the real
  state element, can never write into the cache.
- Query state is emitted as a non-executable JSON script. The current Devtools
  wrapper does not expose a style nonce.
- Nothing in the package reads cookies or bodies, and it never logs query
  data. It does trust the request URL. On the server, `absoluteUrl()`
  resolves against Astro's request URL, and on `@astrojs/node` its host is
  the raw `Host` header (astro 7.3.x `createRequestFromNodeRequest` ignores
  `security.allowedDomains` for the URL). The documented
  `fetch(absoluteUrl(...))` prefetch is therefore read-SSRF at the app's own
  path when a forged Host reaches the server. Mitigations: a proxy that
  rejects unknown Hosts, the opt-in `ssr.origin` (no default from `site`,
  which would send dev and preview prefetches to production; fixed at build
  time; readable in the browser bundle), or `prefetch(serverQueryFn)`.
- A global `window` on the server (a DOM shim or registrator) would route
  every store to the page-client singleton, the D4 leak through D15. The
  middleware refuses such a process with `window-on-server`, and D15's
  `typeof window` check is unchanged.

---

## 9. Error handling

Expected failures return, they do not throw: a failed `queryFn` lands in
`error` (for an Action mutation or query, the Action's `ActionError<TInput>`,
or the plain `Error` of a request that failed, which `isActionError` tells
apart); an unavailable ALS degrades
to pending, loading snapshots with one dev warning; an htmx cache miss falls
through to the network; an unserializable query is dropped from the state
with one `console.error` (hash and serializer message, never data), so the
response completes and that query refetches in the browser. Unexpected
misuse throws a `TanstackQueryAstroError` with a `kind`:

- `"server-client-outside-request"`: `getQueryClient()`, `absoluteUrl()` or
  a server `actionQuery` with no scope.
- `"browser-only"`: a store's `refetch()`, a mutation's
  `mutate()`/`mutateAsync()`/`reset()`, or `pageClient()` called on the
  server; the message names the method that was called.
- `"serializer-mismatch"`: a devalue blob read by a JSON client, or the
  reverse.
- `"invalid-options"`: the integration was given a bad `serializer`, `emit`,
  `ssr.staleTime` or `ssr.origin`.
- `"window-on-server"`: the middleware found a global `window` in the server
  process.
- `"test-environment"`: `runInTestRequest()` in a test file that has a
  `window`, where the scope would be ignored.

Messages say what to do next. `serializer-mismatch` throws from the first
store read, but the page client is recorded before hydrating, so later reads
use that one client's empty cache instead of building and mounting a new
client each time.

---

## 10. Testing

All tests live under `__tests__/`: `src/**/*.test.ts` and `support/**/*.test.ts`
run with `vitest.config.ts`; `support/**/*.check.ts` uses `vitest.prod.config.ts`;
`e2e/` uses `playwright.config.ts` against the built `example/` application.

- **Unit (Vitest):** the bridge against real `query-core` with fake
  fetchers — mount/unmount → subscribe/unsubscribe, tracked props gating,
  batched notifications, reactive options → `setOptions`, family eviction
  (after unmount, and for members that never mount); the server path with a
  fake scope — no fetch on `get()`, snapshot correctness including the
  optimistic loading state that matches the first browser read (not
  prefetched, stale, fresh, disabled, errored prefetch, infinite),
  `subscribe` no-op; the serializer — escaping and round-trips, devalue
  types; the middleware transform — HTML-only, empty-state skip, `</body>`
  placement past decoy `</body>`s at every chunk size, compressed /
  legacy-charset / BOM pass-through, and `clear()` exactly once on every exit
  (flush, cancel, non-HTML, null writer).
- **Consumer tests (`astro-tanstack-query/testing`, §4.6):** a consumer
  cannot import the bridge under plain Vitest — `/query` imports a virtual
  module only the Vite plugin resolves — and the workaround, a `vi.mock`
  factory of this package, is not type-checked against what it replaces, so
  it drifts from the real API and stays green while it does. The entry point
  ships the plugin instead, and `__tests__/src/testing/*.test.ts` is the proof: it
  creates queries, families, derivations and mutations through the public
  `/query` surface with no `vi.mock` at all, on both the DOM path (one page
  client, reset between tests) and the node path (a request scope).
- **Type tests (`expectTypeOf`, run by `tsc`):** option inference
  (`__tests__/src/query/options.test-d.ts`), `ActionError` typing and Action
  query composition against Astro's real `ActionClient`
  (`__tests__/src/actions/index.test-d.ts`), `family` parameter typing.
- **Package tests:** `publint`, `attw`, `size-limit`, tree-shaking markers.
- **E2E (Playwright, `astro build` + `@astrojs/node` on `example/`):** the
  five-consumer page (counts as in §1), invalidation propagation, a Solid
  island paging through keys that leaves the previous key's cache entry
  intact, a hydration check that fails if any console message or page error
  on load mentions hydration or a mismatch across React, Svelte, Vue and
  Solid, `client:only`/`visible`/`idle`, the concurrency leak replay, the
  View-Transitions cache persistence, htmx hit/miss/invalidate, devtools
  mounting in dev only. The spike's pages become these fixtures.

---

## 11. Repository, tooling, release

Package source lives under `src/`, the consumer fixture under `example/`, design
documentation under `docs/` and every test under `__tests__/`.

TypeScript uses `strict`, `moduleResolution: bundler`, and `verbatimModuleSyntax`.
`tsdown` builds ESM and declarations. The library requires Node ≥22; development and
CI use Node 24. Changesets provide versioning and the changelog. Package peers and
optional peers are declared in `package.json`.

`.github/workflows/ci.yml` runs formatting, lint, type checks, the build, the example's
`astro check`, unit and production checks, package-shape checks, size budgets and the
Playwright suite. `.github/workflows/release.yml` opens a version pull request from pending changesets and,
once npm publishing is configured, publishes with provenance when it merges.

---

## 12. Out of scope (deliberately)

TanStack Router / Start (D16); typed URL state; `createQueries`; persisters;
a Suspense API; per-framework sugar packages.

Application state policy stays with the application. Browser-only values (UI state,
device preferences) belong in plain nanostores, and server-only reads need no store:
a page that renders data without an island can read it in frontmatter directly. The
package does not require turning server-rendered content into islands.

---

## 13. Open risks

| Risk                                                                                                                                     | Status   | Mitigation                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ALS context lost across non-native thenables on Cloudflare / Vercel Edge                                                                 | ACCEPTED | fallback to pending, loading snapshots; e2e runs on Node; document per-adapter                                                                                                                                  |
| A queryFn using a relative URL fails during server prefetch                                                                              | ACCEPTED | `absoluteUrl()` helper; `prefetch(serverQueryFn)` override; a failed server prefetch warns once per request in development and while prerendering (emit time, server-only, 0 browser bytes)                     |
| Prerendered pages prefetch at build time, and `absoluteUrl()` resolves against `ssr.origin`, `site` or `localhost:<port>`, not the build | ACCEPTED | README "Static output and prerendered pages"; use a server fetcher; the prerender warning names the failed query hashes                                                                                         |
| Server `absoluteUrl()` follows the request's `Host` header on `@astrojs/node`                                                            | ACCEPTED | documented; a proxy that rejects unknown Hosts; opt-in `ssr.origin`; `prefetch(serverQueryFn)`; upstream Astro issue to file                                                                                    |
| nanostores 1 s unmount delay keeps an observer alive briefly                                                                             | ACCEPTED | matches TanStack's own "don't thrash" intent; cancellation delayed ≤ 1 s                                                                                                                                        |
| Store updates land one `setTimeout(0)` tick after the cache changes                                                                      | ACCEPTED | consistent with React Query; `await refetch()`, then `getQueryClient().getQueryData($store.options.queryKey)` (typed) for synchronous reads                                                                     |
| Per-call mutation callbacks fire after the calling island unmounts                                                                       | ACCEPTED | a store has no component lifetime; the call holds a store listener until it settles so script/htmx/button-only callers get their callbacks; documented divergence from React Query's `useMutation`              |
| Streaming transform meets a response with no `</body>`, or with content after its `</body>`                                              | ACCEPTED | append at flush; browsers move it into `<body>`                                                                                                                                                                 |
| A compressed or non-UTF-8 HTML response reaches the transform (e.g. a compressing middleware inside `order: 'pre'`)                      | ACCEPTED | passed through byte for byte without state, releasing the client when its stream ends, so islands fetch in the browser; one dev warning; `emit: 'component'` renders the state into the page before compression |
| `emit: 'component'`: a prefetch in component frontmatter that Astro renders concurrently with `<QueryState />`                           | ACCEPTED | dev warning on a fetch after it rendered; prefetch in page or layout frontmatter, or use the default middleware emission                                                                                        |
| State prefetched in an HTML fragment other than a server island (htmx partial, `partial` page) is not emitted                            | ACCEPTED | keyed on the route: only `/_server-islands/[name]` gets the id-less element, because a second `#astro-tq` would shadow the page's own; the dev warning fires once per process                                   |
| The server-island `MutationObserver` walks the document once per DOM mutation batch                                                      | ACCEPTED | kept off the per-render read path; about 0.1 kB gzip                                                                                                                                                            |
| Middleware transform and another integration also rewriting HTML                                                                         | OPEN     | `order: 'pre'` wraps them; `emit: 'component'` as escape hatch                                                                                                                                                  |
