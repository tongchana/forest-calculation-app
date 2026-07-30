/**
 * Keeps a workspace alive while Next.js swaps route components.  This is
 * deliberately in-memory: uploaded workbooks and calculation output are not
 * written to browser storage and are discarded when the tab is closed.
 */
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
