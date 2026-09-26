// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resetPageClientForTests } from "../../../src/query/client";
import { family } from "../../../src/query/family";

beforeEach(() => vi.useFakeTimers({ shouldAdvanceTime: true }));
afterEach(() => {
  resetPageClientForTests();
  vi.useRealTimers();
});

const userFamily = () =>
  family((id: number) => ({
    queryKey: ["user", id],
    queryFn: async () => `user-${id}`,
  }));
type UserStore = ReturnType<ReturnType<typeof userFamily>>;

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

// prefetch/setData/invalidate/refetch/key never mount a store, so without the creation timer
// such a member would stay in the map for the page client's life (across View Transitions).
it.each<[string, (store: UserStore) => unknown]>([
  ["prefetch()", (store) => store.prefetch()],
  ["setData()", (store) => store.setData("seeded")],
  ["key", (store) => store.key],
])("evicts a member only used through %s about a second after it was created", async (_, use) => {
  const $user = userFamily();
  const a = $user(1);
  await use(a);
  expect($user(1)).toBe(a);
  await vi.advanceTimersByTimeAsync(1100);
  expect($user(1)).not.toBe(a);
});

it("keeps a member subscribed within the delay past its creation timer, then evicts it after unmount", async () => {
  const $user = userFamily();
  const a = $user(1);
  await vi.advanceTimersByTimeAsync(500);
  const stop = a.subscribe(() => {});
  await vi.advanceTimersByTimeAsync(1100);
  expect($user(1)).toBe(a);
  stop();
  await vi.advanceTimersByTimeAsync(500);
  expect($user(1)).toBe(a);
  await vi.advanceTimersByTimeAsync(600);
  expect($user(1)).not.toBe(a);
});

// nanostores clears `lc` as soon as the last listener leaves but unmounts a second later, and a
// listener that returns inside that window does not mount again. Evicting on `!lc` would drop
// this member while it is still live.
it("keeps a member whose creation timer fires inside its unmount delay", async () => {
  const $user = userFamily();
  const a = $user(1);
  const stop = a.subscribe(() => {});
  await vi.advanceTimersByTimeAsync(500);
  stop();
  await vi.advanceTimersByTimeAsync(600);
  expect($user(1)).toBe(a);
  await vi.advanceTimersByTimeAsync(500);
  expect($user(1)).not.toBe(a);
});

it("puts a held member back in the map when it first mounts after being evicted", async () => {
  const $user = userFamily();
  const a = $user(1);
  await vi.advanceTimersByTimeAsync(1100);
  // No `$user(1)` in between: that would mint a replacement, which the late mount must not evict.
  const stop = a.subscribe(() => {});
  expect($user(1)).toBe(a);
  stop();
});
