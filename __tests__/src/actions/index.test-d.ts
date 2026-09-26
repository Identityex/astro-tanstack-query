import { it } from "vitest";
import { actionMutation, actionQuery } from "../../../src/actions/index";

// Only the types are under test: these bodies are never called, so no query client is needed.
declare const add: ((input: number) => Promise<unknown>) & {
  orThrow: (input: number) => Promise<number>;
};

// An error boundary or Suspense belongs to a framework adapter (D2); the store never throws.
it("rejects throwOnError and suspense on action stores", () => {
  // @ts-expect-error: an action mutation's error is its result's `error`, not a throw.
  void actionMutation(add, { throwOnError: true });
  // @ts-expect-error: an action query's error is its result's `error`, not a throw.
  void actionQuery(add, 1, { throwOnError: true });
  // @ts-expect-error: nothing suspends; the option would only change refetching on a key change.
  void actionQuery(add, 1, { suspense: true });
});
