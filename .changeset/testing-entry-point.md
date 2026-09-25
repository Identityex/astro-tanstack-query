---
"astro-tanstack-query": minor
---

New entry point `astro-tanstack-query/testing`, so a consumer's unit tests can drive the real store
bridge instead of a mock of it.

`astro-tanstack-query/query` imports `virtual:astro-tanstack-query/config`, which only this
package's Vite plugin resolves — so until now a consumer's only way to unit-test a module built on
`createQuery` was a `vi.mock` factory faking the package. A mock factory is never type-checked
against the module it replaces: two of them in one codebase had already drifted from the real API
and from each other, and the tests stayed green throughout.

- `installTestQueryConfig(options?)` returns a Vite plugin for `vitest.config.ts` that serves the
  virtual config through the integration's own plugin — same module, same options (`config`,
  `serializer`, `emit`, `ssr`), so test config cannot drift from page config. It also marks the
  package `ssr.noExternal` and dedupes `@tanstack/query-core` and `nanostores`, because a module
  Vitest externalises is handed to Node, which has never heard of a `virtual:` id.
- `resetTestQueryClient()` forgets the page client between tests that run with a DOM.
- `runInTestRequest(fn, init?)` runs `fn` inside a request scope, the only door to a server client,
  for tests with no DOM.

`ErrorKind` gains `"test-environment"`, thrown when `runInTestRequest()` is called from a test file
that has a `window` and the request scope would be silently ignored.
