import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

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
    define: { "process.env.NODE_ENV": '"production"' },
  });
  return result.outputFiles[0]?.text ?? "";
}

it("the query entry carries no htmx, devtools, devalue or async_hooks code", async () => {
  const code = await bundle(
    'import { createQuery } from "./query/index.js"; console.log(createQuery);',
  );
  // "AsyncLocalStorage" is deliberately not a marker: the API name survives only inside the
  // dev warning string in observer-store.ts, as message text rather than as code. The import
  // specifier "async_hooks" is the real proof that no node: module reached the browser.
  for (const marker of ["defineExtension", "TanstackQueryDevtools", "devalue", "async_hooks"]) {
    expect(code).not.toContain(marker);
  }
});

it("createQuery alone does not pull the infinite or mutation observers", async () => {
  // Weighing one combined bundle cannot answer this: if createQuery regressed into dragging in
  // only the infinite wrapper, the combined gap would fall from 3,856 B to 2,244 B and still
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
  // Measured today (esbuild, minified, NODE_ENV=production):
  //   createQuery alone                       36,295 B
  //   createQuery + createInfiniteQuery       37,907 B  → infinite wrapper 1,612 B
  //   createQuery + createMutation            38,539 B  → mutation wrapper 2,244 B
  //   all three                               40,151 B  → 3,856 B together
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

it("a devalue-configured browser bundle carries parse but not stringify", async () => {
  // The serializer is split into a reader (browser, hydration) and a writer (server, emission)
  // precisely so this holds: a property cannot be shaken off a live object, so the single
  // serializer object this replaced forced devalue's stringify into every browser bundle at a
  // cost of ~1.7 kB gzip. Guarding it here rather than only in `npm run size` means re-fusing the
  // two halves fails `npm test`, where someone is actually looking.
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
