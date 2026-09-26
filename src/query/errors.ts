export type ErrorKind =
  | "server-client-outside-request"
  | "browser-only"
  | "serializer-mismatch"
  | "invalid-options"
  // The middleware found a global `window` in the server process, where every store would take
  // its browser path and share one page client across requests.
  | "window-on-server"
  // Only `astro-tanstack-query/testing` throws this one: a test helper asked for the side it is
  // not running on. It sits here rather than in that entry so there is one union, not two.
  | "test-environment";

export class TanstackQueryAstroError extends Error {
  readonly kind: ErrorKind;

  constructor(kind: ErrorKind, message: string) {
    super(`[astro-tanstack-query] ${message}`);
    this.name = "TanstackQueryAstroError";
    this.kind = kind;
  }
}
