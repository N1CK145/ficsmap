/**
 * Finding the save (spec §7 step 1). Chromium: the save folder is chosen once with the File System
 * Access API and its handle kept in IndexedDB, so later imports list the saves directly. Elsewhere
 * the dialog uses a file input, and SAVE_FOLDER_HINT can be pasted into the Windows file dialog.
 */

export const SAVE_FOLDER_HINT = '%LOCALAPPDATA%\\FactoryGame\\Saved\\SaveGames';

export interface SaveFileEntry { name: string; session: string; modified: number; file: File }

// The parts of the File System Access API used here; TypeScript's DOM lib lacks the permission calls.
type Permission = 'granted' | 'denied' | 'prompt';
interface PermissionHandle {
  queryPermission(d: { mode: 'read' }): Promise<Permission>;
  requestPermission(d: { mode: 'read' }): Promise<Permission>;
}
type Entry = { kind: 'file'; name: string; getFile(): Promise<File> } | DirHandle;
interface DirHandle { kind: 'directory'; name: string; values(): AsyncIterable<Entry> }
type PickerWindow = Window & { showDirectoryPicker(o: { id: string; mode: 'read' }): Promise<FileSystemDirectoryHandle> };

const DB_NAME = 'ficsmap';
const STORE = 'handles';
const KEY = 'saveDir';

export function supportsFolderPicker(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

/** "Home Base_021126-222410.sav" → "Home Base"; also strips "_autosave_<n>". Other names keep everything but ".sav". */
export function sessionFromFileName(name: string): string {
  return name.replace(/\.sav$/i, '').replace(/_(?:autosave_\d+|\d{6}-\d{6})$/i, '');
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

type StoredDir = FileSystemDirectoryHandle & PermissionHandle;
/** The folder chosen in this page session, for when IndexedDB is not available (private mode). */
let chosenThisSession: StoredDir | undefined;

async function storedFolder(): Promise<StoredDir | undefined> {
  try {
    return (await withStore<StoredDir | undefined>('readonly', s => s.get(KEY))) ?? chosenThisSession;
  } catch {
    return chosenThisSession;
  }
}

/** The .sav files in `dir` and in its direct subfolders (one per account id), newest first. */
export async function listSaves(dir: FileSystemDirectoryHandle): Promise<SaveFileEntry[]> {
  const out: SaveFileEntry[] = [];
  const collect = async (d: DirHandle, depth: number) => {
    for await (const e of d.values()) {
      if (e.kind === 'directory') {
        if (depth === 0) await collect(e, 1);
      } else if (/\.sav$/i.test(e.name)) {
        const file = await e.getFile();
        out.push({ name: e.name, session: sessionFromFileName(e.name), modified: file.lastModified, file });
      }
    }
  };
  await collect(dir as unknown as DirHandle, 0);
  return out.sort((a, b) => b.modified - a.modified);
}

/**
 * The saves in the stored folder; 'no-folder' when none is stored (or it cannot be read any more),
 * 'needs-permission' when the browser wants the user to allow access again (grantSaveFolderAccess).
 */
export async function listSavesFromStoredFolder(): Promise<SaveFileEntry[] | 'needs-permission' | 'no-folder'> {
  const dir = await storedFolder();
  if (!dir) return 'no-folder';
  try {
    if ((await dir.queryPermission({ mode: 'read' })) !== 'granted') return 'needs-permission';
    return await listSaves(dir);
  } catch {
    return 'no-folder';
  }
}

/** Asks for read access to the stored folder again; must run in a click handler (user gesture). */
export async function grantSaveFolderAccess(): Promise<boolean> {
  const dir = await storedFolder();
  if (!dir) return false;
  try {
    return (await dir.requestPermission({ mode: 'read' })) === 'granted';
  } catch {
    return false;
  }
}

/** Lets the user pick the save folder and stores it. A cancelled picker changes nothing. */
export async function chooseSaveFolder(): Promise<void> {
  let dir: FileSystemDirectoryHandle;
  try {
    dir = await (window as unknown as PickerWindow).showDirectoryPicker({ id: 'ficsmap-saves', mode: 'read' });
  } catch {
    return; // AbortError when the user cancels; nothing else to do either way.
  }
  chosenThisSession = dir as StoredDir;
  try {
    await withStore('readwrite', s => s.put(dir, KEY));
  } catch {
    // No IndexedDB (private mode): the folder is only remembered until the page reloads.
  }
}
