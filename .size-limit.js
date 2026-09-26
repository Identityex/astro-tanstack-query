import { fileURLToPath } from "node:url";

// size-limit externalises peerDependencies by default, which measures the npm tarball's own code
// (~1.3 kB) rather than what a browser actually downloads (~11 kB, because query-core and
// nanostores are bundled into the page by the consumer's build). The budgets in docs/design.md
// section 7 are the browser number, so the first two rows RESET `external` rather than appending
// to it — the only thing that stays external is the `astro:actions` virtual module, which Astro
// supplies at build time and has no size of its own.
//
// The rows are an esbuild upper bound on what Vite ships. `define` supplies the two constants
// Vite's client build replaces, so observer-store's dev-only warning, which Vite strips, is not
// counted. What esbuild cannot do is fold the `browserBuild` flag: it keeps every server branch
// behind it, and pays a few bytes for the flag besides, where Vite's build deletes them. The Vite
// build test in __tests__/support/treeshake.test.ts measures that pipeline: about 600 B lower than
// this file on createQuery and 700 B lower on all stores.
//
// A figure below marked "size-limit" is gzip bytes as `npm run size` reports them: esbuild with
// this file's settings, gzip level 9, less size-limit's empty-project allowance (46 B for a row
// with `import`, 32 B without). One for a bundle that is not a row was measured the same way.
const alias = {
  "virtual:astro-tanstack-query/config": fileURLToPath(
    new URL("./__tests__/support/virtual-config.ts", import.meta.url),
  ),
};

/** What Vite's client build replaces, so both are measured as a browser receives them. */
const define = { "import.meta.env.DEV": "false", "import.meta.env.SSR": "false" };

/** What a browser downloads: peers bundled in. */
const delivered = (config) => ({
  ...config,
  // Astro consumes ES modules, including the parser-readiness top-level await.
  format: "esm",
  alias: { ...(config.alias ?? {}), ...alias },
  external: ["astro:actions"],
  define: { ...(config.define ?? {}), ...define },
});

/** Incremental cost of an optional entry on a page that already loads the query runtime. */
const onTopOfQuery = (config) => ({
  ...config,
  format: "esm",
  alias: { ...(config.alias ?? {}), ...alias },
  external: ["astro:actions", "@tanstack/query-core", "nanostores"],
  define: { ...(config.define ?? {}), ...define },
});

export default [
  {
    // 11,309 B (size-limit).
    name: "query: createQuery (delivered)",
    path: "dist/query/index.js",
    import: "{ createQuery }",
    limit: "12 kB",
    gzip: true,
    modifyEsbuildConfig: delivered,
  },
  {
    // 12,260 B (size-limit). The activity stores add 83 B of it: 12,177 B without
    // createIsFetching/createIsMutating (same pipeline).
    name: "query: all stores (delivered)",
    path: "dist/query/index.js",
    import:
      "{ createQuery, createInfiniteQuery, createMutation, createIsFetching, createIsMutating }",
    limit: "13.5 kB",
    gzip: true,
    modifyEsbuildConfig: delivered,
  },
  {
    // 1.6 not 1.5: making fragment caching opt-in (an un-annotated hx-get must always revalidate,
    // rather than inheriting the query client's 60 s default) cost 22 B of resolution logic and
    // the comment explaining it. 1.65 not 1.6: the page client reads state only from a <script>
    // (a class or id on user HTML survives sanitizers, a script does not), and this row bundles
    // that client: 1,597 B before, 1,625 B after (size-limit). 9 B of it is the `browserBuild`
    // flag esbuild cannot fold; Vite's build folds it, 1,532 B before the <script> check (Vite 8
    // `build()`, minified, the same peers external, gzip level 9).
    name: "htmx on top of query",
    path: "dist/htmx/index.js",
    limit: "1.65 kB",
    gzip: true,
    modifyEsbuildConfig: onTopOfQuery,
  },
  {
    // `onTopOfQuery` externalises the third-party peers but not this package's own /query entry, so
    // this row re-bundles the createQuery/createMutation bridge the wrappers import — hence 2,003 B
    // (size-limit) rather than the wrappers' own weight. The marginal cost of adding /actions to a
    // page that already loads /query is 207 B (a createQuery + createMutation bundle with and
    // without /actions, same pipeline), 32 B of it `isActionError`, which types an Action's error
    // apart from a failed request. 2.05 not 2 kB: that guard, plus the script-only state read in
    // the page client this row re-bundles, took it from 1,935 B to 2,003 B.
    name: "actions on top of query",
    path: "dist/actions/index.js",
    limit: "2.05 kB",
    gzip: true,
    modifyEsbuildConfig: onTopOfQuery,
  },
  {
    // The browser half alone, which is the only half a page downloads. `devalue.js` exports
    // `reader` and `writer` as two objects precisely so this row can name one: a property cannot
    // be shaken off a live object, so while both halves sat on a single `devalueSerializer`
    // literal every page opting into serializer: "devalue" also shipped `stringify`, which runs
    // solely on the server in stateScript(). Measured with devalue 5.9.4 (size-limit, and the same
    // pipeline for the bundles that are not rows): devalue `parse` alone 1,670 B, `parse` +
    // `stringify` 3,832 B; the whole module — what this row measured before the split, and what it
    // would measure again if the `import` field were ever dropped — 3,964 B; this row 1,694 B.
    // Affects only serializer: "devalue".
    name: "devalue reader (browser) on top of query",
    path: "dist/serializer/devalue.js",
    import: "{ reader }",
    limit: "2.3 kB",
    gzip: true,
    modifyEsbuildConfig: onTopOfQuery,
  },
  {
    // The server half, which no browser downloads. Measured 2,776 B (size-limit). It earns a row of
    // its own so the pair reads as "reader + writer ~= the whole module": fuse the two objects back
    // together and the reader row jumps by roughly this much, which is exactly the regression to
    // catch.
    name: "devalue writer (server only)",
    path: "dist/serializer/devalue.js",
    import: "{ writer }",
    limit: "3.2 kB",
    gzip: true,
    modifyEsbuildConfig: onTopOfQuery,
  },
];
