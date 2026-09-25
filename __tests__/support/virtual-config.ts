import type { DefaultOptions } from "@tanstack/query-core";
import { reader, writer } from "../../src/serializer/json";

export const defaultOptions: DefaultOptions = {};
export const stateReader = reader;
export const stateWriter = writer;
export const settings = { emit: "middleware" as const, ssrStaleTime: 60_000 };
