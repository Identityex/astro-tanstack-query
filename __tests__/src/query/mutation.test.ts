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

// MutationObserver fires per-call callbacks only while it has listeners, and a store used only for
// its methods (an Astro <script>, an htmx handler, an island that renders just a button) has none.
it("fires per-call onSuccess and onSettled on a store nothing subscribes to", async () => {
  const $double = createMutation({ mutationFn: async (n: number) => n * 2 });
  const onSuccess = vi.fn();
  const onSettled = vi.fn();
  $double.mutate(21, { onSuccess, onSettled });
  await vi.waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));
  expect(onSuccess).toHaveBeenCalledTimes(1);
  expect(onSuccess.mock.calls[0]?.[0]).toBe(42);
});

it("fires per-call onError and onSettled on a store nothing subscribes to", async () => {
  const $fail = createMutation({
    mutationFn: async () => {
      throw new Error("boom");
    },
    retry: false,
  });
  const onError = vi.fn();
  const onSettled = vi.fn();
  $fail.mutate(undefined, { onError, onSettled });
  await vi.waitFor(() => expect(onSettled).toHaveBeenCalledTimes(1));
  expect(onError).toHaveBeenCalledTimes(1);
  expect(onError.mock.calls[0]?.[0]).toMatchObject({ message: "boom" });
});

it("fires per-call callbacks for mutateAsync on a store nothing subscribes to", async () => {
  const $double = createMutation({ mutationFn: async (n: number) => n * 2 });
  const onSuccess = vi.fn();
  await expect($double.mutateAsync(1, { onSuccess })).resolves.toBe(2);
  expect(onSuccess).toHaveBeenCalledTimes(1);
});
