export function getActionPath(action: { name?: string }): string {
  return `/_actions/${action.name ?? "anonymous"}`;
}
