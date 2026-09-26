---
"astro-tanstack-query": patch
---

The dev toolbar app added by `devtools: true` now loads the query runtime and
`@tanstack/query-devtools` the first time it is opened. Before, Astro's toolbar loaded it on every
dev page and it mounted a hidden panel straight away, so each page parsed and ran about 550 kB of
development-mode devtools, and kept that panel re-rendering on every cache event, even when
nobody opened it and the page used no store. Once opened, the panel stays mounted when the app is
closed, so it keeps its own state. Production builds are unaffected.
