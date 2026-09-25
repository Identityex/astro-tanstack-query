import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  root: here("./"),
  cacheDir: here("./node_modules/.vite"),
  resolve: {
    alias: {
      "virtual:astro-tanstack-query/config": here("./__tests__/support/virtual-config.ts"),
      "astro:actions": here("./__tests__/support/stubs/astro-actions.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["__tests__/support/**/*.check.ts"],
  },
});
