import { TanstackQueryAstroError } from "../query/errors";

export interface TanstackQueryOptions {
  /** Path (relative to the project root) to a module exporting `defaultOptions` for both clients. */
  config?: string;
  serializer?: "json" | "devalue";
  emit?: "middleware" | "component";
  ssr?: {
    staleTime?: number;
    /**
     * The origin `absoluteUrl()` resolves against on the server, in place of the request's own.
     * On `@astrojs/node` the request URL's host is the client's `Host` header, unvalidated, so a
     * forged one points server prefetches at another host. Only the origin is used; the request's
     * path and query are kept. Fixed at build time, and readable in the browser bundle, which
     * shares these settings: set the public origin, not an internal address. No default: taking
     * `site` would send development and preview prefetches to production.
     */
    origin?: string;
  };
  devtools?: boolean;
}

export interface ResolvedOptions {
  config: string | null;
  serializer: "json" | "devalue";
  emit: "middleware" | "component";
  ssr: { staleTime: number; origin: string | null };
  devtools: boolean;
}

export function resolveOptions(options: TanstackQueryOptions): ResolvedOptions {
  const serializer = options.serializer ?? "json";
  if (serializer !== "json" && serializer !== "devalue") {
    throw new TanstackQueryAstroError(
      "invalid-options",
      `serializer must be "json" or "devalue", got "${String(serializer)}".`,
    );
  }
  const emit = options.emit ?? "middleware";
  if (emit !== "middleware" && emit !== "component") {
    throw new TanstackQueryAstroError(
      "invalid-options",
      `emit must be "middleware" or "component", got "${String(emit)}".`,
    );
  }
  const staleTime = options.ssr?.staleTime ?? 60_000;
  if (!Number.isFinite(staleTime) || staleTime < 0) {
    throw new TanstackQueryAstroError(
      "invalid-options",
      `ssr.staleTime must be a non-negative number, got ${String(staleTime)}.`,
    );
  }
  return {
    config: options.config ?? null,
    serializer,
    emit,
    ssr: { staleTime, origin: resolveOrigin(options.ssr?.origin) },
    devtools: options.devtools ?? false,
  };
}

function resolveOrigin(origin: string | undefined): string | null {
  if (origin === undefined) return null;
  const url = URL.canParse(origin) ? new URL(origin) : null;
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) {
    throw new TanstackQueryAstroError(
      "invalid-options",
      `ssr.origin must be an absolute http(s) URL such as "https://example.com", got "${String(origin)}".`,
    );
  }
  return url.origin;
}
