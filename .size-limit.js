import { fileURLToPath } from "node:url";

// size-limit externalises peerDependencies by default, which measures the npm tarball's own code
// (~1.3 kB) rather than what a browser actually downloads (~11 kB, because query-core and
// nanostores are bundled into the page by the consumer's build). The budgets in docs/design.md
// section 7 are the browser number, so the first two rows RESET `external` rather than appending
// to it — the only thing that stays external is the `astro:actions` virtual module, which Astro
// supplies at build time and has no size of its own.
const alias = {
  "virtual:astro-tanstack-query/config": fileURLToPath(
    new URL("./__tests__/support/virtual-config.ts", import.meta.url),
  ),
};

/** What a browser downloads: peers bundled in. */
const delivered = (config) => ({
  ...config,
  // Astro consumes ES modules, including the parser-readiness top-level await.
  format: "esm",
  alias: { ...(config.alias ?? {}), ...alias },
  external: ["astro:actions"],
});

/** Incremental cost of an optional entry on a page that already loads the query runtime. */
const onTopOfQuery = (config) => ({
  ...config,
  format: "esm",
  alias: { ...(config.alias ?? {}), ...alias },
  external: ["astro:actions", "@tanstack/query-core", "nanostores"],
});

export default [
  {
    name: "query: createQuery (delivered)",
    path: "dist/query/index.js",
    import: "{ createQuery }",
    limit: "12 kB",
    gzip: true,
    modifyEsbuildConfig: delivered,
  },
  {
    name: "query: all stores (delivered)",
    path: "dist/query/index.js",
    import: "{ createQuery, createInfiniteQuery, createMutation }",
    limit: "13.5 kB",
    gzip: true,
    modifyEsbuildConfig: delivered,
  },
  {
    // 1.6 not 1.5: making fragment caching opt-in (an un-annotated hx-get must always revalidate,
    // rather than inheriting the query client's 60 s default) cost 22 B of resolution logic and
    // the comment explaining it. Measured 1.52 kB.
    name: "htmx on top of query",
    path: "dist/htmx/index.js",
    limit: "1.6 kB",
    gzip: true,
    modifyEsbuildConfig: onTopOfQuery,
  },
  {
    // `onTopOfQuery` externalises the third-party peers but not this package's own /query entry, so
    // this row re-bundles the createQuery/createMutation bridge the wrappers import — hence 1,847 B
    // rather than the wrappers' own weight. The marginal cost of adding /actions to a page that
    // already loads /query is 172 B (measured by diffing a bundle of both against /query alone).
    name: "actions on top of query",
    path: "dist/actions/index.js",
    limit: "2 kB",
    gzip: true,
    modifyEsbuildConfig: onTopOfQuery,
  },
  {
    // The browser half alone, which is the only half a page downloads. `devalue.js` exports
    // `reader` and `writer` as two objects precisely so this row can name one: a property cannot
    // be shaken off a live object, so while both halves sat on a single `devalueSerializer`
    // literal every page opting into serializer: "devalue" also shipped `stringify`, which runs
    // solely on the server in stateScript(). Measured (esbuild, minified, gzip, production):
    // devalue `parse` alone 2,161 B, `parse` + `stringify` 3,754 B; the whole module — what this
    // row measured before the split, and what it would measure again if the `import` field were
    // ever dropped — 3,830 B; this row 2,137 B. Affects only serializer: "devalue".
    name: "devalue reader (browser) on top of query",
    path: "dist/serializer/devalue.js",
    import: "{ reader }",
    limit: "2.3 kB",
    gzip: true,
    modifyEsbuildConfig: onTopOfQuery,
  },
  {
    // The server half, which no browser downloads. Measured 2,932 B. It earns a row of its own so
    // the pair reads as "reader + writer ~= the whole module": fuse the two objects back together
    // and the reader row jumps by roughly this much, which is exactly the regression to catch.
    name: "devalue writer (server only)",
    path: "dist/serializer/devalue.js",
    import: "{ writer }",
    limit: "3.2 kB",
    gzip: true,
    modifyEsbuildConfig: onTopOfQuery,
  },
];
