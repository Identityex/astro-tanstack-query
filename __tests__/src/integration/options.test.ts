import { expect, it } from "vitest";
import { resolveOptions } from "../../../src/integration/options";

it("applies defaults", () => {
  expect(resolveOptions({})).toEqual({
    config: null,
    serializer: "json",
    emit: "middleware",
    ssr: { staleTime: 60_000 },
    devtools: false,
  });
});

it("rejects unknown serializers and negative staleTime", () => {
  expect(() => resolveOptions({ serializer: "yaml" as never })).toThrowError(/serializer/);
  expect(() => resolveOptions({ ssr: { staleTime: -1 } })).toThrowError(/staleTime/);
});
