import { defineConfig } from "tsdown";

export default defineConfig({
  entry: {
    integration: "src/integration.ts",
    middleware: "src/middleware.ts",
    "query/index": "src/query/index.ts",
    "actions/index": "src/actions/index.ts",
    "htmx/index": "src/htmx/index.ts",
    "server/index": "src/server/index.ts",
    "testing/index": "src/testing/index.ts",
    "serializer/json": "src/serializer/json.ts",
    "serializer/devalue": "src/serializer/devalue.ts",
    "devtools/client": "src/devtools/client.ts",
    "devtools/toolbar": "src/devtools/toolbar.ts",
  },
  format: ["esm"],
  platform: "neutral",
  dts: true,
  clean: true,
  treeshake: true,
  external: [
    /^astro/,
    /^virtual:/,
    /^node:/,
    "@tanstack/query-core",
    "@tanstack/query-devtools",
    "nanostores",
    "devalue",
    "htmx.org",
    "vite",
  ],
});
