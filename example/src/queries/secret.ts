import { createQuery } from "astro-tanstack-query/query";

// The browser never fetches this: it is prefetched per request with a server-only fetcher.
export const $secret = createQuery<string>({
  queryKey: ["secret"],
  queryFn: async () => "not-prefetched",
  staleTime: Infinity,
});
