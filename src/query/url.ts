import { TanstackQueryAstroError } from "./errors";
import { isServer, requestScope } from "./scope-reader";

/** A queryFn that fetches a relative path works in the browser and fails during server prefetch. This fixes it. */
export function absoluteUrl(path: string): string {
  if (!isServer()) return new URL(path, window.location.href).href;
  const scope = requestScope();
  if (!scope) {
    throw new TanstackQueryAstroError(
      "server-client-outside-request",
      "absoluteUrl() needs a request on the server.",
    );
  }
  return new URL(path, scope.url).href;
}
