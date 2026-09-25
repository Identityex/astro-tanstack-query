import { expectTypeOf, it } from "vitest";
import { createQuery } from "../../../src/query/store";
import { queryOptions } from "../../../src/query/options";

it("infers the data type through queryOptions", () => {
  const options = queryOptions({ queryKey: ["n"], queryFn: async () => 42 });
  const $n = createQuery(options);
  expectTypeOf($n.get().data).toEqualTypeOf<number | undefined>();
});
