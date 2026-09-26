/**
 * The test-side twin of the integration, so a consumer's unit tests run against the real store
 * bridge rather than a `vi.mock` of it. A mock factory is not type-checked against the module it
 * replaces: it drifts from the real API, and it drifts in the direction that keeps the test green.
 *
 * Nothing here may reach `virtual:astro-tanstack-query/config` at load time. This module is
 * imported by the consumer's `vitest.config.ts`, and at that moment the plugin that resolves the
 * virtual id is the thing being constructed — which is why resetTestQueryClient() is async.
 */
import { QueryClient } from "@tanstack/query-core";
import { cwd } from "node:process";
import { pathToFileURL } from "node:url";
import type { Plugin } from "vite";
import { resolveOptions, type TanstackQueryOptions } from "../integration/options";
import { virtualConfigPlugin } from "../integration/virtual-config";
import { TanstackQueryAstroError } from "../query/errors";
import { isServer, type RequestScope } from "../query/scope-reader";
import { runInScope } from "../server/scope";

const PACKAGE_NAME = "astro-tanstack-query";

/** Astro's own dev origin, so an unset `url` looks like the one a consumer sees in `npm run dev`. */
const DEFAULT_ORIGIN = "http://localhost:4321/";

export type { RequestScope } from "../query/scope-reader";

/** The integration's options minus `devtools`, which means nothing without a dev server. */
export interface TestQueryConfigOptions extends Omit<TanstackQueryOptions, "devtools"> {
  /** The directory a relative `config` path resolves against. Defaults to the working directory. */
  root?: string | URL;
}

/**
 * Serves `virtual:astro-tanstack-query/config` to Vitest, through the integration's own plugin —
 * so the config a test runs against cannot drift from the config a page runs against.
 *
 * ```ts
 * // vitest.config.ts
 * import { installTestQueryConfig } from "astro-tanstack-query/testing";
 * export default defineConfig({ plugins: [installTestQueryConfig()] });
 * ```
 */
export function installTestQueryConfig(options: TestQueryConfigOptions = {}): Plugin {
  const { root, ...integration } = options;
  return {
    // `browserBuild: false` keeps every store deciding by `window` at run time, as it did before
    // the flag existed: a DOM-environment test file is loaded as client code, and a test in it may
    // still remove `window` to exercise the server path.
    ...virtualConfigPlugin(resolveOptions({ ...integration, devtools: false }), rootUrl(root), {
      browserBuild: false,
    }),
    name: `${PACKAGE_NAME}:test-config`,
    config: () => ({
      // Anything Vitest treats as external is handed to Node's own loader, which has never heard
      // of a `virtual:` specifier — so the package has to be transformed, exactly as the
      // integration arranges for SSR. Dedupe for its reason too (§5): two caches are not one cache.
      ssr: { noExternal: [PACKAGE_NAME] },
      resolve: { dedupe: ["@tanstack/query-core", "nanostores"] },
    }),
  };
}

function rootUrl(root: string | URL | undefined): URL {
  if (root instanceof URL) return root;
  // The trailing slash is what makes `new URL("./src/query.config.ts", root)` land inside the
  // directory rather than beside it.
  return pathToFileURL(`${(root ?? cwd()).replace(/[/\\]+$/, "")}/`);
}

/**
 * Forgets the page client, so the next test starts on an empty cache. Call it in `afterEach`.
 *
 * Async on purpose: the client module reads the virtual config, and this file is loaded by the
 * consumer's Vite config before anything resolves that id. Deferring the import to call time
 * moves it into the test worker, where the plugin above has already answered for it.
 */
export async function resetTestQueryClient(): Promise<void> {
  const { resetPageClientForTests } = await import("../query/client");
  resetPageClientForTests();
}

export interface TestRequestInit {
  /** What `absoluteUrl()` resolves against, as the page's URL would be. */
  url?: string | URL;
  /**
   * The request client. The default never retries, so a rejecting `queryFn` fails the test now
   * rather than after three backoffs.
   */
  queryClient?: QueryClient;
  callAction?: RequestScope["callAction"];
  /**
   * The scope's `isPrerendered`, which the middleware copies from Astro's per-route `prerender`
   * flag: true for a prerendered route in `astro dev` as well as in `astro build`.
   */
  isPrerendered?: boolean;
}

/**
 * Runs `fn` inside a request scope, as the middleware does for a real request — the only door to
 * a server client, because the package exports none by design (D4). This is what a test of
 * frontmatter-shaped code needs: `prefetch()`, `getQueryClient()`, `absoluteUrl()`.
 */
export function runInTestRequest<T>(fn: (scope: RequestScope) => T, init: TestRequestInit = {}): T {
  if (!isServer()) {
    throw new TanstackQueryAstroError(
      "test-environment",
      "runInTestRequest() needs a server-shaped test, but this file has a `window`: every store takes its browser path there and the request scope is ignored. Drop the `@vitest-environment` comment for this file, or use resetTestQueryClient() instead.",
    );
  }
  const scope: RequestScope = {
    queryClient:
      init.queryClient ?? new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    url: init.url instanceof URL ? init.url : new URL(init.url ?? DEFAULT_ORIGIN),
    callAction: init.callAction,
    isPrerendered: init.isPrerendered,
  };
  return runInScope(scope, () => fn(scope));
}
