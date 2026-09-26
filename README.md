# astro-tanstack-query

[![CI](https://github.com/Identityex/astro-tanstack-query/actions/workflows/ci.yml/badge.svg)](https://github.com/Identityex/astro-tanstack-query/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/astro-tanstack-query)](https://www.npmjs.com/package/astro-tanstack-query)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**One TanStack Query cache shared by every island on an Astro page** — React, Svelte, Vue,
Solid, Preact, Alpine, a plain `<script>` and htmx — with server prefetch, automatic hydration
and a per-request client on the server that no module can import by accident.

> [!IMPORTANT]
> **This is an unofficial, community-maintained project.** It is not affiliated with, endorsed
> by, or supported by the [Astro](https://astro.build) team or the
> [TanStack](https://tanstack.com) team. "Astro" and "TanStack" are used only to describe what
> this package works with. Please report problems
> [in this repository](https://github.com/Identityex/astro-tanstack-query/issues), not to either
> upstream project.
>
> It is also **pre-1.0**: the API may change between minor versions while it settles. Every
> change is recorded in the changelog.

## Contents

- [Why](#why)
- [Features](#features)
- [Compatibility](#compatibility)
- [Install](#install)
- [Quick start](#quick-start)
- [Guides](#guides)
- [Configuration](#configuration)
- [Testing your queries](#testing-your-queries)
- [API reference](#api-reference)
- [Bundle size](#bundle-size)
- [Security](#security)
- [Limitations](#limitations)
- [FAQ](#faq)
- [Contributing](#contributing)
- [License](#license)

## Why

Astro renders islands as independent mounts. The usual ways to use TanStack Query in Astro
therefore give each island its own cache:

- **N islands make N requests** for the same data, and an invalidation in one island is
  invisible to the rest.
- **Islands in different frameworks cannot share anything**, and some frameworks (Alpine, Lit,
  a plain script) have no TanStack adapter at all.
- **The common workaround leaks data between users.** A module-scoped `QueryClient` passed into
  each framework's hooks is also module-scoped _on the server_, where every request shares it.
  Once `staleTime` is set, one visitor's prefetched data is served to the next. It goes
  unnoticed until the cache starts doing its job.

This package bridges each query to a [nanostore](https://github.com/nanostores/nanostores)
through TanStack's framework-agnostic `QueryObserver`. Every framework Astro renders already has
a nanostores binding, so one cache serves them all. On the server, injected middleware gives
each request its own client, and stores reach it only through that request.

## Features

- **One cache per page, every framework.** Five islands in four frameworks reading the same
  query make one request; invalidating from any of them updates all of them.
- **Per-request isolation on the server.** No importable server client exists. The only paths
  are `Astro.locals.queryClient` and an `AsyncLocalStorage` scope, both torn down with the
  request.
- **Explicit SSR prefetch, automatic hydration.** `await $store.prefetch()` in frontmatter; the
  state is dehydrated into the page and read back before any island subscribes. Streamed
  responses are supported.
- **Tracked results.** A component re-renders only when a property it read changes.
- **Astro Actions** as a typed query and mutation transport, with `ActionError` preserved.
- **htmx** read-through fragment cache with declarative invalidation.
- **View Transitions.** The cache survives client-side navigation.
- **TanStack Query Devtools** in development, excluded from production builds.
- **Small and opt-in.** A page that imports no store ships 0 bytes. Every optional feature is
  its own entry point with a size budget enforced in CI.
- **A real test harness.** `astro-tanstack-query/testing` lets Vitest run the real store bridge
  instead of a mock.

## Compatibility

| Dependency                 | Supported            | Notes                                                             |
| -------------------------- | -------------------- | ----------------------------------------------------------------- |
| `astro`                    | `^7.3.0`             | Older majors are not tested                                       |
| `@tanstack/query-core`     | `^5.90.0`            | Required peer                                                     |
| `nanostores`               | `^1.0.0`             | Required peer                                                     |
| Node.js                    | `>=22`               | Developed and tested on Node 24                                   |
| `devalue`                  | `^5.0.0 \|\| ^6.0.0` | Optional, for `serializer: "devalue"`                             |
| `htmx.org`                 | `^2.0.0`             | Optional, for `astro-tanstack-query/htmx`                         |
| `@tanstack/query-devtools` | `^5.90.0`            | Optional, for Devtools in development                             |
| Adapter                    | `@astrojs/node`      | End-to-end tested. Edge runtimes: see [Limitations](#limitations) |

UI frameworks read stores through their nanostores binding: `@nanostores/react`,
`@nanostores/preact`, `@nanostores/vue`, `@nanostores/solid`, `@nanostores/alpine` or
`@nanostores/lit`. Svelte needs no binding, because a nanostore already satisfies Svelte's store
contract. A plain `<script>` uses `store.subscribe()`.

## Install

```sh
npm install astro-tanstack-query @tanstack/query-core nanostores
```

Add the binding for each framework you use, for example:

```sh
npm install @nanostores/react @nanostores/vue
```

Then register the integration:

```js
// astro.config.mjs
import { defineConfig } from "astro/config";
import tanstackQuery from "astro-tanstack-query";

export default defineConfig({
  integrations: [tanstackQuery()],
});
```

`npx astro add astro-tanstack-query` performs the last step for you. The integration injects its
middleware; you do not add it yourself.

## Quick start

### 1. Define a store once

```ts
// src/queries/thing.ts
import { absoluteUrl, createQuery } from "astro-tanstack-query/query";

export type Thing = { value: string };

export const $thing = createQuery<Thing>({
  queryKey: ["thing"],
  queryFn: async ({ signal }) => {
    const response = await fetch(absoluteUrl("/api/thing"), { signal });
    return (await response.json()) as Thing;
  },
});
```

`createQuery` accepts the same options as TanStack Query's `QueryObserver`. `absoluteUrl()`
resolves a path against the page in the browser and against the current request on the server,
where a relative `fetch` would fail.

### 2. Read it from any island

Concurrent readers share one request; later refetches follow the query options.

<details open>
<summary>React / Preact</summary>

```tsx
import { useStore } from "@nanostores/react"; // or @nanostores/preact
import { $thing } from "../queries/thing";

export default function ThingCard() {
  const { data, isPending } = useStore($thing);
  return <p>{isPending ? "Loading…" : data?.value}</p>;
}
```

</details>

<details>
<summary>Svelte</summary>

```svelte
<script lang="ts">
  import { $thing as thing } from "../queries/thing";
</script>

<p>{$thing.isPending ? "Loading…" : $thing.data?.value}</p>
```

</details>

<details>
<summary>Vue</summary>

```vue
<script setup lang="ts">
import { useStore } from "@nanostores/vue";
import { $thing } from "../queries/thing";

const thing = useStore($thing);
</script>

<template>
  <p>{{ thing.isPending ? "Loading…" : thing.data?.value }}</p>
</template>
```

</details>

<details>
<summary>Solid</summary>

```tsx
import { useStore } from "@nanostores/solid";
import { $thing } from "../queries/thing";

export default function ThingCard() {
  const thing = useStore($thing);
  return <p>{thing().isPending ? "Loading…" : thing().data?.value}</p>;
}
```

</details>

<details>
<summary>Plain script</summary>

```astro
<p id="thing">Loading…</p>

<script>
  import { $thing } from "../queries/thing";

  const output = document.querySelector("#thing");
  $thing.subscribe(({ data }) => {
    if (output && data) output.textContent = data.value;
  });
</script>
```

</details>

### 3. Prefetch on the server (optional)

Prefetch in frontmatter so the first paint already has data. The prefetch runs on this request's
own client, so concurrent requests never see each other's data:

```astro
---
import ThingCard from "../islands/ThingCard";
import { $thing } from "../queries/thing";

await $thing.prefetch();
---

<ThingCard client:load />
```

The island renders with data during SSR, and the browser hydrates the same entry without
refetching it.

## Guides

### Server prefetch and isolation

Stores **never fetch on the server by themselves**. During SSR, reading a store returns a
snapshot of the current request's client. Anything you did not prefetch renders as pending, then
loads in the browser. This keeps request time predictable and makes prefetching a deliberate
choice.

`prefetch()` accepts an optional **server-only fetcher**. Use it to read directly from a database
or a private service without an HTTP round trip:

```astro
---
import { $profile } from "../queries/profile";
import { loadProfile } from "../server/profiles";

await $profile.prefetch(() => loadProfile(Astro.locals.userId));
---
```

The request's client is also available as `Astro.locals.queryClient` for anything the store API
does not cover. By default the server client uses `staleTime: 60_000`, so the browser does not
refetch hydrated data as soon as it arrives. Change it with `ssr.staleTime`.

### Derived values: use `derived`, not `computed`

```ts
import { derived } from "astro-tanstack-query/query";
import { $thing } from "./thing";

export const $thingValue = derived($thing, (result) => result.data?.value ?? "…");
```

nanostores' `computed` caches its value behind a `globalThis`-scoped epoch counter that only a
store _write_ advances. Stores from this package never write on the server; each read takes a
fresh per-request snapshot. A `computed` over one of them would therefore serve request one's
derived value to request two. `derived` recomputes per read on the server and is plain `computed`
in the browser. It takes one store or an array of stores.

A `computed` whose sources are only plain atoms (not stores from this package) is safe.

### Reactive options and families

Pass a store of options to make a query follow changing input:

```ts
import { atom, computed } from "nanostores";
import { createQuery, queryOptions } from "astro-tanstack-query/query";

export const $page = atom(1);

export const $posts = createQuery(
  computed($page, (page) =>
    queryOptions({ queryKey: ["posts", page], queryFn: () => fetchPosts(page) }),
  ),
);
```

For per-parameter stores, `family` memoises one store per query key and releases it when nothing
uses it any more:

```ts
import { family } from "astro-tanstack-query/query";

export const $post = family((slug: string) => ({
  queryKey: ["post", slug],
  queryFn: () => fetchPost(slug),
}));

// $post("hello-world") returns the same store every time it is called.
```

### Mutations and infinite queries

```ts
import { createInfiniteQuery, createMutation } from "astro-tanstack-query/query";

export const $addTodo = createMutation({
  mutationFn: (text: string) => postTodo(text),
  onSuccess: () => $todos.invalidate(),
});

export const $feed = createInfiniteQuery({
  queryKey: ["feed"],
  queryFn: ({ pageParam }) => fetchFeed(pageParam),
  initialPageParam: 0,
  getNextPageParam: (last) => last.nextCursor,
});
```

A mutation store exposes `mutate`, `mutateAsync` and `reset`, and its value is the
`MutationObserver` result.

### Astro Actions

Astro Actions give you a typed transport; this package supplies the cache:

```tsx
import { useStore } from "@nanostores/react";
import { actions } from "astro:actions";
import { actionMutation, actionQuery } from "astro-tanstack-query/actions";

const $todos = actionQuery(actions.listTodos, undefined);
const $add = actionMutation(actions.addTodo, { onSuccess: () => $todos.invalidate() });

export default function TodoList() {
  const todos = useStore($todos);
  const add = useStore($add);
  return (
    <>
      <ul>
        {todos.data?.map((todo) => (
          <li key={todo}>{todo}</li>
        ))}
      </ul>
      <button onClick={() => $add.mutate({ text: "milk" })}>Add milk</button>
      {add.error && <p>{add.error.code}</p>}
    </>
  );
}
```

`actionMutation` surfaces the Action's `ActionError`. On the server, `actionQuery` calls the
Action through the request's `callAction`, so prefetching an Action does not go over HTTP.
`actionQuery` errors are `ActionError | DefaultError`; narrow before reading Action fields.

### htmx

`astro-tanstack-query/htmx` adds a `tanstack-query` extension that serves `hx-get` fragments from
the same cache:

```astro
<div hx-ext="tanstack-query">
  <button hx-get="/fragments/cart" hx-target="#cart" hx-tq-stale-time="60000">Show cart</button>
  <button hx-post="/cart/clear" hx-tq-invalidate='[["htmx", "/fragments/cart"]]'>Clear</button>
  <div id="cart"></div>
</div>

<script>
  import htmx from "htmx.org";
  (globalThis as { htmx?: unknown }).htmx = htmx;
  await import("astro-tanstack-query/htmx");
</script>
```

- Fragment caching is **opt-in** through `hx-tq-stale-time` (milliseconds) on the element or an
  ancestor. An unannotated `hx-get` always goes to the network.
- A fresh cached fragment is swapped in and the request is cancelled. Error responses are never
  cached.
- `hx-tq-invalidate` takes a JSON array of query keys, invalidated after a successful non-GET
  request. A fragment's key is `["htmx", url]` (`keyFor(url)`).
- Every invalidation dispatches `tanstack-query:invalidated` on `<body>`, so an element can
  re-fetch with `hx-trigger="tanstack-query:invalidated from:body"`.

Load htmx before this module; it warns if `window.htmx` is missing.

### View Transitions

With Astro's `<ClientRouter />`, the page client persists across client-side navigations. State
that the next page prefetched on the server is hydrated into the existing cache on
`astro:before-swap`, so data already fetched stays warm.

### Devtools

Install the optional peer `@tanstack/query-devtools`, then enable it:

```js
tanstackQuery({ devtools: true });
```

This adds an Astro dev toolbar app. To place the floating panel yourself, render the component,
which is also development-only:

```astro
---
import QueryDevtools from "astro-tanstack-query/components/QueryDevtools.astro";
---

<QueryDevtools buttonPosition="bottom-right" />
```

Devtools are lazy-imported in development and contribute **0 bytes** to a production build; CI
checks this.

### Emit modes

By default, middleware appends the dehydrated state to the end of every HTML response after all
prefetches have finished, including streamed responses. If another integration rewrites the HTML
in a conflicting way, switch to the explicit component:

```js
tanstackQuery({ emit: "component" });
```

```astro
---
import QueryState from "astro-tanstack-query/components/QueryState.astro";
---

<body>
  <!-- …islands… -->
  <QueryState />
</body>
```

Place `<QueryState />` last inside `<body>`, after every island, so it runs after all prefetches.

## Configuration

```js
// astro.config.mjs
import { defineConfig } from "astro/config";
import tanstackQuery from "astro-tanstack-query";

export default defineConfig({
  integrations: [
    tanstackQuery({
      config: "./src/query.config.ts",
      serializer: "json",
      emit: "middleware",
      ssr: { staleTime: 60_000 },
      devtools: false,
    }),
  ],
});
```

| Option          | Default        | Description                                                                                                                |
| --------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `config`        | none           | Path, relative to the project root, to a module exporting `defaultOptions` for both the page and request clients.          |
| `serializer`    | `"json"`       | `"json"` (no dependency, XSS-safe escaping) or `"devalue"` (also round-trips `Date`, `Map`, `Set`, `BigInt`, `undefined`). |
| `emit`          | `"middleware"` | How dehydrated state reaches the page: automatic middleware, or the explicit `<QueryState />` component.                   |
| `ssr.staleTime` | `60_000`       | `staleTime` for the per-request client, so hydrated data is not immediately refetched.                                     |
| `devtools`      | `false`        | Enable TanStack Query Devtools and a dev toolbar app. Development only.                                                    |

The `config` module holds options that cannot be expressed as JSON, such as functions:

```ts
// src/query.config.ts
import type { DefaultOptions } from "@tanstack/query-core";

export const defaultOptions: DefaultOptions = {
  queries: {
    retry: (count, error) => count < 2 && !(error instanceof TypeError),
  },
};
```

## Testing your queries

`astro-tanstack-query/query` imports a virtual module that only this package's Vite plugin
resolves, so a plain Vitest run cannot import it. The usual fix is `vi.mock`, but a mock factory
is never type-checked against the module it replaces, so it drifts from the real API while the
tests stay green. `astro-tanstack-query/testing` lets tests run the real bridge instead:

```ts
// vitest.config.ts
import { installTestQueryConfig } from "astro-tanstack-query/testing";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [installTestQueryConfig()],
});
```

The plugin accepts the same `config`, `serializer`, `emit` and `ssr` options as the integration.
Point `config` at the file your `astro.config.mjs` uses, and your tests run on your real
`defaultOptions`.

**With a DOM** (`jsdom`, `happy-dom`), stores take their browser path. The single page client is
shared between tests, so reset it:

```ts
// @vitest-environment happy-dom
import { createQuery } from "astro-tanstack-query/query";
import { resetTestQueryClient } from "astro-tanstack-query/testing";
import { afterEach, expect, it, vi } from "vitest";

afterEach(resetTestQueryClient);

it("fetches once and shares the cache", async () => {
  const queryFn = vi.fn(async () => ({ count: 3 }));
  const $a = createQuery({ queryKey: ["count"], queryFn });
  const $b = createQuery({ queryKey: ["count"], queryFn });
  $a.subscribe(() => {});
  $b.subscribe(() => {});
  await vi.waitFor(() => expect($b.get().data).toEqual({ count: 3 }));
  expect(queryFn).toHaveBeenCalledTimes(1);
});
```

**Without a DOM**, stores take their server path. Wrap the test in `runInTestRequest()` to get
the request scope the middleware would create:

```ts
import { runInTestRequest } from "astro-tanstack-query/testing";

it("prefetches the way frontmatter does", async () => {
  await runInTestRequest(
    async ({ queryClient }) => {
      await $thing.prefetch();
      expect(queryClient.getQueryData(["thing"])).toEqual({ value: "one" });
    },
    { url: "https://example.com/things" },
  );
});
```

`runInTestRequest` takes the request `url` that `absoluteUrl()` resolves against (default
`http://localhost:4321/`) and an optional `queryClient`. The default client never retries, so a
rejecting `queryFn` fails the test immediately.

## API reference

| Entry point                         | Exports                                                                                                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `astro-tanstack-query`              | The integration (default export) and `TanstackQueryOptions`                                                                                                        |
| `astro-tanstack-query/query`        | `createQuery`, `createInfiniteQuery`, `createMutation`, `family`, `derived`, `queryOptions`, `absoluteUrl`, `getQueryClient`, `TanstackQueryAstroError`, and types |
| `astro-tanstack-query/actions`      | `actionQuery`, `actionMutation`, `ActionInput`, `ActionOutput`                                                                                                     |
| `astro-tanstack-query/htmx`         | Registers the extension on import; `registerExtension`, `keyFor`, `EXTENSION_NAME`, `INVALIDATED_EVENT`                                                            |
| `astro-tanstack-query/server`       | `stateScript`, `injectState`, `currentScope`, for custom emission                                                                                                  |
| `astro-tanstack-query/testing`      | `installTestQueryConfig`, `resetTestQueryClient`, `runInTestRequest`                                                                                               |
| `astro-tanstack-query/components/*` | `QueryState.astro`, `QueryDevtools.astro`                                                                                                                          |

A query store is a nanostores `ReadableAtom` of the `QueryObserverResult`, plus:

| Member                | Description                                                                                            |
| --------------------- | ------------------------------------------------------------------------------------------------------ |
| `prefetch(serverFn?)` | Server: fill the request client, optionally with a server-only fetcher. Browser: fill the page client. |
| `refetch()`           | Browser only. Refetch and resolve with the new result.                                                 |
| `invalidate()`        | Invalidate this query's key.                                                                           |
| `setData(updater)`    | Write to the cache directly, for example for an optimistic update.                                     |
| `key`, `options`      | The query hash and the current options.                                                                |

`getQueryClient()` returns the page client in the browser. On the server it throws unless it is
called inside a request, which is intentional: no server client exists outside a request. Misuse
throws `TanstackQueryAstroError`, whose `kind` identifies the problem and whose message says how
to fix it.

## Bundle size

Measured minified and gzipped with peers bundled, which is what a browser downloads. CI enforces
these budgets with [`size-limit`](.size-limit.js).

| What the page imports                                     | Budget    |
| --------------------------------------------------------- | --------- |
| No store                                                  | **0 B**   |
| `createQuery`                                             | ≤ 12 kB   |
| `createQuery`, `createInfiniteQuery` and `createMutation` | ≤ 13.5 kB |
| `/actions`, on top of `/query`                            | ≤ 2 kB    |
| `/htmx`, on top of `/query`                               | ≤ 1.6 kB  |
| `serializer: "devalue"`, on top of `/query`               | ≤ 2.3 kB  |
| Devtools, in a production build                           | **0 B**   |

Almost all of the `/query` cost is `@tanstack/query-core` itself.

## Security

- **Per-request isolation is structural.** No exported server client exists, and a regression
  test replays a cross-request leak with `staleTime` set to prove it cannot happen.
- **Dehydrated state cannot break out of its script element.** It is emitted as
  `<script type="application/json">` with `<`, `>`, `&`, U+2028 and U+2029 escaped.
- **Only successful, prefetched queries are dehydrated.** A failed query's error never reaches
  the HTML, and the request client is cleared after emission.
- **The package reads no cookies, headers or bodies, and never logs query data.**
- Anything you prefetch is embedded in the page. Do not prefetch data the viewer may not see.

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Limitations

| Limitation                                                                                 | Workaround                                                                                        |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `AsyncLocalStorage` context can be lost across non-native thenables on some edge runtimes. | Stores fall back to pending snapshots. The end-to-end suite runs on `@astrojs/node`.              |
| A `queryFn` with a relative URL fails during server prefetch.                              | Use `absoluteUrl()`, or pass a server-only fetcher to `prefetch()`. Development warns about this. |
| nanostores keeps a store mounted for 1 s after its last subscriber leaves.                 | By design, to avoid thrashing. Query cancellation is delayed by up to 1 s.                        |
| Store updates arrive one `setTimeout(0)` tick after the cache changes, as in React Query.  | `await store.refetch()`, or read `getQueryClient().getQueryData()` synchronously.                 |
| A slow streamed document tail delays query-backed interactivity until the state arrives.   | Keep optional server prefetches bounded. Server-rendered island content stays visible meanwhile.  |
| Another integration that rewrites HTML may conflict with the middleware.                   | Use `emit: "component"`.                                                                          |

Out of scope: TanStack Router and Start, typed URL state, `createQueries`, persisters, Suspense,
and per-framework wrapper packages. The [design document](docs/design.md) explains these
decisions.

## FAQ

**Why not use `@tanstack/react-query` (or the Vue, Svelte or Solid packages) directly?**
Each provides a client through framework context, which Astro islands do not share. Passing a
module-level client into each one works in the browser, but it needs an adapter per framework
(Alpine, Lit and plain scripts have none) and puts a shared client on the server. This package
uses one framework-agnostic bridge instead.

**Do I lose features compared with the framework adapters?**
Stores use `QueryObserver`'s tracked results, so a component re-renders only when a property it
read changes, and focus and reconnect refetching come from `query-core`. Framework-specific
features such as Suspense are not provided.

**Can I use a TanStack Router island?**
Yes. Pass `getQueryClient()` into the router's context.

**Will this become official?**
Not at present. If either upstream project ever wants to adopt or bless it, this README will
say so.

## Contributing

Issues and pull requests are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers setup, the
checks CI runs, and how releases work. [docs/design.md](docs/design.md) records the design
decisions and the reasons for them.

## License

[MIT](LICENSE). Astro and TanStack are trademarks of their respective owners. They are named
here only to describe compatibility, which does not imply endorsement.
