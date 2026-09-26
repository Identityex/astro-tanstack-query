import type { DefaultOptions } from "@tanstack/query-core";
import type { settings as generated } from "virtual:astro-tanstack-query/config";
import { reader, writer } from "../../src/serializer/json";

export const defaultOptions: DefaultOptions = {};
export const stateReader = reader;
export const stateWriter = writer;
// Typed by the module's own declaration (TypeScript does not see the test alias), so this cannot
// drift from what the plugin generates. `origin` is absent, as it is while `ssr.origin` is unset.
export const settings: typeof generated = { emit: "middleware", ssrStaleTime: 60_000 };
