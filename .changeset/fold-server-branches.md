---
"astro-tanstack-query": patch
---

Browser bundles no longer carry the server half of the store bridge. Each server check now also
reads a `browserBuild` constant from the integration's virtual config module, which is true only
when Vite builds for the client, so the client build deletes the request-scope lookup, the SSR
snapshot path and the server-only errors. Measured in Vite 8's own build, gzip: `createQuery`
alone is 295 B smaller, all five store factories 357 B, `actionQuery` with `actionMutation` 360 B,
`family` with `derived` 365 B. SSR, prerendering and `astro-tanstack-query/testing` keep the
runtime `typeof window` check, so server behaviour and your unit tests are unchanged.

One unsupported setup changes: a module built for the browser but run without a `window`, such as
the store bridge imported into a Web Worker, used to take the server path silently. It now takes
the browser path and throws when it reaches `document`.
