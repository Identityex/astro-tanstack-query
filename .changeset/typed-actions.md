---
"astro-tanstack-query": minor
---

The Action helpers are now typed against Astro's own `ActionClient`, and a new `actionQueryOptions` gives an Action query as options.

- `actionMutation`'s `error` is the Action's `ActionError<TInput>`, the same type calling the Action directly gives, or a transport error: a plain `Error` when the request itself fails (offline, a dropped connection), because `.orThrow()` fetches and a failed fetch never becomes an `ActionError`. The new `isActionError(error)` narrows to the Action's own error and keeps its input type, so after `isActionError(error) && isInputError(error)`, `error.fields` has the schema's keys and a typo such as `fields.txet` no longer compiles. Astro's own `isActionError` narrows to an untyped `ActionError`, and `isInputError()` alone takes its untyped overload on the union. `ActionErrorOf<typeof actions.addTodo>` names the Action's own error type.
- `actionQuery(actions.listTodos)` no longer needs a trailing `undefined` for an Action that takes no input. An Action whose input is required still requires it.
- `select` can change an Action query's data type: `actionQuery(actions.listTodos, undefined, { select: (todos) => todos.length })` is a `number` store.
- `actionQueryOptions(action, input, options)` returns the options `actionQuery` builds, with a typed `queryKey`. Pass them to `family`, to a store of options, or to the query client's `fetchQuery` and `getQueryData`, which then infer the Action's output.

An Action query's `error` has the same type, `ActionError<TInput> | Error`, and `isActionError(error) && isInputError(error)` types its `fields` the same way.

**Breaking (types only):** the helpers accept only an Astro Action (an `ActionClient`), not a look-alike with an `orThrow` method, and `actionMutation`'s error type changes from `ActionError` to `ActionError<TInput> | Error`, so `error.code` needs `isActionError(error)` first. The runtime is unchanged.
