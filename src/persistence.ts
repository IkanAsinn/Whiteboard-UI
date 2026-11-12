import { del as idbDel, get as idbGet, set as idbSet } from 'idb-keyval';
import type { BoardElement, BoardFile, Camera } from './types';
import { isDirty, loadBoard, markSaved, toast, useBoard } from './store';
import { renderToCanvas } from './render';
import { newId } from './geometry';

/*
 * Everything here runs in the browser. The server only serves static files:
 *  - autosave  -> IndexedDB of this browser (survives reloads/crashes)
 *  - save/open -> a .whiteboard file on the user's disk
 *    (File System Access API on Chromium, download/upload fallback elsewhere)
 */

const AUTOSAVE_KEY = 'whiteboard:autosave:v1';
const HANDLE_KEY = 'whiteboard:file-handle:v1';
export const FILE_EXT = '.whiteboard';

interface AutosaveRecord {
  elements: BoardElement[];
  camera: Camera;
  fileName: string | null;
  dirty: boolean;
  savedAt: number;
}

// ---- File System Access API (Chromium only; not in TS's DOM lib yet) ----

interface FsHandle extends FileSystemFileHandle {
  queryPermission?(opts: { mode: 'readwrite' }): Promise<PermissionState>;
  requestPermission?(opts: { mode: 'readwrite' }): Promise<PermissionState>;
}
interface PickerType {
  description: string;
  accept: Record<string, string[]>;
}
type FsWindow = Window & {
  showSaveFilePicker?(opts: { suggestedName?: string; types?: PickerType[] }): Promise<FsHandle>;
  showOpenFilePicker?(opts: { types?: PickerType[]; multiple?: boolean }): Promise<FsHandle[]>;
};
const fsWindow = window as FsWindow;
export const supportsFileSystemAccess =
  typeof fsWindow.showSaveFilePicker === 'function' && window.isSecureContext;

const BOARD_TYPES: PickerType[] = [{ description: 'Whiteboard file', accept: { 'application/json': [FILE_EXT] } }];

let currentHandle: FsHandle | null = null;

const isAbort = (e: unknown) => e instanceof DOMException && e.name === 'AbortError';

async function ensurePermission(handle: FsHandle): Promise<boolean> {
  const opts = { mode: 'readwrite' as const };
  if (!handle.queryPermission) return true;
  if ((await handle.queryPermission(opts)) === 'granted') return true;
  return (await handle.requestPermission?.(opts)) === 'granted';
}

// ---- serialization ----

const VALID_TYPES = new Set(['stroke', 'rect', 'ellipse', 'polygon', 'line', 'arrow', 'text', 'sticky', 'image']);

export function serializeBoard(): string {
  const { elements, camera } = useBoard.getState();
  const file: BoardFile = { app: 'whiteboard', version: 1, elements, camera };
  return JSON.stringify(file);
}

export function parseBoard(text: string): BoardFile {
  const data = JSON.parse(text) as Partial<BoardFile>;
  if (!data || data.app !== 'whiteboard' || !Array.isArray(data.elements)) {
    throw new Error('This is not a whiteboard file.');
  }
  const elements = data.elements.filter(
    (e): e is BoardElement => !!e && typeof e === 'object' && VALID_TYPES.has((e as BoardElement).type),
  );
  // Re-id duplicates defensively.
  const seen = new Set<string>();
  for (const el of elements) {
    if (typeof el.id !== 'string' || seen.has(el.id)) el.id = newId();
    seen.add(el.id);
  }
  const cam = data.camera;
  const camera =
    cam && Number.isFinite(cam.x) && Number.isFinite(cam.y) && Number.isFinite(cam.z) && cam.z > 0 ? cam : undefined;
  return { app: 'whiteboard', version: 1, elements, camera };
}

const baseName = (name: string) => name.replace(/\.(whiteboard|json)$/i, '');

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- save / open ----

export async function saveBoard(saveAs = false): Promise<void> {
  const state = useBoard.getState();
  const json = serializeBoard();
  const suggested = (state.fileName ?? `whiteboard-${new Date().toISOString().slice(0, 10)}`) + FILE_EXT;

  if (!supportsFileSystemAccess) {
    downloadBlob(new Blob([json], { type: 'application/json' }), suggested);
    markSaved(baseName(suggested));
    toast(`Downloaded ${suggested}`);
    return;
  }

  try {
    let handle = saveAs ? null : currentHandle;
    if (handle && !(await ensurePermission(handle))) handle = null;
    if (!handle) handle = await fsWindow.showSaveFilePicker!({ suggestedName: suggested, types: BOARD_TYPES });
    const writable = await handle.createWritable();
    await writable.write(json);
    await writable.close();
    currentHandle = handle;
    idbSet(HANDLE_KEY, handle).catch(() => undefined);
    markSaved(baseName(handle.name));
    toast(`Saved to ${handle.name}`);
  } catch (e) {
    if (isAbort(e)) return;
    console.error(e);
    toast('Could not save the file.');
  }
}

function applyOpenedFile(text: string, name: string, handle: FsHandle | null) {
  const board = parseBoard(text);
  loadBoard({ elements: board.elements, camera: board.camera, fileName: baseName(name), dirty: false });
  currentHandle = handle;
  if (handle) idbSet(HANDLE_KEY, handle).catch(() => undefined);
  else idbDel(HANDLE_KEY).catch(() => undefined);
  toast(`Opened ${name}`);
}

function confirmDiscard(): boolean {
  return !isDirty(useBoard.getState()) || window.confirm('Your board has unsaved changes. Continue without saving them?');
}

export async function openBoard(): Promise<void> {
  if (!confirmDiscard()) return;
  try {
    if (supportsFileSystemAccess && fsWindow.showOpenFilePicker) {
      const [handle] = await fsWindow.showOpenFilePicker({ types: BOARD_TYPES, multiple: false });
      const file = await handle.getFile();
      applyOpenedFile(await file.text(), file.name, handle);
    } else {
      const file = await pickFile(`${FILE_EXT},application/json`);
      if (file) applyOpenedFile(await file.text(), file.name, null);
    }
  } catch (e) {
    if (isAbort(e)) return;
    console.error(e);
    toast(e instanceof Error ? e.message : 'Could not open the file.');
  }
}

/** Open a board file that was dropped onto the canvas. */
export async function openDroppedFile(file: File, handle: FsHandle | null = null) {
  if (!confirmDiscard()) return;
  try {
    applyOpenedFile(await file.text(), file.name, handle);
  } catch (e) {
    toast(e instanceof Error ? e.message : 'Could not open the file.');
  }
}

export function newBoard() {
  if (!confirmDiscard()) return;
  currentHandle = null;
  idbDel(HANDLE_KEY).catch(() => undefined);
  loadBoard({
    elements: [],
    camera: { x: -window.innerWidth / 2, y: -window.innerHeight / 2, z: 1 },
    fileName: null,
    dirty: false,
  });
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

// ---- export ----

export async function exportPng(onlySelection: boolean) {
  const s = useBoard.getState();
  const ids = new Set(s.selectedIds);
  const els = onlySelection && ids.size ? s.elements.filter((e) => ids.has(e.id)) : s.elements;
  const canvas = await renderToCanvas(els);
  if (!canvas) {
    toast('Nothing to export yet.');
    return;
  }
  canvas.toBlob((blob) => {
    if (!blob) return toast('Export failed.');
    downloadBlob(blob, `${s.fileName ?? 'whiteboard'}.png`);
  }, 'image/png');
}

// ---- images ----

const MAX_IMAGE_SIDE = 2000;

/** Read an image file as a (downscaled) data URL so boards stay reasonably small. */
export async function readImageFile(file: File): Promise<{ src: string; w: number; h: number }> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
    const src = file.type === 'image/jpeg' ? canvas.toDataURL('image/jpeg', 0.9) : canvas.toDataURL('image/png');
    return { src, w, h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---- autosave ----

export async function restoreAutosave(): Promise<boolean> {
  try {
    const rec = await idbGet<AutosaveRecord>(AUTOSAVE_KEY);
    if (!rec || !Array.isArray(rec.elements)) return false;
    loadBoard({ elements: rec.elements, camera: rec.camera, fileName: rec.fileName, dirty: rec.dirty });
    if (rec.fileName) {
      const handle = await idbGet<FsHandle>(HANDLE_KEY).catch(() => undefined);
      if (handle && baseName(handle.name) === rec.fileName) currentHandle = handle;
    }
    return rec.elements.length > 0;
  } catch (e) {
    console.warn('Autosave restore failed', e);
    return false;
  }
}

function writeAutosave() {
  const s = useBoard.getState();
  const rec: AutosaveRecord = {
    elements: s.elements,
    camera: s.camera,
    fileName: s.fileName,
    dirty: isDirty(s),
    savedAt: Date.now(),
  };
  return idbSet(AUTOSAVE_KEY, rec).catch((e) => console.warn('Autosave failed', e));
}

/** Persist the board to IndexedDB shortly after every change. Returns an unsubscribe fn. */
export function startAutosave(delay = 400): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
      writeAutosave();
    }
  };
  const unsub = useBoard.subscribe((s, prev) => {
    if (
      s.elements === prev.elements &&
      s.camera === prev.camera &&
      s.fileName === prev.fileName &&
      s.savedVersion === prev.savedVersion
    )
      return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      writeAutosave();
    }, delay);
  });
  const onHide = () => document.visibilityState === 'hidden' && flush();
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', flush);
  return () => {
    unsub();
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', flush);
  };
}
