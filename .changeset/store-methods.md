---
"astro-tanstack-query": minor
---

Store methods now work the same way whether or not anything is subscribed to the store, and the store is typed for use with `getQueryClient()`.

- Per-call `mutate(variables, { onSuccess, onError, onSettled })` and `mutateAsync` callbacks now fire when nothing subscribes to the mutation store, for example in an Astro `<script>`, an htmx handler, or an island that only renders a button. This also covers `actionMutation`. Unlike React Query's `useMutation`, the callbacks still fire if the calling island unmounted before the mutation settled, because a store has no component lifetime.
- `refetch()` on a query or infinite query store built from an options store now fetches the key that `store.key` reports. Before, a store that was never mounted, or had been unmounted for more than a second, refetched the key it last saw.
- `store.options.queryKey` is now a `DataTag`, so `getQueryClient().getQueryData($store.options.queryKey)` and `cancelQueries` infer the cached type. This covers plain stores, `family` members and infinite stores.
- `refetch(options?)` takes `RefetchOptions` and `invalidate(options?)` takes `InvalidateOptions`, and both forward them to query-core.
- `createInfiniteQuery`'s `prefetch(serverQueryFn?)` accepts a server-only fetcher, as `createQuery`'s already did.
