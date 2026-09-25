import { expect, it } from "vitest";
import { TanstackQueryAstroError } from "../../../src/query/errors";

it("carries a kind and a prefixed message", () => {
  const error = new TanstackQueryAstroError("browser-only", "nope");
  expect(error).toBeInstanceOf(Error);
  expect(error.kind).toBe("browser-only");
  expect(error.name).toBe("TanstackQueryAstroError");
  expect(error.message).toBe("[astro-tanstack-query] nope");
});
