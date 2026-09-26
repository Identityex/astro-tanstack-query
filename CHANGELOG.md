# astro-tanstack-query

## 0.2.0

### Minor Changes

- f80c3c1: Add `createIsFetching(filters?)` and `createIsMutating(filters?)` to `astro-tanstack-query/query`, the equivalents of `useIsFetching` and `useIsMutating`. Each returns a read-only nanostore of how many queries are fetching, or how many mutations are pending, across every island on the page, which is what a global spinner or progress bar needs. They are safe to create at module level and to read during SSR, where they always read 0, as upstream's hooks do: they never touch the request client, and the page client is created only when one mounts in the browser. A page that does not import them pays nothing.
- e746ded: A store seeded with `initialData` now types `data` as defined, and the query options no longer accept `throwOnError` or `suspense`.

  - `createQuery`, `queryOptions`, `family` and `createInfiniteQuery` have a first overload for options whose `initialData` is always defined, as the official TanStack adapters do. `$todos.get().data` is then `Todo[]`, not `Todo[] | undefined`, so no `!` or `?? []` is needed. This also works through a store of options, `select`, and a `family` whose `define` returns `initialData`. An `initialData` function that may return `undefined` leaves `data` optional. The new `DefinedQueryStore` and `DefinedInfiniteQueryStore` types name these stores.
  - `QueryStoreOptions`, the new `InfiniteQueryStoreOptions` and the new `MutationStoreOptions` leave out `throwOnError`, and the query ones also leave out `suspense`. Both options need an error boundary or Suspense, which only a framework adapter has. `throwOnError` did nothing here, and `suspense` silently stopped a store refetching an errored query when its key changed. Read the result's `error` or `status` instead. `actionMutation` and `actionQuery` follow the same options.

  **Breaking (types only):** an options object that sets `throwOnError` or `suspense` inline in a call to a store factory, `queryOptions`, `actionMutation` or `actionQuery` no longer compiles. Remove the option. `QueryStore` and `InfiniteQueryStore` gain a trailing type parameter for the result type, with a default, so existing annotations are unchanged. The runtime is unchanged.

- 48169ad: The middleware holds up under `Astro.rewrite()`, refuses a server with a global `window`, and can
  resolve `absoluteUrl()` against a configured origin instead of the request's `Host` header.

  - `Astro.rewrite()` runs the middleware again from inside the page that called it. Each pass used
    to create its own request client, so a rewritten page carried two `#astro-tq` elements and the
    browser read only the first, which lacked the calling page's prefetches; with
    `emit: "component"`, `<QueryState />` never saw them at all. The rewritten pass now shares the
    request's client, only the outermost pass writes the state and releases the client, and the
    page gets one state element holding both pages' prefetches. `absoluteUrl()` still resolves
    against the rewritten URL. An error page rendered after a failed one still gets a client of its
    own, even where the adapter hands both the same `locals` object.
  - A page that throws before it responds now releases its request client too, instead of leaving
    it pinned by any explicit `gcTime`.
  - The middleware throws a `TanstackQueryAstroError` of the new kind `"window-on-server"` when a
    global `window` exists in the server process, as a globally registered DOM shim creates. Every
    store would otherwise take its browser path there and serve one visitor's prefetched data to the
    next.
  - New option `ssr.origin` (no default). On `@astrojs/node` the request URL's host comes from the
    client's `Host` header, unvalidated, so a forged header points `fetch(absoluteUrl("/api/..."))`
    prefetches at another host. When `ssr.origin` is set, server-side `absoluteUrl()` resolves
    against it, keeping the request's path and query. It is fixed at build time and, like the other
    settings, readable in the browser bundle, so set the site's public origin. It must be an absolute
    `http:` or `https:` URL; only its origin is used.

  **Breaking:** a server process with a global `window`, such as a DOM shim registered globally
  (happy-dom's `GlobalRegistrator`), now fails every request with `window-on-server`. 0.1 served
  those pages, but shared one cache across requests and leaked one visitor's data to the next.
  Remove the shim from the server, or use a DOM instance that is not global where code needs one.

- 184bd5f: The server render of a query or infinite query store now reports the same loading state as the browser's first read, so islands hydrate without a mismatch.

  Reading a store in the browser mounts it, and mounting starts any fetch-on-mount, so the island's first client render already sees `isLoading`/`isFetching`. The server snapshot now uses TanStack's optimistic results, as the official React, Vue, Svelte and Solid adapters do, and reports that same state. Stores still never fetch on the server.

  - A query that was not prefetched renders with `isLoading: true`, `isFetching: true` and `fetchStatus: "fetching"`. Before, it rendered as pending but idle.
  - A prefetch that is already stale (for example `staleTime: 0`) renders with `isFetching: true`.
  - A prefetch that failed, of a query that fetches on mount, renders as pending and loading, not as an error. Errored queries are not sent to the browser, so the browser starts from nothing and fetches. A query with `enabled: false` or `retryOnMount: false` does not fetch on mount, so its server render keeps `status: "error"` while the browser starts pending: a hydration mismatch.
  - Fresh prefetches and `enabled: false` stores are unchanged.

  **Breaking:** the SSR HTML changes for any island that branches on `isLoading`, `isFetching` or `fetchStatus` of a store that was not prefetched, or on the error of a failed prefetch.

- 429a272: Server islands carry their prefetched state to the page.

  - State prefetched inside a `server:defer` component used to be dropped with every other HTML
    fragment, so a `client:*` island inside it hydrated against an empty cache: a hydration
    mismatch, then a second fetch of data the server already had. The middleware now writes a
    server island's state (the `/_server-islands/[name]` route) as
    `<script type="application/json" class="astro-tq">` with no id, so it never shadows the page's
    own `#astro-tq`, and the page client hydrates each one as it arrives. Newer data still wins.
    Only a `<script>` is read as state: the page's own is found with `script#astro-tq`, and an
    element with the `astro-tq` class is hydrated only if it is a script. A class, an id and
    `data-*` attributes survive HTML sanitizers and a `<script>` does not, so user content can
    never write into the cache.
  - With `emit: "component"`, put a `<QueryState />` last inside the deferred component; there it
    writes the same id-less element.
  - Other fragments, such as htmx partials, still carry no state. Development now warns, once per
    process, when one drops prefetched queries.
  - For custom emission, `astro-tanstack-query/server` exports `SERVER_ISLAND_ROUTE`, and
    `stateScript()` and `injectState()` take an `island` option.
  - A fragment holding a custom element such as `<html-viewer>` is no longer mistaken for a
    document.

- e8b56f1: Store methods now work the same way whether or not anything is subscribed to the store, and the store is typed for use with `getQueryClient()`.

  - Per-call `mutate(variables, { onSuccess, onError, onSettled })` and `mutateAsync` callbacks now fire when nothing subscribes to the mutation store, for example in an Astro `<script>`, an htmx handler, or an island that only renders a button. This also covers `actionMutation`. Unlike React Query's `useMutation`, the callbacks still fire if the calling island unmounted before the mutation settled, because a store has no component lifetime.
  - `refetch()` on a query or infinite query store built from an options store now fetches the key that `store.key` reports. Before, a store that was never mounted, or had been unmounted for more than a second, refetched the key it last saw.
  - `store.options.queryKey` is now a `DataTag`, so `getQueryClient().getQueryData($store.options.queryKey)` and `cancelQueries` infer the cached type. This covers plain stores, `family` members and infinite stores.
  - `refetch(options?)` takes `RefetchOptions` and `invalidate(options?)` takes `InvalidateOptions`, and both forward them to query-core.
  - `createInfiniteQuery`'s `prefetch(serverQueryFn?)` accepts a server-only fetcher, as `createQuery`'s already did.

  **Breaking (types only):** a store's `refetch` or `invalidate` passed directly as a handler (`onClick={$x.refetch}`, `onSuccess: $x.invalidate`) no longer compiles, because the handler's argument would be read as `RefetchOptions`/`InvalidateOptions`. Wrap it: `onClick={() => $x.refetch()}`. The runtime is unchanged.

- 50c9e24: The Action helpers are now typed against Astro's own `ActionClient`, and a new `actionQueryOptions` gives an Action query as options.

  - `actionMutation`'s `error` is the Action's `ActionError<TInput>`, the same type calling the Action directly gives, or a transport error: a plain `Error` when the request itself fails (offline, a dropped connection), because `.orThrow()` fetches and a failed fetch never becomes an `ActionError`. The new `isActionError(error)` narrows to the Action's own error and keeps its input type, so after `isActionError(error) && isInputError(error)`, `error.fields` has the schema's keys and a typo such as `fields.txet` no longer compiles. Astro's own `isActionError` narrows to an untyped `ActionError`, and `isInputError()` alone takes its untyped overload on the union. `ActionErrorOf<typeof actions.addTodo>` names the Action's own error type.
  - `actionQuery(actions.listTodos)` no longer needs a trailing `undefined` for an Action that takes no input. An Action whose input is required still requires it.
  - `select` can change an Action query's data type: `actionQuery(actions.listTodos, undefined, { select: (todos) => todos.length })` is a `number` store.
  - `actionQueryOptions(action, input, options)` returns the options `actionQuery` builds, with a typed `queryKey`. Pass them to `family`, to a store of options, or to the query client's `fetchQuery` and `getQueryData`, which then infer the Action's output.

  An Action query's `error` has the same type, `ActionError<TInput> | Error`, and `isActionError(error) && isInputError(error)` types its `fields` the same way.

  **Breaking (types only):** the helpers accept only an Astro Action (an `ActionClient`), not a look-alike with an `orThrow` method, and `actionMutation`'s error type changes from `ActionError` to `ActionError<TInput> | Error`, so `error.code` needs `isActionError(error)` first. The runtime is unchanged.

### Patch Changes

- e14b998: Accept devalue 6 as the optional `serializer: "devalue"` peer, alongside devalue 5. The package only
  uses devalue's `parse` and `stringify`, which version 6 did not change; the end-to-end suite now runs
  against it. devalue 6 itself requires Node 22.17 or newer.
- 720a22a: `family` now releases members that never mount. A member used only for `prefetch()`, `setData()`, `invalidate()`, `refetch()` or `key` (hover prefetch, seeding detail queries from a list) used to stay memoised for the life of the page, across View Transitions, at about 4 kB per key. It now leaves the map after nanostores' unmount delay (about a second), counted from its creation or its last unmount. Calling the family again after that returns a new store for the same query, which reads the same cached data. A store you held on to and mount later puts itself back, so the next call returns it.
- 54aec82: Browser bundles no longer carry the server half of the store bridge. Each server check now also
  reads a `browserBuild` constant from the integration's virtual config module, which is true only
  when Vite builds for the client, so the client build deletes the request-scope lookup, the SSR
  snapshot path and the server-only errors. Measured in Vite 8's own build, gzip: `createQuery`
  alone is 295 B smaller, all five store factories 357 B, `actionQuery` with `actionMutation` 360 B,
  `family` with `derived` 365 B. SSR, prerendering and `astro-tanstack-query/testing` keep the
  runtime `typeof window` check, so server behaviour and your unit tests are unchanged.

  One unsupported setup changes: a module built for the browser but run without a `window`, such as
  the store bridge imported into a Web Worker, used to take the server path silently. It now takes
  the browser path and throws when it reaches `document`.

- ff2dd30: The htmx extension now finds a cached fragment by its query hash instead of scanning the whole query cache on every `hx-get`. The lookup takes the same time however many queries and fragments the page has cached, and a `queryKeyHashFn` in your `defaultOptions` is still respected. On the server, `mutateAsync()` and `reset()` now throw an error naming the method you called; before, all three mutation methods reported `mutate()`.
- 6ca09d1: The dev toolbar app added by `devtools: true` now loads the query runtime and
  `@tanstack/query-devtools` the first time it is opened. Before, Astro's toolbar loaded it on every
  dev page and it mounted a hidden panel straight away, so each page parsed and ran about 550 kB of
  development-mode devtools, and kept that panel re-rendering on every cache event, even when
  nobody opened it and the page used no store. Once opened, the panel stays mounted when the app is
  closed, so it keeps its own state. Production builds are unaffected.
- d30a2dc: The per-request `QueryClient` is now released exactly once for every response, and the state
  element is written at stream flush, before the document's final `</body>`.

  - A JSON endpoint, a redirect, a page whose visitor disconnected mid-stream, and every response in
    `emit: "component"` mode used to leave the request client in memory. With an explicit `gcTime`
    (a `config` default, or a store's own option) each one armed a server timer that pinned the
    client and its data for that long. `injectState` now clears on every exit, including stream
    cancellation: a response with no body, such as a redirect, at once, and every response with a
    body, a JSON endpoint or other stream included, when its stream ends or its reader cancels,
    because Astro may still be rendering it. `injectState`'s writer may be `null` to release without
    emitting, which is what the middleware now does in component mode.
  - A `</body>` that is not the document's own, such as a string in an inline script or a comment,
    no longer receives the state element. That used to break the script and clear the client before
    the rest of the page had rendered, so later prefetches never reached the browser.
  - A response that is compressed, or declares a charset other than UTF-8, is passed through byte
    for byte, without the state, instead of being decoded and corrupted, and releases the client
    when its stream ends; development warns once and points to `emit: "component"`. A UTF-8 byte
    order mark is kept.
  - `<QueryState />` no longer clears the request client while Astro is still rendering its
    siblings, which made a later store read render "pending" beside state that said "success". In
    development it warns when a query is fetched after it has rendered. The helper behind that
    warning is exported as `warnOnLatePrefetch` from `astro-tanstack-query/server`.

- 890ce6f: Writing the query state can no longer break a page, and a prefetch that cannot reach the page now
  says so.

  - A value the serializer cannot write, such as a BigInt under the JSON serializer, or a class
    instance or a function in `meta` under devalue, used to error the response after its 200 and most
    of its HTML had been sent. Astro's node adapter then wrote "Internal server error" into the page
    and logged nothing. Now only the query holding that value is left out of the state, and the
    browser fetches it again. One `console.error` names the dropped query hashes and the serializer's
    message, never the data.
  - A pending query is never written into the state, even when the config's
    `dehydrate.shouldDehydrateQuery` allows one, as TanStack's streaming recipe does. The state is
    written once, at the end of the body, and cannot resume a promise: under JSON the promise
    arrived as `{}` and every island on the page threw, and under devalue the response was cut
    short. The config's predicate still decides everything else.
  - In development, and while `astro build` prerenders a page, one warning per request names the
    prefetches the state cannot carry: one still in flight when the state is written (a prefetch
    that was not awaited), and one that failed. While prerendering, `absoluteUrl()` resolves against
    the build's origin rather than the site being built, so a prefetch through it fails there; the
    warning points to a server fetcher, `$store.prefetch(() => readFromSource())`. The middleware
    and `<QueryState />` turn this on; `stateScript()` and `injectState()` take it as an optional
    `{ warn }` argument, typed `EmitOptions`.
  - `RequestScope` has an optional `isPrerendered`, set by the middleware from Astro's context, and
    `runInTestRequest()` accepts it. It is Astro's per-route `prerender` flag, true for a
    prerendered route in `astro dev` as well as in `astro build`, and for every route under
    `output: "static"`. Code that needs the build alone checks
    `isPrerendered && !import.meta.env.DEV`.
  - In the browser, a page whose state fails to hydrate still throws on the first read, but no
    longer builds and mounts a new `QueryClient` on every read after it.

## 0.1.0

### Minor Changes

- 8df9a11: First release: one TanStack Query cache across every Astro island — React, Svelte, Vue, Solid,
  Preact, Alpine, a vanilla `<script>` and htmx — with automatic SSR prefetch, hydration through a
  single state element, and a per-request client on the server that no module can import.

  This is an unofficial community project, not affiliated with the Astro or TanStack teams.

- 8df9a11: New entry point `astro-tanstack-query/testing`, so a consumer's unit tests can drive the real store
  bridge instead of a mock of it.

  `astro-tanstack-query/query` imports `virtual:astro-tanstack-query/config`, which only this
  package's Vite plugin resolves — so until now a consumer's only way to unit-test a module built on
  `createQuery` was a `vi.mock` factory faking the package. A mock factory is never type-checked
  against the module it replaces: two of them in one codebase had already drifted from the real API
  and from each other, and the tests stayed green throughout.

  - `installTestQueryConfig(options?)` returns a Vite plugin for `vitest.config.ts` that serves the
    virtual config through the integration's own plugin — same module, same options (`config`,
    `serializer`, `emit`, `ssr`), so test config cannot drift from page config. It also marks the
    package `ssr.noExternal` and dedupes `@tanstack/query-core` and `nanostores`, because a module
    Vitest externalises is handed to Node, which has never heard of a `virtual:` id.
  - `resetTestQueryClient()` forgets the page client between tests that run with a DOM.
  - `runInTestRequest(fn, init?)` runs `fn` inside a request scope, the only door to a server client,
    for tests with no DOM.

  `ErrorKind` gains `"test-environment"`, thrown when `runInTestRequest()` is called from a test file
  that has a `window` and the request scope would be silently ignored.
