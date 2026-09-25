// @vitest-environment happy-dom
import { atom } from "nanostores";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { pageClient, resetPageClientForTests } from "../../../src/query/client";
import { createQuery } from "../../../src/query/store";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});
afterEach(() => {
  resetPageClientForTests();
  vi.useRealTimers();
});

it("fetches once for many subscribers and shares the result", async () => {
  const queryFn = vi.fn(async () => "hello");
  const $a = createQuery({ queryKey: ["thing"], queryFn });
  const $b = createQuery({ queryKey: ["thing"], queryFn });
  const seen: unknown[] = [];
  $a.subscribe((r) => seen.push(r.data));
  $b.subscribe((r) => seen.push(r.data));
  await vi.waitFor(() => expect($b.get().data).toBe("hello"));
  expect(queryFn).toHaveBeenCalledTimes(1);
  expect($a.get().data).toBe("hello");
});

it("get() on an unmounted store starts the fetch", async () => {
  const queryFn = vi.fn(async () => 1);
  const $n = createQuery({ queryKey: ["n"], queryFn });
  expect($n.get().isPending).toBe(true);
  await vi.waitFor(() => expect($n.get().data).toBe(1));
});

it("detaches the observer after the last subscriber leaves (after nanostores' delay)", async () => {
  const $x = createQuery({ queryKey: ["x"], queryFn: async () => "x" });
  const stop = $x.subscribe(() => {});
  await vi.waitFor(() => expect($x.get().data).toBe("x"));
  const query = pageClient()
    .getQueryCache()
    .find({ queryKey: ["x"] });
  expect(query?.getObserversCount()).toBe(1);
  stop();
  await vi.advanceTimersByTimeAsync(1100);
  expect(query?.getObserversCount()).toBe(0);
});

it("only notifies for props a consumer actually read (tracked queries)", async () => {
  const $t = createQuery({ queryKey: ["t"], queryFn: async () => "same", staleTime: 0 });
  const notifications = vi.fn();
  $t.subscribe((r) => {
    notifications(r.data); // reads only `data`
  });
  await vi.waitFor(() => expect($t.get().data).toBe("same"));
  const before = notifications.mock.calls.length;
  await $t.refetch(); // data is structurally equal → `data` reference unchanged; only isFetching flips
  await flush();
  expect(notifications.mock.calls.length).toBe(before);
});

it("gives a later subscriber the current status when earlier readers track only data", async () => {
  const queryKey = ["late-status-reader"];
  pageClient().setQueryData(queryKey, "same");
  let finish: ((value: string) => void) | undefined;
  const $query = createQuery({
    queryKey,
    staleTime: 60_000,
    queryFn: () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  });
  const dataSeen: (string | undefined)[] = [];
  const stopData = $query.subscribe((result) => dataSeen.push(result.data));
  const refetch = $query.refetch();
  let stopStatus = () => {};

  try {
    expect(pageClient().getQueryState(queryKey)?.fetchStatus).toBe("fetching");
    await vi.advanceTimersByTimeAsync(0);
    expect(dataSeen).toEqual(["same"]);

    const fetchingSeen: boolean[] = [];
    stopStatus = $query.subscribe((result) => fetchingSeen.push(result.isFetching));
    expect(fetchingSeen).toEqual([true]);

    finish?.("same");
    await refetch;
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchingSeen).toEqual([true, false]);
  } finally {
    finish?.("same");
    await refetch;
    stopStatus();
    stopData();
  }
});

it("keeps snapshots stable while exposing cache writes before their batched notification", async () => {
  const $query = createQuery({
    queryKey: ["stable-snapshot"],
    queryFn: async () => ({ value: 1 }),
    initialData: { value: 1 },
    staleTime: 60_000,
  });
  const stop = $query.subscribe((result) => void result.data);

  try {
    const initial = $query.get();
    expect($query.get()).toBe(initial);

    $query.setData({ value: 2 });
    const updated = $query.get();
    expect(updated.data).toEqual({ value: 2 });
    expect(updated).not.toBe(initial);
    expect($query.get()).toBe(updated);

    await vi.advanceTimersByTimeAsync(0);
    expect($query.get()).toBe(updated);
  } finally {
    stop();
  }
});

it("notifies on every change when notifyOnChangeProps is 'all'", async () => {
  const $t = createQuery({
    queryKey: ["t2"],
    queryFn: async () => "same",
    notifyOnChangeProps: "all",
  });
  const notifications = vi.fn();
  $t.subscribe((r) => notifications(r.data));
  await vi.waitFor(() => expect($t.get().data).toBe("same"));
  const before = notifications.mock.calls.length;
  await $t.refetch();
  await flush();
  expect(notifications.mock.calls.length).toBeGreaterThan(before);
});

it("follows an options store", async () => {
  const $options = atom({ queryKey: ["user", 1] as unknown[], queryFn: async () => "user-1" });
  const $u = createQuery($options);
  $u.subscribe(() => {});
  await vi.waitFor(() => expect($u.get().data).toBe("user-1"));
  $options.set({ queryKey: ["user", 2], queryFn: async () => "user-2" });
  await vi.waitFor(() => expect($u.get().data).toBe("user-2"));
  expect($u.key).toBe('["user",2]');
});

// The observer follows the options store only while mounted, so refetch() has to bring it up to
// date itself or it fetches the key the store had when it last had a listener.
it("refetch() on a never-mounted store fetches the options store's current key", async () => {
  const $options = atom({ queryKey: ["user", 1] as unknown[], queryFn: async () => "user-1" });
  const $u = createQuery($options);
  // The first refetch is what creates the observer, with key 1.
  expect((await $u.refetch()).data).toBe("user-1");
  $options.set({ queryKey: ["user", 2], queryFn: async () => "user-2" });
  expect($u.key).toBe('["user",2]');
  expect((await $u.refetch()).data).toBe("user-2");
});

it("refetch() after the store unmounted fetches the options store's current key", async () => {
  const $options = atom({ queryKey: ["member", 1] as unknown[], queryFn: async () => "member-1" });
  const $u = createQuery($options);
  const stop = $u.subscribe(() => {});
  await vi.waitFor(() => expect($u.get().data).toBe("member-1"));
  stop();
  await vi.advanceTimersByTimeAsync(1100);
  $options.set({ queryKey: ["member", 2], queryFn: async () => "member-2" });
  expect((await $u.refetch()).data).toBe("member-2");
});

it("forwards refetch() options to the observer", async () => {
  const $broken = createQuery({
    queryKey: ["broken-refetch"],
    queryFn: async (): Promise<string> => {
      throw new Error("down");
    },
    retry: false,
  });
  expect((await $broken.refetch()).error?.message).toBe("down");
  await expect($broken.refetch({ throwOnError: true })).rejects.toThrow("down");
});

it("forwards invalidate() options to the query client", async () => {
  let fail = false;
  const $flaky = createQuery({
    queryKey: ["broken-invalidate"],
    queryFn: async () => {
      if (fail) throw new Error("down");
      return "up";
    },
    retry: false,
    staleTime: 60_000,
  });
  const stop = $flaky.subscribe(() => {});
  try {
    await vi.waitFor(() => expect($flaky.get().data).toBe("up"));
    fail = true;
    await expect($flaky.invalidate()).resolves.toBeUndefined();
    await expect($flaky.invalidate({ throwOnError: true })).rejects.toThrow("down");
  } finally {
    stop();
  }
});

it("exposes prefetch, invalidate, setData and refetch on the page client", async () => {
  const queryFn = vi.fn(async () => "v1");
  // staleTime is what keeps this test from racing its own refetch, and it is written out here to
  // pin the value the test depends on rather than inherit one. The page client defaults queries
  // to settings.ssrStaleTime, which the harness (test/virtual-config.ts) currently sets to this
  // same 60_000 — a default that has already moved once, and an inherited 0 would break the test
  // silently: the get() below mounts the store, QueryObserver.onSubscribe sees data that is
  // already stale, starts a refetch, and that in-flight fetch lands *after* setData and
  // overwrites "manual" with the queryFn's "v1". Fresh data means no refetch on mount, which
  // leaves setData the only writer until invalidate deliberately asks for one.
  const $v = createQuery({ queryKey: ["v"], queryFn, staleTime: 60_000 });
  await $v.prefetch();
  expect($v.get().data).toBe("v1");
  expect($v.setData(() => "manual")).toBe("manual");
  // Notifications remain batched even though direct reads see the current cache immediately.
  await flush();
  expect($v.get().data).toBe("manual");
  $v.subscribe(() => {});
  // prefetch was call 1 and mounting did not refetch at this staleTime, so the refetch
  // invalidate triggers for the now-active query is call 2.
  await $v.invalidate();
  await vi.waitFor(() => expect(queryFn).toHaveBeenCalledTimes(2));
  const result = await $v.refetch();
  expect(result.data).toBe("v1");
});
