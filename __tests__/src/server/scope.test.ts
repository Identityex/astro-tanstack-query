import { QueryClient } from "@tanstack/query-core";
import { expect, it } from "vitest";
import { requestScope, type RequestScope } from "../../../src/query/scope-reader";
import { currentScope, runInScope } from "../../../src/server/scope";

const scopeFor = (user: string): RequestScope => ({
  queryClient: new QueryClient(),
  url: new URL(`http://x/?user=${user}`),
});

it("is undefined outside a scope", () => {
  expect(currentScope()).toBeUndefined();
});

it("is visible through the isomorphic reader inside the scope, across awaits", async () => {
  const scope = scopeFor("alice");
  await runInScope(scope, async () => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(currentScope()).toBe(scope);
    expect(requestScope()).toBe(scope);
  });
});

it("isolates concurrent scopes", async () => {
  const seen = await Promise.all(
    ["alice", "bob", "carol"].map((user) =>
      runInScope(scopeFor(user), async () => {
        await new Promise((resolve) => setTimeout(resolve, Math.random() * 10));
        return currentScope()?.url.searchParams.get("user");
      }),
    ),
  );
  expect(seen).toEqual(["alice", "bob", "carol"]);
});
