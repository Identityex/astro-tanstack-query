import type { AstroIntegration } from "astro";
import { resolveOptions, type TanstackQueryOptions } from "./integration/options";
import { injectedTypes } from "./integration/types";
import { virtualConfigPlugin } from "./integration/virtual-config";

export type { TanstackQueryOptions } from "./integration/options";

export default function tanstackQuery(userOptions: TanstackQueryOptions = {}): AstroIntegration {
  const options = resolveOptions(userOptions);
  return {
    name: "astro-tanstack-query",
    hooks: {
      "astro:config:setup": ({
        addMiddleware,
        updateConfig,
        addDevToolbarApp,
        command,
        config,
      }) => {
        addMiddleware({ entrypoint: "astro-tanstack-query/middleware", order: "pre" });
        updateConfig({
          vite: {
            plugins: [virtualConfigPlugin(options, config.root)],
            // Insurance against two copies of the cache in pnpm/monorepo layouts (§5).
            resolve: { dedupe: ["@tanstack/query-core", "nanostores"] },
            // Our runtime imports virtual and astro: modules, so Vite must process it, not externalise it.
            ssr: { noExternal: ["astro-tanstack-query"] },
            optimizeDeps: { exclude: ["astro-tanstack-query"] },
          },
        });
        if (options.devtools && command === "dev") {
          addDevToolbarApp({
            id: "astro-tanstack-query",
            name: "TanStack Query",
            icon: "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2'><circle cx='12' cy='12' r='9'/><path d='M12 7v5l3 3'/></svg>",
            entrypoint: "astro-tanstack-query/devtools/toolbar",
          });
        }
      },
      "astro:config:done": ({ injectTypes }) => {
        injectTypes({ filename: "types.d.ts", content: injectedTypes });
      },
    },
  };
}
