import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import type { ResolvedOptions } from "./options";

export const VIRTUAL_ID = "virtual:astro-tanstack-query/config";
const RESOLVED_ID = "\0" + VIRTUAL_ID;

export interface VirtualConfigPluginOptions {
  /**
   * Fixes `browserBuild` instead of reading it from the environment Vite loads the module for.
   * The testing plugin passes `false`: Vitest loads a DOM-environment test file as client code,
   * yet such a test may still remove `window` to reach the server path.
   */
  browserBuild?: boolean;
}

/**
 * The one place configuration crosses from astro.config into runtime code, as static imports so
 * the unused serializer never reaches the browser and the user's `defaultOptions` (functions and
 * all) reach both clients without serialisation.
 */
export function virtualConfigPlugin(
  options: ResolvedOptions,
  root: URL,
  { browserBuild }: VirtualConfigPluginOptions = {},
): Plugin {
  // fileURLToPath hands back backslashes on Windows, and this path goes straight into an import
  // specifier, where a backslash is an escape character rather than a separator. Forward slashes
  // resolve on every platform, so normalise before the string is quoted.
  const userModule = options.config
    ? JSON.stringify(fileURLToPath(new URL(options.config, root)).replace(/\\/g, "/"))
    : null;
  return {
    name: "astro-tanstack-query:config",
    resolveId(id) {
      return id === VIRTUAL_ID ? RESOLVED_ID : undefined;
    },
    load(id, opts) {
      if (id !== RESOLVED_ID) return undefined;
      return [
        // A constant the client build folds: every `(!browserBuild && isServer())` check becomes
        // false there, and the server branches behind it, with requestScope(), drop out of the
        // browser bundle (D15). True only when Vite says it is loading for the client. SSR,
        // prerender and a caller that passes no options get false, which keeps the runtime check.
        `export const browserBuild = ${browserBuild ?? opts?.ssr === false};`,
        userModule ? `import * as user from ${userModule};` : "const user = {};",
        // Both halves under distinct names, so an importer that names only the reader leaves the
        // writer — and, for devalue, its `stringify` — out of the browser bundle entirely.
        `export { reader as stateReader, writer as stateWriter } from "astro-tanstack-query/serializer/${options.serializer}";`,
        "export const defaultOptions = user.defaultOptions ?? {};",
        // The page client reads ssrStaleTime from this object too, so every key here reaches the
        // browser bundle. An unset origin is undefined, which JSON.stringify leaves out.
        `export const settings = ${JSON.stringify({ emit: options.emit, ssrStaleTime: options.ssr.staleTime, origin: options.ssr.origin ?? undefined })};`,
      ].join("\n");
    },
  };
}
