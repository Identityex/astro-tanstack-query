---
"astro-tanstack-query": minor
---

The server render of a query or infinite query store now reports the same loading state as the browser's first read, so islands hydrate without a mismatch.

Reading a store in the browser mounts it, and mounting starts any fetch-on-mount, so the island's first client render already sees `isLoading`/`isFetching`. The server snapshot now uses TanStack's optimistic results, as the official React, Vue, Svelte and Solid adapters do, and reports that same state. Stores still never fetch on the server.

- A query that was not prefetched renders with `isLoading: true`, `isFetching: true` and `fetchStatus: "fetching"`. Before, it rendered as pending but idle.
- A prefetch that is already stale (for example `staleTime: 0`) renders with `isFetching: true`.
- A prefetch that failed, of a query that fetches on mount, renders as pending and loading, not as an error. Errored queries are not sent to the browser, so the browser starts from nothing and fetches. A query with `enabled: false` or `retryOnMount: false` does not fetch on mount, so its server render keeps `status: "error"` while the browser starts pending: a hydration mismatch.
- Fresh prefetches and `enabled: false` stores are unchanged.

**Breaking:** the SSR HTML changes for any island that branches on `isLoading`, `isFetching` or `fetchStatus` of a store that was not prefetched, or on the error of a failed prefetch.
