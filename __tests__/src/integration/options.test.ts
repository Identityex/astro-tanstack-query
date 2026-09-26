import { expect, it } from "vitest";
import { resolveOptions } from "../../../src/integration/options";

it("applies defaults", () => {
  expect(resolveOptions({})).toEqual({
    config: null,
    serializer: "json",
    emit: "middleware",
    ssr: { staleTime: 60_000, origin: null },
    devtools: false,
  });
});

it("rejects unknown serializers and negative staleTime", () => {
  expect(() => resolveOptions({ serializer: "yaml" as never })).toThrowError(/serializer/);
  expect(() => resolveOptions({ ssr: { staleTime: -1 } })).toThrowError(/staleTime/);
});

it("keeps only the origin of ssr.origin", () => {
  expect(resolveOptions({ ssr: { origin: "https://example.com/" } }).ssr.origin).toBe(
    "https://example.com",
  );
  // The request's own path is kept, so a path here could only mislead; it is dropped.
  expect(resolveOptions({ ssr: { origin: "http://127.0.0.1:4321/blog?x=1" } }).ssr.origin).toBe(
    "http://127.0.0.1:4321",
  );
});

it.each(["example.com", "/relative", "ftp://example.com", "", 4321 as never])(
  "rejects ssr.origin %j",
  (origin) => {
    expect(() => resolveOptions({ ssr: { origin } })).toThrowError(
      expect.objectContaining({
        kind: "invalid-options",
        message: expect.stringMatching(/ssr\.origin/),
      }),
    );
  },
);
