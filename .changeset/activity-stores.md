---
"astro-tanstack-query": minor
---

Add `createIsFetching(filters?)` and `createIsMutating(filters?)` to `astro-tanstack-query/query`, the equivalents of `useIsFetching` and `useIsMutating`. Each returns a read-only nanostore of how many queries are fetching, or how many mutations are pending, across every island on the page, which is what a global spinner or progress bar needs. They are safe to create at module level and to read during SSR, where they always read 0, as upstream's hooks do: they never touch the request client, and the page client is created only when one mounts in the browser. A page that does not import them pays nothing.
