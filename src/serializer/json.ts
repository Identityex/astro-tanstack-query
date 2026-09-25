import type { DehydratedState } from "@tanstack/query-core";
import type { StateReader, StateWriter } from "./types";

const REPLACEMENTS: Record<string, string> = {
  "<": "\\u003c",
  ">": "\\u003e",
  "&": "\\u0026",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
};

/**
 * Makes JSON text safe to embed inside a `<script>` element: a string value
 * containing `</script>` or `<!--` can otherwise end the element early.
 * Every replacement is a valid JSON escape, so `JSON.parse` is unchanged.
 */
export function escapeForScript(text: string): string {
  return text.replace(/[<>&\u2028\u2029]/g, (char) => REPLACEMENTS[char] ?? char);
}

/** The two halves carry the same `name` on purpose: it is the wire tag both sides compare. */
export const reader: StateReader = {
  name: "json",
  parse: (text) => JSON.parse(text) as DehydratedState,
};

export const writer: StateWriter = {
  name: "json",
  stringify: (state) => escapeForScript(JSON.stringify(state)),
};
