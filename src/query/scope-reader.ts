import type { QueryClient } from "@tanstack/query-core";
import type { APIContext } from "astro";

/** Where the server middleware publishes its AsyncLocalStorage (D15: no node: import here). */
export const SCOPE_KEY = "__astroTanstackQueryScope";

export interface RequestScope {
  queryClient: QueryClient;
  url: URL;
  callAction?: APIContext["callAction"];
  /**
   * Astro's `context.isPrerendered`: the route's `prerender` flag, true for a prerendered route in
   * `astro dev` and `astro build` alike, which under `output: "static"` is every route. Only in the
   * build is `url` the build's origin rather than a visitor's request; code that needs that case
   * checks `isPrerendered && !import.meta.env.DEV`.
   */
  isPrerendered?: boolean;
}

interface ScopeHolder {
  getStore(): RequestScope | undefined;
}

export function isServer(): boolean {
  return typeof window === "undefined";
}

/** The current request's scope on the server; always undefined in the browser. */
export function requestScope(): RequestScope | undefined {
  if (!isServer()) return undefined;
  const holder = (globalThis as Record<string, unknown>)[SCOPE_KEY] as ScopeHolder | undefined;
  return holder?.getStore();
}
