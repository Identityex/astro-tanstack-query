import { QueryClient, dehydrate } from "@tanstack/query-core";
import { expect, it } from "vitest";
import { reader, writer } from "../../../src/serializer/devalue";

it("round-trips Dates, Maps and undefined, and stays script-safe", async () => {
  const client = new QueryClient();
  const data = {
    when: new Date(0),
    tags: new Map([["a", 1]]),
    missing: undefined,
    html: "</script>",
  };
  await client.prefetchQuery({ queryKey: ["rich"], queryFn: async () => data });
  const text = writer.stringify(dehydrate(client));
  expect(text).not.toContain("</script>");
  const state = reader.parse(text);
  const restored = state.queries[0]?.state.data as typeof data;
  expect(restored.when).toBeInstanceOf(Date);
  expect(restored.tags.get("a")).toBe(1);
  expect("missing" in restored).toBe(true);
  expect(reader.name).toBe("devalue");
  expect(writer.name).toBe("devalue");
});
