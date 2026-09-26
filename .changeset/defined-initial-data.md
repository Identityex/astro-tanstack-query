---
"astro-tanstack-query": minor
---

A store seeded with `initialData` now types `data` as defined, and the query options no longer accept `throwOnError` or `suspense`.

- `createQuery`, `queryOptions`, `family` and `createInfiniteQuery` have a first overload for options whose `initialData` is always defined, as the official TanStack adapters do. `$todos.get().data` is then `Todo[]`, not `Todo[] | undefined`, so no `!` or `?? []` is needed. This also works through a store of options, `select`, and a `family` whose `define` returns `initialData`. An `initialData` function that may return `undefined` leaves `data` optional. The new `DefinedQueryStore` and `DefinedInfiniteQueryStore` types name these stores.
- `QueryStoreOptions`, the new `InfiniteQueryStoreOptions` and the new `MutationStoreOptions` leave out `throwOnError`, and the query ones also leave out `suspense`. Both options need an error boundary or Suspense, which only a framework adapter has. `throwOnError` did nothing here, and `suspense` silently stopped a store refetching an errored query when its key changed. Read the result's `error` or `status` instead. `actionMutation` and `actionQuery` follow the same options.

**Breaking (types only):** an options object that sets `throwOnError` or `suspense` inline in a call to a store factory, `queryOptions`, `actionMutation` or `actionQuery` no longer compiles. Remove the option. `QueryStore` and `InfiniteQueryStore` gain a trailing type parameter for the result type, with a default, so existing annotations are unchanged. The runtime is unchanged.
