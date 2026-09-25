// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from "vitest";
import { resetPageClientForTests } from "../../../src/query/client";
import { actionMutation, actionQuery } from "../../../src/actions/index";

afterEach(() => resetPageClientForTests());

class FakeActionError extends Error {
  code = "BAD_REQUEST";
  status = 400;
}

function fakeAction<I, O>(name: string, handler: (input: I) => Promise<O>) {
  const call = async (input: I) => {
    try {
      return { data: await handler(input), error: undefined };
    } catch (error) {
      return { data: undefined, error };
    }
  };
  // A function's own `name` is non-writable, so Object.assign() throws on it; getActionPath()
  // reads `name` to build the action path, so it has to be set the only way that works.
  Object.defineProperty(call, "name", { value: name, writable: false, configurable: true });
  return Object.assign(call, { orThrow: (input: I) => handler(input) });
}

it("actionMutation resolves data and types errors", async () => {
  const add = fakeAction("add", async (n: number) => {
    if (n < 0) throw new FakeActionError("negative");
    return n + 1;
  });
  const $add = actionMutation(add);
  $add.subscribe(() => {});
  await expect($add.mutateAsync(1)).resolves.toBe(2);
  await expect($add.mutateAsync(-1)).rejects.toBeInstanceOf(FakeActionError);
  await vi.waitFor(() => expect($add.get().error).toBeInstanceOf(FakeActionError));
});

it("actionQuery keys by action path and input and fetches through orThrow", async () => {
  const list = fakeAction("list", async (input: { page: number }) => [`item-${input.page}`]);
  const $list = actionQuery(list, { page: 2 });
  expect($list.key).toBe('["action","/_actions/list",{"page":2}]');
  $list.subscribe(() => {});
  await vi.waitFor(() => expect($list.get().data).toEqual(["item-2"]));
});
