---
"astro-tanstack-query": patch
---

The htmx extension now finds a cached fragment by its query hash instead of scanning the whole query cache on every `hx-get`. The lookup takes the same time however many queries and fragments the page has cached, and a `queryKeyHashFn` in your `defaultOptions` is still respected. On the server, `mutateAsync()` and `reset()` now throw an error naming the method you called; before, all three mutation methods reported `mutate()`.
