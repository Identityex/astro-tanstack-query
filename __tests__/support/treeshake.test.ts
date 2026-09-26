import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { build as viteBuild } from "vite";
import { expect, it, vi } from "vitest";
import { resolveOptions } from "../../src/integration/options";
import { virtualConfigPlugin } from "../../src/integration/virtual-config";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

async function bundle(source: string, config = "./virtual-config.ts"): Promise<string> {
  const result = await build({
    stdin: {
      contents: source,
      resolveDir: here("../../dist"),
      loader: "js",
    },
    bundle: true,
    minify: true,
    format: "esm",
    write: false,
    platform: "browser",
    alias: { "virtual:astro-tanstack-query/config": here(config) },
    external: ["astro:actions"],
    // What Vite's client build replaces, as in .size-limit.js.
    define: {
      "process.env.NODE_ENV": '"production"',
      "import.meta.env.DEV": "false",
      "import.meta.env.SSR": "false",
    },
  });
  return result.outputFiles[0]?.text ?? "";
}

/**
 * `source` built the way a consumer's Astro 7 build does it: Vite's own `build()` (Rolldown,
 * minified) with the integration's real virtual-config plugin, so `browserBuild` comes from what
 * Vite tells the plugin rather than from a fixture. The esbuild `bundle()` above cannot see the
 * flag's saving at all, because esbuild keeps the branches behind a constant it imports.
 */
async function viteBundle(source: string, { ssr = false } = {}): Promise<string> {
  const entry = "\0treeshake-entry";
  const result = await viteBuild({
    configFile: false,
    logLevel: "silent",
    root: here("../../dist"),
    plugins: [
      {
        name: "treeshake-entry",
        resolveId: (id) => (id === "treeshake-entry" ? entry : undefined),
        load: (id) => (id === entry ? source : undefined),
      },
      virtualConfigPlugin(resolveOptions({}), new URL("../../", import.meta.url)),
    ],
    // The generated module imports the serializer by package name; weigh this checkout's build.
    resolve: {
      alias: { "astro-tanstack-query/serializer/json": here("../../dist/serializer/json.js") },
    },
    build: {
      ssr,
      write: false,
      minify: true,
      // For the parser-readiness top-level await, which every browser Astro supports can run.
      target: "esnext",
      // Otherwise Vite adds its preload polyfill to the chunk being weighed.
      modulePreload: false,
      rolldownOptions: { input: "treeshake-entry", external: ["astro:actions"] },
    },
  });
  return (Array.isArray(result) ? result : [result])
    .flatMap((output) => ("output" in output ? output.output : []))
    .map((chunk) => (chunk.type === "chunk" ? chunk.code : ""))
    .join("\n");
}

const gzipBytes = (code: string) => gzipSync(code, { level: 9 }).length;

it("the query entry carries no htmx, devtools, devalue or async_hooks code", async () => {
  const code = await bundle(
    'import { createQuery } from "./query/index.js"; console.log(createQuery);',
  );
  // The import specifier "async_hooks" is the real proof that no node: module reached the browser.
  // "AsyncLocalStorage" joins it now that the define strips observer-store's dev-only warning, the
  // one place the API name appeared, as message text.
  for (const marker of [
    "defineExtension",
    "TanstackQueryDevtools",
    "devalue",
    "async_hooks",
    "AsyncLocalStorage",
  ]) {
    expect(code).not.toContain(marker);
  }
});

it("createQuery alone does not pull the infinite or mutation observers", async () => {
  // Weighing one combined bundle cannot answer this: if createQuery regressed into dragging in
  // only the infinite wrapper, the combined gap would fall from 4,282 B to 2,329 B and still
  // clear a 2 kB floor. So weigh each half on its own, and pin each half with a string marker.
  //
  // Markers taken from query-core's internals cannot answer it either. "getNextPageParam" and
  // "mutationFn" live in infiniteQueryBehavior and the Mutation class, which QueryClient reaches
  // by itself — it constructs a MutationCache, and its prefetchInfiniteQuery references
  // infiniteQueryBehavior — so both are in the query-only bundle however
  // little this package imports. Markers unique to *this package's* wrappers do work: the
  // mutation store's own error text, and the fetchNextPage/hasNextPage that only
  // InfiniteQueryObserver's result carries.
  //
  // Measured today (`bundle()` above: esbuild, minified, production defines; string length):
  //   createQuery alone                       36,698 B
  //   createQuery + createInfiniteQuery       38,651 B  → infinite wrapper 1,953 B
  //   createQuery + createMutation            39,027 B  → mutation wrapper 2,329 B
  //   all three                               40,980 B  → 4,282 B together
  // A genuine regression collapses a half's gap to roughly nothing, so a 1 kB floor catches it
  // while leaving both halves room to shrink as query-core moves.
  const wrapperFloorBytes = 1_000;
  const entry = (...names: string[]) =>
    `import { ${names.join(", ")} } from "./query/index.js"; console.log(${names.join(", ")});`;

  const [queryOnly, plusInfinite, plusMutation] = await Promise.all([
    bundle(entry("createQuery")),
    bundle(entry("createQuery", "createInfiniteQuery")),
    bundle(entry("createQuery", "createMutation")),
  ]);

  // Each marker is asserted both ways: absent without the wrapper proves the tree-shake, present
  // with it proves the marker still tracks the wrapper rather than having been renamed away.
  for (const marker of ["fetchNextPage", "hasNextPage"]) {
    expect(queryOnly).not.toContain(marker);
    expect(plusInfinite).toContain(marker);
  }
  const mutationMarker = "mutations never run during SSR";
  expect(queryOnly).not.toContain(mutationMarker);
  expect(plusMutation).toContain(mutationMarker);

  expect(plusInfinite.length - queryOnly.length).toBeGreaterThan(wrapperFloorBytes);
  expect(plusMutation.length - queryOnly.length).toBeGreaterThan(wrapperFloorBytes);
});

it("createQuery alone does not pull the activity stores", async () => {
  // The bare names cannot be markers: QueryClient defines isFetching() and isMutating() as methods,
  // so both are in every bundle. Nothing the other stores reach calls them, so the call sites the
  // activity stores add can. Measured (`bundle()` above, gzip level 9): createQuery alone
  // 11,355 B, + createIsFetching 11,418 B, + createIsMutating 11,419 B, + both 11,434 B.
  const entry = (...names: string[]) =>
    `import { ${names.join(", ")} } from "./query/index.js"; console.log(${names.join(", ")});`;
  const [queryOnly, plusFetching, plusMutating] = await Promise.all([
    bundle(entry("createQuery")),
    bundle(entry("createQuery", "createIsFetching")),
    bundle(entry("createQuery", "createIsMutating")),
  ]);
  // Asserted both ways, like the markers above.
  expect(queryOnly).not.toContain(".isFetching(");
  expect(plusFetching).toContain(".isFetching(");
  expect(queryOnly).not.toContain(".isMutating(");
  expect(plusMutating).toContain(".isMutating(");
});

it("Vite's client build drops every server branch, and its SSR build keeps them", async () => {
  // The guard on `(!browserBuild && isServer())`: move that check into a helper function and
  // neither bundler inlines it, so the server branches come back and these markers with them.
  // Measured with `viteBundle()` (Vite 8.3, gzip level 9), before the flag and after it:
  //   createQuery                          11,009 B → 10,714 B
  //   all stores (as the size-limit row)   11,922 B → 11,565 B
  // against 11,309 B and 12,260 B from size-limit's esbuild, which is the upper bound the budgets
  // in docs/design.md section 7 are enforced with.
  const entry = (...names: string[]) =>
    `import { ${names.join(", ")} } from ${JSON.stringify(here("../../dist/query/index.js"))}; console.log(${names.join(", ")});`;
  const allStores = [
    "createQuery",
    "createInfiniteQuery",
    "createMutation",
    "createIsFetching",
    "createIsMutating",
  ];
  // `astro build` runs Vite with NODE_ENV=production. Vitest has set "test", which Vite would
  // define into the bundle, keeping query-core's development-only code in what is weighed.
  vi.stubEnv("NODE_ENV", "production");
  const [queryOnly, everyStore, server] = await Promise.all([
    viteBundle(entry("createQuery")),
    viteBundle(entry(...allStores)),
    viteBundle(entry("createQuery"), { ssr: true }),
  ]).finally(() => vi.unstubAllEnvs());

  for (const code of [queryOnly, everyStore]) {
    // The request scope's global key, and the two errors only the server path throws.
    for (const marker of [
      "__astroTanstackQueryScope",
      "server-client-outside-request",
      "browser-only",
    ]) {
      expect(code).not.toContain(marker);
    }
    // The browser path is still there: the parser-readiness wait, View Transitions hydration and
    // the serializer check. An empty bundle would pass the assertions above for free.
    for (const marker of ["readystatechange", "astro:before-swap", "serializer-mismatch"]) {
      expect(code).toContain(marker);
    }
  }
  // The SSR build is handed `ssr: true`, so the flag is false and the runtime check survives.
  expect(server).toContain("__astroTanstackQueryScope");
  expect(server).toContain("server-client-outside-request");

  // The budgets hold in the pipeline a visitor's download actually comes from, too.
  expect(gzipBytes(queryOnly)).toBeLessThan(12_000);
  expect(gzipBytes(everyStore)).toBeLessThan(13_500);
}, 30_000);

it("a devalue-configured browser bundle carries parse but not stringify", async () => {
  // The serializer is split into a reader (browser, hydration) and a writer (server, emission)
  // precisely so this holds: a property cannot be shaken off a live object, so the single
  // serializer object this replaced forced devalue's stringify into every browser bundle at a
  // cost of ~2.3 kB gzip (3,964 B for the whole module against 1,694 B for the reader, as
  // .size-limit.js measures them). Guarding it here rather than only in `npm run size` means
  // re-fusing the two halves fails `npm test`, where someone is actually looking.
  const code = await bundle(
    'import { createQuery } from "./query/index.js"; console.log(createQuery);',
    "./virtual-config-devalue.ts",
  );

  // devalue's stringify is the only half that can throw on a function, so this string is present
  // if and only if the writer was pulled in. Asserted both ways: the reader's own parse-side
  // error text must still be there, or an empty bundle would pass the first assertion for free.
  expect(code).not.toContain("Cannot stringify");
  expect(code).toContain("Invalid input");
});
