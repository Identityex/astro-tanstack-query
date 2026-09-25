// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { resetPageClientForTests } from "../../../src/query/client";
import { createMutation } from "../../../src/query/mutation";

afterEach(() => resetPageClientForTests());

it("runs a mutation and exposes its state", async () => {
  const mutationFn = vi.fn(async (n: number) => n * 2);
  const $double = createMutation({ mutationFn });
  $double.subscribe(() => {});
  expect($double.get().isIdle).toBe(true);
  await expect($double.mutateAsync(2)).resolves.toBe(4);
  await vi.waitFor(() => expect($double.get().data).toBe(4));
  $double.reset();
  await vi.waitFor(() => expect($double.get().isIdle).toBe(true));
});

it("mutate() swallows the rejection and stores the error", async () => {
  const $fail = createMutation({
    mutationFn: async () => {
      throw new Error("boom");
    },
    retry: false,
  });
  $fail.subscribe(() => {});
  $fail.mutate(undefined);
  await vi.waitFor(() => expect($fail.get().error?.message).toBe("boom"));
});
