export function getActionPath(action: { name?: string }): string {
  return `/_actions/${action.name ?? "anonymous"}`;
}

export class ActionError extends Error {
  code: string;
  constructor({ code, message }: { code: string; message?: string }) {
    super(message);
    this.code = code;
  }
}
