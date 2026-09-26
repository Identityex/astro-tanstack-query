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
  - [Server prefetch and isolation](#server-prefetch-and-isolation)
  - [Static output and prerendered pages](#static-output-and-prerendered-pages)
  - [Derived values](#derived-values-use-derived-not-computed)
  - [Reactive options and families](#reactive-options-and-families)
  - [Mutations and infinite queries](#mutations-and-infinite-queries)
  - [Global loading indicators](#global-loading-indicators)
  - [Astro Actions](#astro-actions)
  - [htmx](#htmx)
  - [View Transitions](#view-transitions)
  - [Server islands](#server-islands)
  - [Devtools](#devtools)
  - [Emit modes](#emit-modes)
- [Configuration](#configuration)
- [Testing your queries](#testing-your-queries)
- [Migrating from 0.1](#migrating-from-01)
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
through TanStack's framework-agnostic `QueryObserver`. Every framework Astro renders can already
read a nanostore, through its nanostores binding or natively (Svelte's `$store`, Solid's
`from()`), so one cache serves them all. On the server, injected middleware gives each request
its own client, and stores reach it only through that request.

## Features

- **One cache per page, every framework.** Five islands in four frameworks reading the same
  query make one request; invalidating from any of them updates all of them.
- **Per-request isolation on the server.** No importable server client exists. The only paths
  are `Astro.locals.queryClient` and an `AsyncLocalStorage` scope, both torn down with the
  request.
- **Explicit SSR prefetch, automatic hydration.** `await $store.prefetch()` in frontmatter; the
  state is dehydrated into the page and read back before any island subscribes. Streamed
  responses and server islands are supported.
- **Tracked results.** A component re-renders only when a property it read changes.
- **Global activity.** `createIsFetching` and `createIsMutating` count fetches and pending
  mutations across every island, for a page-wide spinner or progress bar.
- **Astro Actions** as a typed query and mutation transport, with `ActionError` preserved.
- **htmx** read-through fragment cache with declarative invalidation.
- **View Transitions.** The cache survives client-side navigation.
- **TanStack Query Devtools** in development, excluded from production builds.
- **Small and opt-in.** A page that imports no store ships 0 bytes. Every optional feature is
  its own entry point with a size budget enforced in CI.
- **A real test harness.** `astro-tanstack-query/testing` lets Vitest run the real store bridge
  instead of a mock.

## Compatibility

| Dependency                 | Supported       | Notes                                                             |
| -------------------------- | --------------- | ----------------------------------------------------------------- |
| `astro`                    | `^7.3.0`        | Older majors are not tested                                       |
| `@tanstack/query-core`     | `^5.90.0`       | Required peer                                                     |
| `nanostores`               | `^1.0.0`        | Required peer                                                     |
| Node.js                    | `>=22`          | Developed and tested on Node 24                                   |
| `devalue`                  | `^5.0.0`        | Optional, for `serializer: "devalue"`                             |
| `htmx.org`                 | `^2.0.0`        | Optional, for `astro-tanstack-query/htmx`                         |
| `@tanstack/query-devtools` | `^5.90.0`       | Optional, for Devtools in development                             |
| Adapter                    | `@astrojs/node` | End-to-end tested. Edge runtimes: see [Limitations](#limitations) |

UI frameworks read stores through their nanostores binding: `@nanostores/react`,
`@nanostores/preact`, `@nanostores/vue`, `@nanostores/alpine` or `@nanostores/lit`. Svelte needs
no binding, because a nanostore already satisfies Svelte's store contract. Solid needs none
either: it reads a store with its built-in `from(store, store.get())`. Do not use
`@nanostores/solid`: its `useStore` reconciles each update into the previous value, and that value
is TanStack Query's cached data, so switching keys writes one key's data into another key's cache
entry. A plain `<script>` uses `store.subscribe()`.

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

`createQuery` accepts the same options as TanStack Query's `QueryObserver`, except `throwOnError`
and `suspense`, which need an error boundary or Suspense that only a framework adapter has; read
the result's `error` or `status` instead. When `initialData` is always defined, `data` is typed as
defined, so reads need no `!` or `?? []`. `absoluteUrl()` resolves a path against the page in the
browser and against the current request on the server, where a relative `fetch` would fail.

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
import { from } from "solid-js";
import { $thing } from "../queries/thing";

export default function ThingCard() {
  const thing = from($thing, $thing.get());
  return <p>{thing().isPending ? "Loading…" : thing().data?.value}</p>;
}
```

Solid's own `from()`, not `@nanostores/solid` (see [Compatibility](#compatibility)). Passing the
current value as its second argument types the accessor as always defined.

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

The server render reports the same loading state as the browser's first read: a query that will
fetch on mount renders with `isLoading` and `isFetching` true and `fetchStatus: "fetching"`, so an
`isLoading ? … : …` branch hydrates without a mismatch. The server still never starts that fetch.
A prefetch that failed is not sent to the browser, so a query that fetches on mount also renders as
pending and loading, not as an error. Two cases still mismatch (see [Limitations](#limitations)):
a failed prefetch of a query that does not fetch on mount (`enabled: false` or
`retryOnMount: false`), which the server renders as an error and the browser as pending, and an
island that hydrates after something else on the page has already fetched its query.

Await a prefetch before any island that reads its key renders. A prefetch still in flight when
the page finishes is not written into it: the browser fetches it again, and development warns. To
keep the head streaming, start the prefetch early and await it close to the island:
`const thing = $thing.prefetch()` in the page, then pass `thing` to a component that wraps the
island and `await` it in that component's frontmatter.

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
does not cover. By default both the request client and the page client use `staleTime: 60_000`,
so the browser does not refetch hydrated data as soon as it arrives. Change it with
`ssr.staleTime`; a `queries.staleTime` in the `config` module overrides it on both.

`Astro.rewrite()` runs the middleware again. The rewritten page shares the request's client,
`absoluteUrl()` follows the rewritten URL, and the page gets one state element holding both
pages' prefetches.

If you self-host on Node, read [Security](#security) before prefetching through
`fetch(absoluteUrl(…))`.

### Static output and prerendered pages

With `output: "static"` (Astro's default) and on prerendered routes, `prefetch()` runs once, at
build time, and its result is written into the HTML every visitor gets. `absoluteUrl()` then
resolves against `ssr.origin` if you set it, else `site`, else `http://localhost:<port>`: at best
the site as it was last deployed, never the build in progress. So pass a server fetcher that reads
the source directly:

```astro
---
import { $thing } from "../queries/thing";
import { readThing } from "../server/things";

await $thing.prefetch(() => readThing());
---
```

- The hydrated `dataUpdatedAt` is the build time, so visitors refetch on mount once it is older
  than `ssr.staleTime`.
- While prerendering, a failed prefetch logs one warning naming its query hash, as it does in
  development. `astro build` runs with `DEV` false, so this is the only sign of it.
- `currentScope()?.isPrerendered`, from `astro-tanstack-query/server`, is Astro's per-route
  `prerender` flag. It is true for a prerendered route in `astro dev` too, and for every route
  under `output: "static"`. Server code that must behave differently only in the build checks
  `currentScope()?.isPrerendered && !import.meta.env.DEV`.

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

For per-parameter stores, `family` memoises one store per query key while it is in use. A member
that is not mounted is released after nanostores' unmount delay (about a second), counted from its
creation or its last unmount. That includes a member that is only prefetched, seeded with
`setData`, invalidated or keyed, and never mounts. Calling the family again after that returns a
new store for the same query, which reads the same cached data:

```ts
import { family } from "astro-tanstack-query/query";

export const $post = family((slug: string) => ({
  queryKey: ["post", slug],
  queryFn: () => fetchPost(slug),
}));

// $post("hello-world") returns the same store while it is in use.
```

When `define` always returns `initialData`, each member's `data` is typed as defined, as with
`createQuery`. The same holds for a store of options.

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
`MutationObserver` result. Per-call callbacks, as in
`$addTodo.mutate(text, { onSuccess, onError, onSettled })`, fire even when nothing subscribes to
the store: from an Astro `<script>`, an htmx handler or an island that only renders a button. They
also fire if the calling island unmounted before the mutation settled. React Query's
`useMutation` skips them in that case, but a store has no component lifetime. `actionMutation`
behaves the same way.

An infinite store's `prefetch()` accepts a server-only fetcher too, as `createQuery`'s does.

### Global loading indicators

`createIsFetching` and `createIsMutating` count what every island on the page is doing, like
`useIsFetching` and `useIsMutating`. Each is a read-only nanostore of a number. The optional
filters are the `QueryFilters` or `MutationFilters` that `QueryClient.isFetching()` and
`isMutating()` take. They are fixed when the store is created.

```ts
// src/stores/activity.ts
import { createIsFetching, createIsMutating } from "astro-tanstack-query/query";

export const $fetching = createIsFetching();
export const $savingTodos = createIsMutating({ mutationKey: ["todos"] });
```

```astro
<div id="spinner" hidden>Loading…</div>

<script>
  import { $fetching } from "../stores/activity";

  $fetching.subscribe((count) => {
    document.getElementById("spinner")?.toggleAttribute("hidden", count === 0);
  });
</script>
```

Nothing fetches during SSR, so on the server both stores always read 0, as upstream's hooks do.
Render the indicator hidden and let the browser reveal it; an island that renders the count can
mismatch on hydration (see [Limitations](#limitations)).

### Astro Actions

Astro Actions give you a typed transport; this package supplies the cache:

```tsx
import { useStore } from "@nanostores/react";
import { actions } from "astro:actions";
import { actionMutation, actionQuery, isActionError } from "astro-tanstack-query/actions";

const $todos = actionQuery(actions.listTodos);
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
      {isActionError(add.error) && <p>{add.error.code}</p>}
    </>
  );
}
```

`listTodos` takes no input, so `actionQuery` needs none; an Action whose input is required still
requires it.

`actionMutation`'s `error` is the Action's own `ActionError<TInput>`, which
`ActionErrorOf<typeof actions.addTodo>` names, or a plain `Error` when the request itself fails
(offline, a dropped connection): `.orThrow()` fetches, and a failed fetch never becomes an
`ActionError`. After `isActionError(error) && isInputError(error)`, `error.fields` has the
schema's keys, so a typo such as `fields.txet` does not compile. Import `isActionError` from
`astro-tanstack-query/actions`: it keeps the Action's input type, where Astro's own, from
`astro:actions`, narrows to an untyped `ActionError`, and `isInputError()` alone takes its untyped
overload on the union.

On the server, `actionQuery` calls the Action through the request's `callAction`, so prefetching
an Action does not go over HTTP. Its `error` has the same type as `actionMutation`'s, and
`isActionError()` narrows it the same way. `select` can change the data type:
`actionQuery(actions.listTodos, undefined, { select: (todos) => todos.length })` is a store of a
number.

For composition, `actionQueryOptions(action, input, options)` returns the options `actionQuery`
builds, with a typed `queryKey`. Pass them to `family`, to a store of options, or to
`getQueryClient().fetchQuery()` and `getQueryData()`, which then infer the Action's output:

```ts
import { actions } from "astro:actions";
import { actionQueryOptions } from "astro-tanstack-query/actions";
import { family } from "astro-tanstack-query/query";

export const $todo = family((id: string) => actionQueryOptions(actions.getTodo, { id }));
```

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

### Server islands

State prefetched inside a `server:defer` component reaches the islands nested in it:

```astro
---
// src/components/Profile.astro, rendered as <Profile server:defer />
import ProfileCard from "../islands/ProfileCard";
import { $profile } from "../queries/profile";

await $profile.prefetch();
---

<ProfileCard client:load />
```

The middleware writes that request's state at the end of the island's HTML as
`<script type="application/json" class="astro-tq">`. It has no id, so it never replaces the page's
own `#astro-tq`. The page client hydrates it as soon as Astro inserts the island, before any
island inside it first reads a store. Newer data wins, as with View Transitions, so a page-level
query is never rolled back. With `emit: "component"`, put `<QueryState />` last inside the deferred
component as well. Other HTML fragments, such as htmx partials, carry no state (see
[Limitations](#limitations)).

### Devtools

Install the optional peer `@tanstack/query-devtools`, then enable it:

```js
tanstackQuery({ devtools: true });
```

This adds an Astro dev toolbar app, which loads the devtools the first time you open it. To place
the floating panel yourself, render the component, which is also development-only:

```astro
---
import QueryDevtools from "astro-tanstack-query/components/QueryDevtools.astro";
---

<QueryDevtools buttonPosition="bottom-right" />
```

Devtools are lazy-imported in development and contribute **0 bytes** to a production build; CI
checks this.

### Emit modes

By default, middleware writes the dehydrated state before the closing `</body>` of every HTML page
once the page has finished streaming, so it holds every prefetch the page awaited, wherever it
ran. If another integration rewrites the HTML in a conflicting way, or the response is compressed
before it leaves Astro, switch to the explicit component:

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

Place `<QueryState />` last inside `<body>`. It captures prefetches awaited in page or layout
frontmatter, but not those in a component's own frontmatter: Astro renders the components after an
async sibling concurrently, so those can finish after `<QueryState />` has rendered. In
development it warns about a prefetch still in flight, or one that starts after it rendered. If
you prefetch inside components, use the default middleware emission.

A `server:defer` component renders in a request of its own, so also place `<QueryState />` last
inside each deferred component that prefetches. There it writes an id-less element that the page
client hydrates when the island arrives. The middleware mode does this automatically.

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
      ssr: {
        staleTime: 60_000,
        // origin: "https://example.com", // self-hosted Node: see Security
      },
      devtools: false,
    }),
  ],
});
```

| Option          | Default        | Description                                                                                                                                                                                                                                                                                                                                                                                                    |
| --------------- | -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `config`        | none           | Path, relative to the project root, to a module exporting `defaultOptions` for both the page and request clients.                                                                                                                                                                                                                                                                                              |
| `serializer`    | `"json"`       | `"json"` (no dependency, XSS-safe escaping) or `"devalue"` (also round-trips `Date`, `Map`, `Set`, `BigInt`, `undefined`).                                                                                                                                                                                                                                                                                     |
| `emit`          | `"middleware"` | How dehydrated state reaches the page: automatic middleware, or the explicit `<QueryState />` component.                                                                                                                                                                                                                                                                                                       |
| `ssr.staleTime` | `60_000`       | Default `staleTime` for both the per-request client and the page client, so hydrated data is not immediately refetched. A `queries.staleTime` in the `config` module overrides it.                                                                                                                                                                                                                             |
| `ssr.origin`    | none           | The origin server-side `absoluteUrl()` resolves against instead of the request's; the request's path and query are kept. An absolute `http(s)` URL, fixed at build time and also used while prerendering. The browser bundle can read it, so set the public origin, not an internal address. No default: taking `site` would send development and preview prefetches to production. See [Security](#security). |
| `devtools`      | `false`        | Enable TanStack Query Devtools and a dev toolbar app. Development only.                                                                                                                                                                                                                                                                                                                                        |

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
`http://localhost:4321/`), an optional `queryClient`, and `isPrerendered`, the value the
middleware copies from Astro's per-route `prerender` flag (true for a prerendered route in
development as well as in the build). It does not apply `ssr.origin`: pass the `url` you
want `absoluteUrl()` to resolve against. The default client never retries, so a rejecting
`queryFn` fails the test immediately.

## Migrating from 0.1

0.2.0 has six breaking changes. The [changelog](CHANGELOG.md) lists everything else.

- **The server render reports loading.** A store that was not prefetched rendered on the server
  as pending but idle (`isLoading: false`, `fetchStatus: "idle"`). It now renders as the
  browser's first read does, with `isLoading: true`, `isFetching: true` and
  `fetchStatus: "fetching"`, and a failed prefetch of a query that fetches on mount renders as
  pending and loading rather than as an error. Islands that branch on these fields now show their
  loading branch in the server HTML.
- **`throwOnError` and `suspense` are gone from the option types.** Neither worked without a
  framework's error boundary or Suspense. `createQuery({ queryKey, queryFn, throwOnError: true })`
  no longer compiles: drop the option and read the result's `error` or `status`. Only options
  written inline in the call are checked. Options returned from a `computed` or `family`
  callback, or built in a variable first, still compile with either key, so remove it there by
  hand.
- **`refetch` and `invalidate` take options** (`RefetchOptions` and `InvalidateOptions`), so a
  method passed as a handler no longer type-checks: its argument would be read as options.
  `onClick={$thing.refetch}` becomes `onClick={() => $thing.refetch()}`, and
  `onSuccess: $todos.invalidate` becomes `onSuccess: () => $todos.invalidate()`.
- **The Action helpers take Astro's `ActionClient`.** They accept only an Astro Action, not any
  object with an `orThrow` method. `actionMutation`'s `error` changes from `ActionError` to the
  Action's own `ActionError<TInput>` or a plain `Error`, which is what a request that fails before
  the Action answers (offline, a dropped connection) rejects with. Reading `error.code` without
  narrowing no longer compiles: guard with `isActionError(error)` first. An Action that takes no
  input needs none: `actionQuery(actions.listTodos, undefined)` becomes
  `actionQuery(actions.listTodos)`.
- **`initialData` narrows `data`.** When `initialData` is always defined, `data` is typed as
  defined and the store is a `DefinedQueryStore`: `$todos.get().data?.length ?? 0` becomes
  `$todos.get().data.length`. The old form still compiles, but a strict linter reports the `?.`
  as unnecessary. `QueryStore` and `InfiniteQueryStore` gain a trailing result-type parameter
  with a default, so existing annotations are unchanged.
- **A server with a global `window` is refused.** A DOM shim registered globally in the server
  process, such as happy-dom's `GlobalRegistrator`, now fails every request with a
  `TanstackQueryAstroError` of kind `"window-on-server"`. 0.1 served those pages, but every store
  took its browser path there and shared one cache across requests, so one visitor's data leaked
  to the next. Remove the shim from the server, or use a DOM instance that is not global
  (happy-dom's `new Window()`) where your code needs one.

## API reference

| Entry point                         | Exports                                                                                                                                                                                                    |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `astro-tanstack-query`              | The integration (default export) and `TanstackQueryOptions`                                                                                                                                                |
| `astro-tanstack-query/query`        | `createQuery`, `createInfiniteQuery`, `createMutation`, `createIsFetching`, `createIsMutating`, `family`, `derived`, `queryOptions`, `absoluteUrl`, `getQueryClient`, `TanstackQueryAstroError`, and types |
| `astro-tanstack-query/actions`      | `actionQuery`, `actionQueryOptions`, `actionMutation`, `isActionError`, `ActionInput`, `ActionOutput`, `ActionErrorOf`                                                                                     |
| `astro-tanstack-query/htmx`         | Registers the extension on import; `registerExtension`, `keyFor`, `EXTENSION_NAME`, `INVALIDATED_EVENT`                                                                                                    |
| `astro-tanstack-query/server`       | `stateScript`, `injectState`, `warnOnLatePrefetch`, `currentScope`, `SERVER_ISLAND_ROUTE`, `EmitOptions`, `RequestScope`, for custom emission                                                              |
| `astro-tanstack-query/testing`      | `installTestQueryConfig`, `resetTestQueryClient`, `runInTestRequest`                                                                                                                                       |
| `astro-tanstack-query/components/*` | `QueryState.astro`, `QueryDevtools.astro`                                                                                                                                                                  |

The `/query` types are the stores (`QueryStore`, `DefinedQueryStore`, `InfiniteQueryStore`,
`DefinedInfiniteQueryStore`, `MutationStore`), their options (`QueryStoreOptions`,
`InfiniteQueryStoreOptions`, `MutationStoreOptions`, and the `DefinedInitialData…` variants of the
first two) and `ErrorKind`.

`stateScript()` and `injectState()` take `EmitOptions`, `{ warn, island }`. `warn` reports
prefetches the state cannot carry; `island` writes the id-less element a server island needs, for
a request whose `routePattern` is `SERVER_ISLAND_ROUTE`. `injectState()` also releases the
request client once the response has ended; pass `null` as its writer to release without
emitting. `warnOnLatePrefetch(client)` is the development warning `<QueryState />` uses.

A query store is a nanostores `ReadableAtom` of the `QueryObserverResult` (a
`DefinedQueryObserverResult` when `initialData` is always defined), plus:

| Member                 | Description                                                                                                                                                                               |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `prefetch(serverFn?)`  | Server: fill the request client, optionally with a server-only fetcher. Browser: fill the page client. Infinite stores take a server-only fetcher too.                                    |
| `refetch(options?)`    | Browser only. Fetch the key of the current options, even when nothing is mounted, and resolve with the new result. Takes query-core's `RefetchOptions` (`throwOnError`, `cancelRefetch`). |
| `invalidate(options?)` | Invalidate this query's key. Takes query-core's `InvalidateOptions` (`throwOnError`, `cancelRefetch`).                                                                                    |
| `setData(updater)`     | Write to the cache directly, as in the optimistic update below.                                                                                                                           |
| `key`, `options`       | The query hash and the current options. `options.queryKey` is tagged with the data type, so `getQueryClient().getQueryData($x.options.queryKey)` is typed.                                |

An optimistic update needs no mounted store:

```ts
export const $addTodo = createMutation({
  mutationFn: (draft: Todo) => postTodo(draft),
  onMutate: async (draft) => {
    const client = getQueryClient();
    await client.cancelQueries({ queryKey: $todos.options.queryKey });
    const previous = client.getQueryData($todos.options.queryKey); // Todo[] | undefined
    $todos.setData((old) => [...(old ?? []), draft]);
    return { previous };
  },
  onError: (_error, _draft, snapshot) => $todos.setData(snapshot?.previous),
  onSettled: () => $todos.invalidate(),
});
```

In the browser, `$x.get()` mounts the store, which can start a fetch when the entry is stale, and
returns the post-`select` result. Use `getQueryClient().getQueryData($x.options.queryKey)` for the
raw cached value without mounting.

`getQueryClient()` returns the page client in the browser. On the server it throws unless it is
called inside a request, which is intentional: no server client exists outside a request. Misuse
throws `TanstackQueryAstroError`, whose `kind` identifies the problem and whose message says how
to fix it:

| `kind`                            | Thrown when                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------------ |
| `"server-client-outside-request"` | `getQueryClient()`, `absoluteUrl()` or an Action query runs on the server outside a request.     |
| `"browser-only"`                  | `refetch()`, `mutate()`, `mutateAsync()` or `reset()` is called on the server.                   |
| `"serializer-mismatch"`           | The page state was written by a different serializer from the one the browser is configured for. |
| `"invalid-options"`               | The integration gets a bad `serializer`, `emit`, `ssr.staleTime` or `ssr.origin`.                |
| `"window-on-server"`              | The middleware finds a global `window` in the server process, such as a DOM shim.                |
| `"test-environment"`              | `runInTestRequest()` runs in a test file that has a `window`.                                    |

## Bundle size

Measured minified and gzipped with peers bundled, which is what a browser downloads. CI enforces
these budgets with [`size-limit`](.size-limit.js).

| What the page imports                                                                             | Budget    |
| ------------------------------------------------------------------------------------------------- | --------- |
| No store                                                                                          | **0 B**   |
| `createQuery`                                                                                     | ≤ 12 kB   |
| `createQuery`, `createInfiniteQuery`, `createMutation`, `createIsFetching` and `createIsMutating` | ≤ 13.5 kB |
| `/actions`, on top of `/query`                                                                    | ≤ 2.05 kB |
| `/htmx`, on top of `/query`                                                                       | ≤ 1.65 kB |
| `serializer: "devalue"`, on top of `/query`                                                       | ≤ 2.3 kB  |
| Devtools, in a production build                                                                   | **0 B**   |

Almost all of the `/query` cost is `@tanstack/query-core` itself. `size-limit` bundles with
esbuild, so the budgets are an upper bound: Vite's own build of the same entries is about 0.6 to
0.7 kB smaller, because it minifies tighter and drops the stores' server branches. The
[design document](docs/design.md#7-tree-shaking-and-size) has the figures.

## Security

- **Per-request isolation is structural.** No exported server client exists, and a regression
  test replays a cross-request leak with `staleTime` set to prove it cannot happen.
- **Dehydrated state cannot break out of its script element.** It is emitted as
  `<script type="application/json">` with `<`, `>`, `&`, U+2028 and U+2029 escaped.
- **By default, only successful, prefetched queries are dehydrated**, so a failed query's error
  stays out of the page's state. A custom `dehydrate.shouldDehydrateQuery` in the `config`
  module's `defaultOptions` decides that for itself, and overriding it gives up this guard. A
  pending query is never written, even under a custom predicate. A query the serializer cannot
  write is left out, and the log names it by hash only. The request client is cleared once every
  response has ended, in both emit modes: a response with a body (a page, a JSON endpoint, a
  stream) when its stream ends or its reader cancels, a response with no body, such as a redirect,
  at once.
- **Only a `<script>` element is read as state.** The browser finds the page's state with
  `script#astro-tq`, and hydrates a server island's `.astro-tq` element only when it is a
  `<script>`. HTML sanitizers keep `id`, `class` and `data-*` attributes but drop `<script>`, so
  user content rendered into the page cannot write into the cache.
- **The package reads no cookies or bodies, and never logs query data.** It does trust the
  request URL. On the server, `absoluteUrl()` resolves against Astro's request URL, and on
  `@astrojs/node` that URL's host comes from the client's `Host` header, unvalidated: Astro 7.3's
  `createRequestFromNodeRequest` ignores `security.allowedDomains` for it. A forged `Host`
  therefore points a `fetch(absoluteUrl(…))` prefetch at another host and renders what it returns
  into the page. If you self-host, put the server behind a proxy that rejects unknown hosts or
  sets a fixed one, or set `ssr.origin`. For your own endpoints, prefer `prefetch(serverFn)`,
  which reads the source directly with no HTTP hop. Vercel and Netlify route by `Host`, so they
  are not exposed this way.
- **A server with a global `window` is refused.** Stores decide their side with `typeof window`,
  so a DOM shim registered globally on the server would send every store to the browser's page
  client and share one cache across requests. The middleware throws a `TanstackQueryAstroError`
  of kind `"window-on-server"` instead.
- Anything you prefetch is embedded in the page. Do not prefetch data the viewer may not see.

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## Limitations

| Limitation                                                                                                                                                                                                                                                                                                                                           | Workaround                                                                                                                                            |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AsyncLocalStorage` context can be lost across non-native thenables on some edge runtimes.                                                                                                                                                                                                                                                           | Stores fall back to pending, loading snapshots. The end-to-end suite runs on `@astrojs/node`.                                                         |
| A `queryFn` with a relative URL fails during server prefetch.                                                                                                                                                                                                                                                                                        | Use `absoluteUrl()`, or pass a server-only fetcher to `prefetch()`. Development and prerendering warn when a server prefetch fails.                   |
| On `@astrojs/node`, server-side `absoluteUrl()` resolves against the unvalidated `Host` header.                                                                                                                                                                                                                                                      | Put the server behind a proxy that rejects unknown hosts, set `ssr.origin`, or pass a server-only fetcher to `prefetch()`. See [Security](#security). |
| An island that hydrates after an un-prefetched query has already resolved, because another island or a script fetched it, renders data against server HTML that said pending: a hydration mismatch inherent to a shared cache. The same holds for the first value of `createIsFetching` or `createIsMutating`, which the server always renders as 0. | Prefetch what the first paint renders, or use `client:only` for that island. Render an activity indicator hidden and reveal it from a `<script>`.     |
| A failed prefetch of a query that does not fetch on mount (`enabled: false` or `retryOnMount: false`) renders `status: "error"` on the server. Errors are not sent to the browser, which starts from a pending query: a hydration mismatch.                                                                                                          | Use `client:only` for that island, or render its error and pending states with the same markup.                                                       |
| nanostores keeps a store mounted for 1 s after its last subscriber leaves.                                                                                                                                                                                                                                                                           | By design, to avoid thrashing. Query cancellation is delayed by up to 1 s.                                                                            |
| Store updates arrive one `setTimeout(0)` tick after the cache changes, as in React Query.                                                                                                                                                                                                                                                            | `await store.refetch()`, or read `getQueryClient().getQueryData($store.options.queryKey)` synchronously.                                              |
| A slow streamed document tail delays query-backed interactivity until the state arrives.                                                                                                                                                                                                                                                             | Keep optional server prefetches bounded. Server-rendered island content stays visible meanwhile.                                                      |
| Another integration that rewrites HTML may conflict with the middleware.                                                                                                                                                                                                                                                                             | Use `emit: "component"`.                                                                                                                              |
| A compressed or non-UTF-8 HTML response cannot carry the state, for example when a middleware inside Astro compresses the page.                                                                                                                                                                                                                      | Development warns once, and islands fetch in the browser. Use `emit: "component"`, or compress outside Astro.                                         |
| State prefetched in an HTML fragment other than a server island (an htmx partial, a `partial` page) is not written into the response; development warns once.                                                                                                                                                                                        | Prefetch in the page that renders the island. `server:defer` components do carry their state.                                                         |

Out of scope: TanStack Router and Start, typed URL state, `createQueries`, persisters, a Suspense
API, and per-framework wrapper packages. Error boundaries and Suspense are adapter-specific, so the
option types leave out `throwOnError` and `suspense`: read `result.error` or `status` instead. The
[design document](docs/design.md) explains these decisions.

## FAQ

**Why not use `@tanstack/react-query` (or the Vue, Svelte or Solid packages) directly?**
Each provides a client through framework context, which Astro islands do not share. Passing a
module-level client into each one works in the browser, but it needs an adapter per framework
(Alpine, Lit and plain scripts have none) and puts a shared client on the server. This package
uses one framework-agnostic bridge instead.

**Do I lose features compared with the framework adapters?**
Stores use `QueryObserver`'s tracked results, so a component re-renders only when a property it
read changes, and focus and reconnect refetching come from `query-core`. The package provides no
framework-specific API such as Suspense or `throwOnError` error boundaries, and its option types
do not accept those options.

**Can I use React Suspense?**
Only in the browser, through a third-party hook. `@nanostores/react`'s `useLoadingStore($store)`
suspends while a store is loading and throws its `error`. Use it only in a `client:only="react"`
island, inside `<Suspense>` and an error boundary. Three caveats:

- Never use it in a server-rendered island. On the server, a query that was not prefetched, or
  whose prefetch has not settled, reads `isLoading: true`. Server stores never notify, so the
  promise the hook throws never resolves and the page request hangs.
- It throws to the error boundary on any `error`, including a failed background refetch while
  data is already shown. React Query's `useSuspenseQuery` does not.
- A disabled or idle query (`enabled: false`) returns without suspending, so `data` can still be
  `undefined`.

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
