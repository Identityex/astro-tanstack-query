import { ActionError, defineAction } from "astro:actions";
import { z } from "astro:schema";

const todos: string[] = [];

export const server = {
  listTodos: defineAction({ handler: async () => [...todos] }),
  addTodo: defineAction({
    input: z.object({ text: z.string().min(1) }),
    handler: async ({ text }) => {
      if (text === "boom") throw new ActionError({ code: "BAD_REQUEST", message: "no booms" });
      todos.push(text);
      return todos.length;
    },
  }),
};
