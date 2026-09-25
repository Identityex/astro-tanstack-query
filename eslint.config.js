import eslint from "@eslint/js";
import prettier from "eslint-config-prettier";
import oxlint from "eslint-plugin-oxlint";
import { fileURLToPath } from "node:url";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    // The example app is an Astro project and a Playwright fixture, not library source: its
    // `astro:*` virtual modules only resolve inside an Astro build, so type-aware linting here
    // reports phantom unsafe-any errors. It is checked by `astro check` in its own build instead.
    ignores: ["**/dist/**", "**/dist-variant/**", "**/example/**", "**/node_modules/**"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    // Test doubles are deliberately trivial. A fake queryFn is `async () => "v1"` with nothing to
    // await, and an `expect(...)` arrow body is a void expression on purpose; both rules fire on
    // correct test code here, so they are noise rather than signal.
    files: ["**/*.test.ts", "**/*.test-d.ts", "**/*.check.ts", "__tests__/**/*.ts"],
    rules: {
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-return": "off",
      // Passing a spy like `htmx.swap` to an assertion reads it unbound on purpose.
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: ["**/*.js", "**/*.mjs"],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      ...tseslint.configs.disableTypeChecked.languageOptions,
      globals: { URL: "readonly", process: "readonly", console: "readonly" },
    },
  },
  prettier,
  // Oxlint owns the syntax checks it enables; type-aware ESLint rules stay on.
  {
    files: ["**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}"],
    ignores: ["**/*.astro/**", "**/*.svelte/**", "**/*.vue/**"],
    extends: oxlint
      .buildFromOxlintConfigFile(fileURLToPath(new URL("./.oxlintrc.json", import.meta.url)))
      .filter((config) => config.rules),
  },
);
