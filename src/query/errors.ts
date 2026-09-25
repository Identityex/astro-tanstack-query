export type ErrorKind =
  | "server-client-outside-request"
  | "browser-only"
  | "serializer-mismatch"
  | "invalid-options"
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
