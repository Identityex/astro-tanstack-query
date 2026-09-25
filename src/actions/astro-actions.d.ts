declare module "astro:actions" {
  export function getActionPath(action: { orThrow: (input: never) => Promise<unknown> }): string;
  export class ActionError extends Error {
    code: string;
    status: number;
  }
}
