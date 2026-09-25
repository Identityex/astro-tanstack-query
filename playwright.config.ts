import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./__tests__/e2e",
  use: { baseURL: "http://127.0.0.1:4331" },
  webServer: [
    {
      command: "npm --prefix example run start",
      url: "http://127.0.0.1:4331/",
      env: { PORT: "4331", HOST: "127.0.0.1" },
      reuseExistingServer: false,
    },
    {
      // Built into its own directory: sharing example/dist with the server above let this build
      // overwrite it, so every test on 4331 silently ran against the variant.
      command:
        "ASTRO_TQ_OUT=dist-variant ASTRO_TQ_SERIALIZER=devalue ASTRO_TQ_EMIT=component npm --prefix example run build && ASTRO_TQ_OUT=dist-variant PORT=4332 npm --prefix example run start",
      url: "http://127.0.0.1:4332/",
      env: { HOST: "127.0.0.1" },
      reuseExistingServer: false,
    },
  ],
});
