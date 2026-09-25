import type { DefaultOptions } from "@tanstack/query-core";
import { reader, writer } from "../../src/serializer/devalue";

// The devalue-wired twin of ./virtual-config.ts. It exists so the tree-shaking suite can bundle a
// browser entry against `serializer: "devalue"` and prove the server-only half never arrives —
// the whole point of splitting the serializer into a reader and a writer.
export const defaultOptions: DefaultOptions = {};
export const stateReader = reader;
export const stateWriter = writer;
export const settings = { emit: "middleware" as const, ssrStaleTime: 60_000 };
