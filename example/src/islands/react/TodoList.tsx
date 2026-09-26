import { useStore } from "@nanostores/react";
import { actions } from "astro:actions";
import { actionMutation, actionQuery, isActionError } from "astro-tanstack-query/actions";

const $todos = actionQuery(actions.listTodos);
const $add = actionMutation(actions.addTodo, { onSuccess: () => $todos.invalidate() });

export default function TodoList() {
  const todos = useStore($todos);
  const add = useStore($add);
  return (
    <div>
      <ul data-todos>
        {todos.data?.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      <button onClick={() => $add.mutate({ text: "milk" })}>add milk</button>
      <button onClick={() => $add.mutate({ text: "boom" })}>add boom</button>
      <p data-error>{isActionError(add.error) ? add.error.code : ""}</p>
    </div>
  );
}
