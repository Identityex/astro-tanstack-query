import type { DehydratedState } from "@tanstack/query-core";
import { describe, expect, it } from "vitest";
import { escapeForScript, reader, writer } from "../../../src/serializer/json";

describe("escapeForScript", () => {
  it("escapes the characters that can break out of a script element", () => {
    expect(escapeForScript('"</script><!--&\u2028\u2029"')).toBe(
      '"\\u003c/script\\u003e\\u003c!--\\u0026\\u2028\\u2029"',
    );
  });
});

describe("the json serializer", () => {
  const state: DehydratedState = {
    mutations: [],
    queries: [
      {
        queryKey: ["thing", "</script>"],
        queryHash: '["thing","</script>"]',
        dehydratedAt: 1,
        state: {
          data: { html: "<b>&</b>" },
          dataUpdateCount: 1,
          dataUpdatedAt: 1,
          error: null,
          errorUpdateCount: 0,
          errorUpdatedAt: 0,
          fetchFailureCount: 0,
          fetchFailureReason: null,
          fetchMeta: null,
          isInvalidated: false,
          status: "success",
          fetchStatus: "idle",
        },
      },
    ],
  };

  it("is named json on both halves, which is what data-serializer is matched on", () => {
    expect(reader.name).toBe("json");
    expect(writer.name).toBe("json");
  });

  it("round-trips dehydrated state from the writer to the reader", () => {
    expect(reader.parse(writer.stringify(state))).toEqual(state);
  });

  it("never emits a raw < in its output", () => {
    expect(writer.stringify(state)).not.toContain("<");
  });
});
