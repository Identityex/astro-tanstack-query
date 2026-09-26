import { absoluteUrl, createQuery } from "astro-tanstack-query/query";

// Prefetched only inside a server island (components/deferred-thing.astro), never by a page: a
// browser request to its endpoint means the island's state did not reach the page cache.
export const $deferredThing = createQuery<string>({
  queryKey: ["deferred-thing"],
  queryFn: async ({ signal }) => {
    const response = await fetch(absoluteUrl("/api/deferred-thing"), { signal });
    return response.text();
  },
});
