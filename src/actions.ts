import type { BoardElement, Vec } from './types';
import { newId, screenToWorld, translateElement, unionBounds, zoomAt, clamp, MIN_ZOOM } from './geometry';
import { finishEditing, setCamera, setElements, setSelection, toast, useBoard, withAttached } from './store';
import { readImageFile } from './persistence';
import { measureText } from './text';

const get = useBoard.getState;

export const viewportCenter = (): Vec => ({ x: window.innerWidth / 2, y: window.innerHeight / 2 });

export function zoomBy(factor: number, at: Vec = viewportCenter()) {
  const cam = get().camera;
  setCamera(zoomAt(cam, at, cam.z * factor));
}

export function resetZoom() {
  const cam = get().camera;
  setCamera(zoomAt(cam, viewportCenter(), 1));
}

/** Fit all content (or the selection) into the viewport. */
export function zoomToFit() {
  const s = get();
  const ids = new Set(s.selectedIds);
  const els = ids.size ? s.elements.filter((e) => ids.has(e.id)) : s.elements;
  const b = unionBounds(els);
  const vw = window.innerWidth, vh = window.innerHeight;
  if (!b) {
    setCamera({ x: -vw / 2, y: -vh / 2, z: 1 });
    return;
  }
  const margin = 80;
  const z = clamp(Math.min((vw - margin * 2) / Math.max(b.w, 1), (vh - margin * 2) / Math.max(b.h, 1)), MIN_ZOOM, 2);
  setCamera({ x: b.x + b.w / 2 - vw / 2 / z, y: b.y + b.h / 2 - vh / 2 / z, z });
}

// ---- clipboard ----

const CLIP_MARKER = 'whiteboard-clipboard/v1';
let lastPasteOffset = 0;

export function copySelection(event?: ClipboardEvent): boolean {
  const s = get();
  const ids = withAttached(s.elements, s.selectedIds);
  const els = s.elements.filter((e) => ids.has(e.id));
  if (!els.length) return false;
  const payload = JSON.stringify({ type: CLIP_MARKER, elements: els });
  lastPasteOffset = 0;
  if (event?.clipboardData) {
    event.clipboardData.setData('text/plain', payload);
    event.preventDefault();
  } else {
    navigator.clipboard?.writeText(payload).catch(() => undefined);
  }
  return true;
}

export function cutSelection(event?: ClipboardEvent) {
  if (!copySelection(event)) return;
  const ids = withAttached(get().elements, get().selectedIds);
  setElements(get().elements.filter((e) => !ids.has(e.id)));
  setSelection([]);
}

/** Labels attached to another element in the same batch follow it rather than being selected. */
const isFollower = (e: BoardElement, ids: Set<string>) => e.type === 'text' && !!e.attachedTo && ids.has(e.attachedTo);

function insertElements(els: BoardElement[], select = true) {
  setElements([...get().elements, ...els]);
  if (!select) return;
  const ids = new Set(els.map((e) => e.id));
  useBoard.setState({ tool: 'select', selectedIds: els.filter((e) => !isFollower(e, ids)).map((e) => e.id) });
}

/** Copy elements with new ids, keeping label attachments inside the copied set. */
function cloneWithOffset(els: BoardElement[], dx: number, dy: number): BoardElement[] {
  const idMap = new Map(els.map((e) => [e.id, newId()]));
  return els.map((e) => {
    const copy = { ...translateElement(e, dx, dy), id: idMap.get(e.id)! };
    if (copy.type === 'text' && copy.attachedTo) copy.attachedTo = idMap.get(copy.attachedTo);
    return copy;
  });
}

export function duplicateSelected() {
  const s = get();
  const ids = withAttached(s.elements, s.selectedIds);
  const els = s.elements.filter((e) => ids.has(e.id));
  if (!els.length) return;
  const off = 24 / s.camera.z;
  insertElements(cloneWithOffset(els, off, off));
}

/** Center of the visible area in world coords. */
function viewCenterWorld(): Vec {
  return screenToWorld(viewportCenter(), get().camera);
}

export async function addImageFile(file: File, at?: Vec) {
  try {
    const { src, w, h } = await readImageFile(file);
    const cam = get().camera;
    // Fit to at most 60% of the viewport.
    const maxW = (window.innerWidth * 0.6) / cam.z, maxH = (window.innerHeight * 0.6) / cam.z;
    const scale = Math.min(1 / cam.z, maxW / w, maxH / h);
    const iw = w * scale, ih = h * scale;
    const c = at ?? viewCenterWorld();
    insertElements([{ id: newId(), type: 'image', color: '', x: c.x - iw / 2, y: c.y - ih / 2, w: iw, h: ih, src }]);
  } catch (e) {
    console.error(e);
    toast('Could not load that image.');
  }
}

export function addTextAt(text: string, at?: Vec) {
  const s = get();
  const c = at ?? viewCenterWorld();
  const fontSize = s.styles.text.size;
  const m = measureText(text, fontSize, s.textFormat);
  insertElements([
    {
      id: newId(),
      type: 'text',
      color: s.styles.text.color,
      x: c.x - m.w / 2,
      y: c.y - m.h / 2,
      text,
      fontSize,
      ...s.textFormat,
      ...m,
    },
  ]);
}

/** Handle a native paste event: our own elements, images, or plain text. */
export function handlePaste(event: ClipboardEvent) {
  const data = event.clipboardData;
  if (!data) return;
  finishEditing();
  const imageItem = Array.from(data.items).find((i) => i.kind === 'file' && i.type.startsWith('image/'));
  if (imageItem) {
    const file = imageItem.getAsFile();
    if (file) {
      event.preventDefault();
      addImageFile(file);
      return;
    }
  }
  const text = data.getData('text/plain');
  if (!text) return;
  event.preventDefault();
  try {
    const parsed = JSON.parse(text);
    if (parsed?.type === CLIP_MARKER && Array.isArray(parsed.elements)) {
      const els = parsed.elements as BoardElement[];
      const b = unionBounds(els);
      const c = viewCenterWorld();
      if (!b) return;
      // First paste lands in the view center; repeated pastes cascade.
      lastPasteOffset += 1;
      const off = ((lastPasteOffset - 1) * 24) / get().camera.z;
      const visible = isBoxVisible(b);
      const dx = visible ? 24 / get().camera.z + off : c.x - (b.x + b.w / 2) + off;
      const dy = visible ? 24 / get().camera.z + off : c.y - (b.y + b.h / 2) + off;
      insertElements(cloneWithOffset(els, dx, dy));
      return;
    }
  } catch {
    /* plain text */
  }
  addTextAt(text.length > 5000 ? text.slice(0, 5000) : text);
}

function isBoxVisible(b: { x: number; y: number; w: number; h: number }) {
  const cam = get().camera;
  const vw = window.innerWidth / cam.z, vh = window.innerHeight / cam.z;
  return b.x + b.w > cam.x && b.y + b.h > cam.y && b.x < cam.x + vw && b.y < cam.y + vh;
}

export function nudgeSelected(dx: number, dy: number) {
  const s = get();
  const ids = withAttached(s.elements, s.selectedIds);
  if (!ids.size) return;
  setElements(s.elements.map((e) => (ids.has(e.id) ? translateElement(e, dx, dy) : e)));
}

export const selectionBounds = () => {
  const s = get();
  const ids = new Set(s.selectedIds);
  const els = s.elements.filter((e) => ids.has(e.id));
  return els.length ? unionBounds(els) : null;
};
