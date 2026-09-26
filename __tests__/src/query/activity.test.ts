// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createIsFetching, createIsMutating } from "../../../src/query/activity";
import { pageClient, resetPageClientForTests } from "../../../src/query/client";
import { createMutation } from "../../../src/query/mutation";
import { createQuery } from "../../../src/query/store";

// The count is read when query-core's batched notification runs, not when the cache event fires,
// so every fetch and mutation here is held open until the test settles it: one that settled
// before the tick would read 0 → 0 and never show the 1.
function deferred<T>() {
  let settle: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

// query-core schedules its batched notifications with setTimeout(0).
const tick = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  resetPageClientForTests();
  vi.useRealTimers();
});

it("counts a query store's fetch 0 → 1 → 0, on query-core's notification tick", async () => {
  const response = deferred<string>();
  const $thing = createQuery({ queryKey: ["thing"], queryFn: () => response.promise });
  const $fetching = createIsFetching();
  const $other = createIsFetching({ queryKey: ["other"] });
  const seen: number[] = [];
  const stop = $fetching.subscribe((count) => seen.push(count));
  const stopOther = $other.subscribe(() => {});
  expect(seen).toEqual([0]);

  const stopThing = $thing.subscribe(() => {});
  expect(pageClient().isFetching()).toBe(1);
  expect(seen).toEqual([0]);
  await tick();
  expect(seen).toEqual([0, 1]);
  expect($other.get()).toBe(0);

  response.settle("x");
  await tick();
  expect(seen).toEqual([0, 1, 0]);
  stopThing();
  stopOther();
  stop();
});

it("counts a pending mutation 0 → 1 → 0", async () => {
  const response = deferred<number>();
  const $save = createMutation({ mutationKey: ["save"], mutationFn: () => response.promise });
  const $mutating = createIsMutating();
  const $other = createIsMutating({ mutationKey: ["other"] });
  const seen: number[] = [];
  const stop = $mutating.subscribe((count) => seen.push(count));
  const stopOther = $other.subscribe(() => {});

  const saved = $save.mutateAsync();
  expect(seen).toEqual([0]);
  await tick();
  expect(seen).toEqual([0, 1]);
  expect($other.get()).toBe(0);

  response.settle(1);
  await saved;
  await tick();
  expect(seen).toEqual([0, 1, 0]);
  stopOther();
  stop();
});

it("reads the current count without a subscriber", async () => {
  const response = deferred<string>();
  void pageClient().prefetchQuery({ queryKey: ["thing"], queryFn: () => response.promise });
  expect(createIsFetching().get()).toBe(1);
  response.settle("x");
  await tick();
});

it("stops listening to the cache after nanostores' unmount delay", async () => {
  const stop = createIsFetching().subscribe(() => {});
  expect(pageClient().getQueryCache().hasListeners()).toBe(true);
  stop();
  await vi.advanceTimersByTimeAsync(1100);
  expect(pageClient().getQueryCache().hasListeners()).toBe(false);
});
