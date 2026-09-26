// Server checks here are written inline, `(!browserBuild && isServer())`, so a client build folds
// them to false and drops the branches behind them. Keep them inline; a helper function defeats
// the fold: neither esbuild nor Rolldown inlines it.
import { browserBuild } from "virtual:astro-tanstack-query/config";
import { TanstackQueryAstroError } from "./errors";
import { isServer, requestScope } from "./scope-reader";

/** A queryFn that fetches a relative path works in the browser and fails during server prefetch. This fixes it. */
export function absoluteUrl(path: string): string {
  if (!(!browserBuild && isServer())) return new URL(path, window.location.href).href;
  const scope = requestScope();
  if (!scope) {
    throw new TanstackQueryAstroError(
      "server-client-outside-request",
      "absoluteUrl() needs a request on the server.",
    );
  }
  return new URL(path, scope.url).href;
}
