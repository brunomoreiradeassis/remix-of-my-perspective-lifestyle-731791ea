/**
 * IndexedDB wrapper to persist FileSystemHandle objects and project history.
 */
const DB_NAME = "builder-ai-db";
const SETTINGS_STORE = "settings";
const HANDLES_STORE = "handles";
const PATHS_STORE = "paths";
const CURRENT_DIR_KEY = "working-directory-handle";

export async function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 3); // Version 3 for paths store
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE);
      }
      if (!db.objectStoreNames.contains(HANDLES_STORE)) {
        db.createObjectStore(HANDLES_STORE);
      }
      if (!db.objectStoreNames.contains(PATHS_STORE)) {
        db.createObjectStore(PATHS_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Saves the current working directory handle and also adds it to history.
 */
export async function saveDirectoryHandle(handle: FileSystemDirectoryHandle, projectPath?: string) {
  const db = await openDB();
  
  // Save as current
  const currentTx = db.transaction(SETTINGS_STORE, "readwrite");
  currentTx.objectStore(SETTINGS_STORE).put(handle, CURRENT_DIR_KEY);
  
  // Save to history (using name as key)
  const historyTx = db.transaction(HANDLES_STORE, "readwrite");
  historyTx.objectStore(HANDLES_STORE).put(handle, handle.name);
  
  // Save path if provided
  if (projectPath) {
    const pathTx = db.transaction(PATHS_STORE, "readwrite");
    pathTx.objectStore(PATHS_STORE).put(projectPath, handle.name);
  }
  
  return new Promise<void>((resolve, reject) => {
    historyTx.oncomplete = () => resolve();
    historyTx.onerror = () => reject(historyTx.error);
  });
}

/**
 * Gets the last opened directory handle.
 */
export async function getDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(SETTINGS_STORE, "readonly");
    const store = transaction.objectStore(SETTINGS_STORE);
    const request = store.get(CURRENT_DIR_KEY);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Gets all saved directory handles for the "Recent Projects" list.
 */
export async function getAllDirectoryHandles(): Promise<Array<{ name: string; handle: FileSystemDirectoryHandle; path?: string }>> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([HANDLES_STORE, PATHS_STORE], "readonly");
    const store = transaction.objectStore(HANDLES_STORE);
    const pathStore = transaction.objectStore(PATHS_STORE);
    const request = store.getAll();
    const keysRequest = store.getAllKeys();
    
    request.onsuccess = () => {
      const handles = request.result as FileSystemDirectoryHandle[];
      keysRequest.onsuccess = () => {
        const names = keysRequest.result as string[];
        // Also fetch paths
        const pathPromises = names.map(name => {
          return new Promise<string | undefined>((res) => {
            const pathReq = pathStore.get(name);
            pathReq.onsuccess = () => res(pathReq.result as string | undefined);
            pathReq.onerror = () => res(undefined);
          });
        });
        Promise.all(pathPromises).then(paths => {
          const result = handles.map((handle, i) => ({
            name: names[i],
            handle,
            path: paths[i]
          }));
          resolve(result);
        });
      };
    };
    request.onerror = () => reject(request.error);
  });
}

/**
 * Removes a directory from the history.
 */
export async function removeDirectoryHandle(name: string) {
  const db = await openDB();
  const transaction = db.transaction(HANDLES_STORE, "readwrite");
  transaction.objectStore(HANDLES_STORE).delete(name);
  return new Promise<void>((resolve) => {
    transaction.oncomplete = () => resolve();
  });
}

export async function clearDirectoryHandle() {
  const db = await openDB();
  const transaction = db.transaction(SETTINGS_STORE, "readwrite");
  transaction.objectStore(SETTINGS_STORE).delete(CURRENT_DIR_KEY);
  return new Promise<void>((resolve) => {
    transaction.oncomplete = () => resolve();
  });
}
