---
"astro-tanstack-query": patch
---

`family` now releases members that never mount. A member used only for `prefetch()`, `setData()`, `invalidate()`, `refetch()` or `key` (hover prefetch, seeding detail queries from a list) used to stay memoised for the life of the page, across View Transitions, at about 4 kB per key. It now leaves the map after nanostores' unmount delay (about a second), counted from its creation or its last unmount. Calling the family again after that returns a new store for the same query, which reads the same cached data. A store you held on to and mount later puts itself back, so the next call returns it.
