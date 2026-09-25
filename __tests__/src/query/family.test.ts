// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resetPageClientForTests } from "../../../src/query/client";
import { family } from "../../../src/query/family";

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  resetPageClientForTests();
  vi.useRealTimers();
});

it("returns the same store for the same params while it is in use, and evicts after unmount", async () => {
  const $user = family((id: number) => ({
    queryKey: ["user", id],
    queryFn: async () => `user-${id}`,
  }));
  const a = $user(1);
  expect($user(1)).toBe(a);
  expect($user(2)).not.toBe(a);
  const stop = a.subscribe(() => {});
  await vi.waitFor(() => expect(a.get().data).toBe("user-1"));
  stop();
  await vi.advanceTimersByTimeAsync(1100);
  expect($user(1)).not.toBe(a);
});
