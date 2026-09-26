---
"astro-tanstack-query": minor
---

The middleware holds up under `Astro.rewrite()`, refuses a server with a global `window`, and can
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
