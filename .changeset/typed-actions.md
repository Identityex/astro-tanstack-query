---
"astro-tanstack-query": minor
---

The Action helpers are now typed against Astro's own `ActionClient`, and a new `actionQueryOptions` gives an Action query as options.

- `actionMutation`'s `error` is the Action's `ActionError<TInput>`, the same type calling the Action directly gives. After `error && isInputError(error)`, `error.fields` has the schema's keys, so a typo such as `fields.txet` no longer compiles. The `error &&` guard is needed because TanStack's no-error value is `null`, which sends `isInputError()` to its untyped overload. `ActionErrorOf<typeof actions.addTodo>` names the type.
- `actionQuery(actions.listTodos)` no longer needs a trailing `undefined` for an Action that takes no input. An Action whose input is required still requires it.
- `select` can change an Action query's data type: `actionQuery(actions.listTodos, undefined, { select: (todos) => todos.length })` is a `number` store.
- `actionQueryOptions(action, input, options)` returns the options `actionQuery` builds, with a typed `queryKey`. Pass them to `family`, to a store of options, or to the query client's `fetchQuery` and `getQueryData`, which then infer the Action's output.

An Action query's `error` stays `ActionError | Error`, because its fetch can fail with any error, so its `fields` are not typed by the schema.

**Breaking (types only):** the helpers accept only an Astro Action (an `ActionClient`), not a look-alike with an `orThrow` method, and `actionMutation`'s error type narrows from `ActionError` to `ActionError<TInput>`. The runtime is unchanged.
