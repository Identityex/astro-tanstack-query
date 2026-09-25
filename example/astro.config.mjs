import node from "@astrojs/node";
import react from "@astrojs/react";
import solid from "@astrojs/solid-js";
import svelte from "@astrojs/svelte";
import vue from "@astrojs/vue";
import tanstackQuery from "astro-tanstack-query";
import { defineConfig } from "astro/config";

export default defineConfig({
  output: "server",
  // The e2e suite builds this app twice — once with the defaults and once with the devalue +
  // emit:"component" variant — and Playwright serves both at the same time. They must not share
  // an output directory, or the second build silently overwrites the first and every default-build
  // assertion tests the variant instead.
  outDir: process.env.ASTRO_TQ_OUT ?? "dist",
  adapter: node({ mode: "standalone" }),
  integrations: [
    react({ include: ["**/islands/react/**"] }),
    solid({ include: ["**/islands/solid/**"] }),
    svelte(),
    vue(),
    tanstackQuery({
      devtools: true,
      serializer: process.env.ASTRO_TQ_SERIALIZER ?? "json",
      emit: process.env.ASTRO_TQ_EMIT ?? "middleware",
    }),
  ],
});
