import { AsyncLocalStorage } from "node:async_hooks";
import { SCOPE_KEY, type RequestScope } from "../query/scope-reader";

const storage = new AsyncLocalStorage<RequestScope>();

// Published so the isomorphic store module can read the scope without a node: import (D15).
(globalThis as Record<string, unknown>)[SCOPE_KEY] = storage;

export function runInScope<T>(scope: RequestScope, fn: () => T): T {
  return storage.run(scope, fn);
}

/** This request's scope, or undefined outside one. Exported from `astro-tanstack-query/server`. */
export function currentScope(): RequestScope | undefined {
  return storage.getStore();
}
