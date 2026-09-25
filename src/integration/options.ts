import { TanstackQueryAstroError } from "../query/errors";

export interface TanstackQueryOptions {
  /** Path (relative to the project root) to a module exporting `defaultOptions` for both clients. */
  config?: string;
  serializer?: "json" | "devalue";
  emit?: "middleware" | "component";
  ssr?: { staleTime?: number };
  devtools?: boolean;
}

export interface ResolvedOptions {
  config: string | null;
  serializer: "json" | "devalue";
  emit: "middleware" | "component";
  ssr: { staleTime: number };
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
    ssr: { staleTime },
    devtools: options.devtools ?? false,
  };
}
