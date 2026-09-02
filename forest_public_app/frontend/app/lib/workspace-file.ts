const DB_NAME = "forest-workspace-files";
const STORE_NAME = "files";

export type ProfileEditorTree = {
  id: number;
  species: string;
  x: number;
  y: number;
  height: number;
  firstBranch: number;
  crownXPlus: number;
  crownXMinus: number;
  crownYPlus: number;
  crownYMinus: number;
};

export type ProfileEditorScene = {
  version: 1;
  fileName: string;
  sheets: Array<{ name: string; slug: string; trees: ProfileEditorTree[] }>;
};

const PROFILE_EDITOR_SCENE_KEY = "profile-editor-scene";
const PROFILE_EDITOR_RENDER_KEY = "profile-editor-render";
const PROFILE_EDITOR_SERVER_SCENE_KEY = "profile-editor-server-scene";
const PROFILE_RESULT_KEY = "profile-result";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveWorkspaceFile(key: string, file: File | null) {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(file, key);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

export async function readWorkspaceFile(key: string): Promise<File | null> {
  const database = await openDatabase();
  const value = await new Promise<File | null>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key);
    request.onsuccess = () => resolve(request.result instanceof File ? request.result : null);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return value;
}

export async function saveProfileEditorScene(scene: ProfileEditorScene | null) {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(scene, PROFILE_EDITOR_SCENE_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

export async function readProfileEditorScene(): Promise<ProfileEditorScene | null> {
  const database = await openDatabase();
  const value = await new Promise<ProfileEditorScene | null>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(PROFILE_EDITOR_SCENE_KEY);
    request.onsuccess = () => resolve(request.result?.version === 1 ? request.result as ProfileEditorScene : null);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return value;
}

export type ProfileEditorRender = { sheetName: string; imageDataUrl: string }[];

export async function saveProfileEditorRender(render: ProfileEditorRender | null) {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => { const transaction = database.transaction(STORE_NAME, "readwrite"); transaction.objectStore(STORE_NAME).put(render, PROFILE_EDITOR_RENDER_KEY); transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); });
  database.close();
}

export type ProfileEditorServerScene = {
  sessionId: string;
  fileName: string;
  sheets: Array<{
    name: string;
    slug: string;
    base: string;
    width: number;
    height: number;
    trees: Array<{
      id: number;
      species: string;
      parts: Record<string, { file: string; x: number; y: number; w: number; h: number }>;
    }>;
  }>;
};

export async function saveProfileEditorServerScene(scene: ProfileEditorServerScene | null) {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(scene, PROFILE_EDITOR_SERVER_SCENE_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

export async function readProfileEditorServerScene(): Promise<ProfileEditorServerScene | null> {
  const database = await openDatabase();
  const value = await new Promise<ProfileEditorServerScene | null>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(PROFILE_EDITOR_SERVER_SCENE_KEY);
    request.onsuccess = () => resolve(request.result?.sessionId ? request.result as ProfileEditorServerScene : null);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return value;
}

export async function saveProfileResult<T>(result: T | null) {
  const database = await openDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(result, PROFILE_RESULT_KEY);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
  database.close();
}

export async function readProfileResult<T>(): Promise<T | null> {
  const database = await openDatabase();
  const value = await new Promise<T | null>((resolve, reject) => {
    const request = database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(PROFILE_RESULT_KEY);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });
  database.close();
  return value;
}
