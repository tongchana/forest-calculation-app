/** Keeps uploaded files and results available while the user changes routes in this tab. */
const workspaces = new Map<string, unknown>();

export function readWorkspace<T>(key: string): T | undefined {
  return workspaces.get(key) as T | undefined;
}

export function saveWorkspace<T>(key: string, value: T) {
  workspaces.set(key, value);
}

export function clearWorkspace(key: string) {
  workspaces.delete(key);
}
