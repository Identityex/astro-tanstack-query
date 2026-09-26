import { isInputError, type ActionClient, type ActionError } from "astro:actions";
import type { z } from "astro/zod";
import { expectTypeOf, it } from "vitest";
import {
  actionMutation,
  actionQuery,
  actionQueryOptions,
  isActionError,
} from "../../../src/actions/index";
import { getQueryClient } from "../../../src/query/client";
import { family } from "../../../src/query/family";

// Only the types are under test: these bodies are never called, so no query client is needed.
// The two Actions are typed as `defineAction()` types them: `addTodo` takes
// `z.object({ text: z.string() })` and returns the new count, `listTodos` takes no input.
declare const actions: {
  addTodo: ActionClient<number, undefined, z.ZodObject<{ text: z.ZodString }>> & string;
  listTodos: ActionClient<string[], undefined, undefined> & string;
};

it("types an action mutation's input error fields with the Action's schema", () => {
  const error = actionMutation(actions.addTodo).get().error;
  // A transport failure (offline, a dropped connection) rejects orThrow() with a plain Error.
  expectTypeOf(error).toEqualTypeOf<ActionError<{ text: string }> | Error | null>();
  if (isActionError(error) && isInputError(error)) {
    expectTypeOf(error.fields).toEqualTypeOf<{ text?: string[] | undefined }>();
    // @ts-expect-error: `txet` is not a field of the Action's schema.
    void error.fields.txet;
  }
});

it("types an action mutation's variables with the Action's input", () => {
  const $add = actionMutation(actions.addTodo);
  expectTypeOf($add.mutateAsync).parameter(0).toEqualTypeOf<{ text: string }>();
  expectTypeOf($add.mutateAsync({ text: "milk" })).resolves.toEqualTypeOf<number>();
  // @ts-expect-error: the schema's key is `text`.
  void $add.mutate({ txet: "milk" });
});

it("leaves an action query's error untyped by schema, since it may be any thrown error", () => {
  const error = actionQuery(actions.addTodo, { text: "milk" }).get().error;
  expectTypeOf(error).toEqualTypeOf<ActionError<{ text: string }> | Error | null>();
});

it("lets select change an action query's data type", () => {
  const $count = actionQuery(actions.listTodos, undefined, { select: (todos) => todos.length });
  expectTypeOf($count.get().data).toEqualTypeOf<number | undefined>();
});

it("takes no input only when the Action accepts none", () => {
  expectTypeOf(actionQuery(actions.listTodos).get().data).toEqualTypeOf<string[] | undefined>();
  // @ts-expect-error: addTodo's input is required.
  void actionQuery(actions.addTodo);
  // @ts-expect-error: addTodo's input is required.
  void actionQueryOptions(actions.addTodo);
  // @ts-expect-error: the schema's key is `text`.
  void actionQuery(actions.addTodo, { txet: "milk" });
});

it("composes action query options with family and the query client", () => {
  const $todo = family((text: string) => actionQueryOptions(actions.addTodo, { text }));
  expectTypeOf($todo("milk").get().data).toEqualTypeOf<number | undefined>();
  const cached = getQueryClient().getQueryData(actionQueryOptions(actions.listTodos).queryKey);
  expectTypeOf(cached).toEqualTypeOf<string[] | undefined>();
});

it("accepts only an Astro Action", () => {
  // @ts-expect-error: a plain async function has no `orThrow`, so it is not an ActionClient.
  void actionQuery(async (n: number) => n, 1);
});

// An error boundary or Suspense belongs to a framework adapter (D2); the store never throws.
it("rejects throwOnError and suspense on action stores", () => {
  // @ts-expect-error: an action mutation's error is its result's `error`, not a throw.
  void actionMutation(actions.addTodo, { throwOnError: true });
  // @ts-expect-error: an action query's error is its result's `error`, not a throw.
  void actionQuery(actions.addTodo, { text: "milk" }, { throwOnError: true });
  // @ts-expect-error: nothing suspends; the option would only change refetching on a key change.
  void actionQuery(actions.listTodos, undefined, { suspense: true });
});
