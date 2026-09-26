---
"astro-tanstack-query": patch
---

- The page client reads state only from a `<script>` element: the page's `script#astro-tq`, and a
  server island's `.astro-tq` only when it is a script. A class, an id and `data-*` attributes
  survive HTML sanitizers, so user content styled with them could otherwise write into the cache.
- Only a response with no body releases the request client at once. A streamed non-HTML body, and
  a compressed or non-UTF-8 page, now keep it until their stream ends, as every other page does, so
  components rendering while they stream still find what was prefetched.
- A store read on the server outside a request is shaped under the configured defaults
  (`defaultOptions` and `ssr.staleTime`), so its placeholder reports what a mount would do.
- `actionMutation`'s error is the Action's `ActionError<TInput>` or a transport error, since a
  failed request rejects with a plain `Error`. New `isActionError(error)` narrows it to the Action's
  own error, after which `isInputError(error)` types `fields` by the Action's schema.
