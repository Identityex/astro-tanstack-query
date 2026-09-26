---
"astro-tanstack-query": patch
---

The per-request `QueryClient` is now released exactly once for every response, and the state
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
