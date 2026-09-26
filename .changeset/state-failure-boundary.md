---
"astro-tanstack-query": patch
---

Writing the query state can no longer break a page, and a prefetch that cannot reach the page now
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
