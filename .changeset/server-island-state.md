---
"astro-tanstack-query": minor
---

Server islands carry their prefetched state to the page.

- State prefetched inside a `server:defer` component used to be dropped with every other HTML
  fragment, so a `client:*` island inside it hydrated against an empty cache: a hydration
  mismatch, then a second fetch of data the server already had. The middleware now writes a
  server island's state (the `/_server-islands/[name]` route) as
  `<script type="application/json" class="astro-tq">` with no id, so it never shadows the page's
  own `#astro-tq`, and the page client hydrates each one as it arrives. Newer data still wins.
- With `emit: "component"`, put a `<QueryState />` last inside the deferred component; there it
  writes the same id-less element.
- Other fragments, such as htmx partials, still carry no state. Development now warns, once per
  process, when one drops prefetched queries.
- For custom emission, `astro-tanstack-query/server` exports `SERVER_ISLAND_ROUTE`, and
  `stateScript()` and `injectState()` take an `island` option.
- A fragment holding a custom element such as `<html-viewer>` is no longer mistaken for a
  document.
