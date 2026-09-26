import type { DefaultOptions } from "@tanstack/query-core";
import type { settings as generated } from "virtual:astro-tanstack-query/config";
import { reader, writer } from "../../src/serializer/devalue";

// The devalue-wired twin of ./virtual-config.ts. It exists so the tree-shaking suite can bundle a
// browser entry against `serializer: "devalue"` and prove the server-only half never arrives —
// the whole point of splitting the serializer into a reader and a writer.
export const defaultOptions: DefaultOptions = {};
export const stateReader = reader;
export const stateWriter = writer;
// Typed by the module's declaration, as in ./virtual-config.ts.
export const settings: typeof generated = { emit: "middleware", ssrStaleTime: 60_000 };
