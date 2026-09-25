import type { DehydratedState } from "@tanstack/query-core";
import { parse, stringify } from "devalue";
import { escapeForScript } from "./json";
import type { StateReader, StateWriter } from "./types";

/**
 * Opt-in (D9): Dates, Maps, Sets, undefined and BigInt survive hydration, for devalue's `parse`
 * on the client. `parse` and `stringify` are each referenced by exactly one of these objects —
 * no shared helper touches both — which is what lets a browser importing only `reader` leave
 * `stringify` behind. The repeated `name` costs a few bytes and buys that separation.
 */
export const reader: StateReader = {
  name: "devalue",
  parse: (text) => parse(text) as DehydratedState,
};

export const writer: StateWriter = {
  name: "devalue",
  stringify: (state) => escapeForScript(stringify(state)),
};
