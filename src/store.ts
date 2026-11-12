import { create } from 'zustand';
import type { BoardElement, Camera, TextFormat, Tool } from './types';
import { measureText } from './text';

export type StyleKey = 'pen' | 'highlighter' | 'shape' | 'text' | 'sticky';
export interface ToolStyle {
  color: string;
  size: number;
}

export const PEN_COLORS = ['#1e1e1e', '#e03131', '#f08c00', '#2f9e44', '#1971c2', '#7048e8', '#c2255c', '#ffffff'];
export const HIGHLIGHTER_COLORS = ['#ffe066', '#8ce99a', '#74c0fc', '#faa2c1', '#ffc078', '#d0bfff'];
export const STICKY_COLORS = ['#fff3a8', '#c7f2cf', '#c9e5ff', '#ffd3e6', '#e2d6ff', '#ffdcb8'];

export const SIZES: Record<StyleKey, number[]> = {
  pen: [2, 4, 8, 14],
  highlighter: [12, 20, 32],
  shape: [2, 4, 8],
  text: [16, 24, 36, 56],
  sticky: [],
};

const HISTORY_LIMIT = 200;

export interface Toast {
  id: number;
  message: string;
}

export interface BoardState {
  elements: BoardElement[];
  past: BoardElement[][];
  future: BoardElement[][];
  /** Snapshot taken by `mark()` that the next `commit()` turns into one undo step. */
  pending: BoardElement[] | null;
  selectedIds: string[];
  editingId: string | null;
  camera: Camera;
  tool: Tool;
  styles: Record<StyleKey, ToolStyle>;
  shapeFill: boolean;
  /** Bold / italic / underline for new text and sticky notes. */
  textFormat: TextFormat;
  /** Convert pen strokes that look like shapes into clean shapes. */
  autoShape: boolean;
  showGrid: boolean;
  spaceDown: boolean;
  fileName: string | null;
  /** Bumped on every element change; compared against savedVersion for the dirty flag. */
  docVersion: number;
  savedVersion: number;
  toasts: Toast[];
  helpOpen: boolean;
  libraryOpen: boolean;
}

export const useBoard = create<BoardState>(() => ({
  elements: [],
  past: [],
  future: [],
  pending: null,
  selectedIds: [],
  editingId: null,
  camera: { x: -window.innerWidth / 2, y: -window.innerHeight / 2, z: 1 },
  tool: 'pen',
  styles: {
    pen: { color: PEN_COLORS[0], size: 4 },
    highlighter: { color: HIGHLIGHTER_COLORS[0], size: 20 },
    shape: { color: PEN_COLORS[4], size: 4 },
    text: { color: PEN_COLORS[0], size: 24 },
    sticky: { color: STICKY_COLORS[0], size: 0 },
  },
  shapeFill: false,
  textFormat: {},
  autoShape: true,
  showGrid: true,
  spaceDown: false,
  fileName: null,
  docVersion: 0,
  savedVersion: 0,
  toasts: [],
  helpOpen: false,
  libraryOpen: false,
}));

const get = useBoard.getState;
const set = useBoard.setState;

export const isDirty = (s: BoardState) => s.docVersion !== s.savedVersion;

function sameElements(a: readonly BoardElement[], b: readonly BoardElement[]) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Replace the element list. `record` pushes an undo step (ignored while a mark is open). */
export function setElements(next: BoardElement[], record = true) {
  const s = get();
  if (next === s.elements) return;
  if (record && !s.pending) {
    set({
      elements: next,
      past: [...s.past.slice(-(HISTORY_LIMIT - 1)), s.elements],
      future: [],
      docVersion: s.docVersion + 1,
    });
  } else {
    set({ elements: next, docVersion: s.docVersion + 1 });
  }
}

export function updateElements(fn: (els: BoardElement[]) => BoardElement[], record = true) {
  setElements(fn(get().elements), record);
}

/** Start a multi-step change (drag, erase, text edit) that becomes one undo step. */
export function mark() {
  const s = get();
  if (!s.pending) set({ pending: s.elements });
}

export function commit() {
  const s = get();
  if (!s.pending) return;
  if (sameElements(s.pending, s.elements)) {
    set({ pending: null });
    return;
  }
  set({
    past: [...s.past.slice(-(HISTORY_LIMIT - 1)), s.pending],
    future: [],
    pending: null,
  });
}

function pruneSelection(els: BoardElement[], ids: string[]) {
  const alive = new Set(els.map((e) => e.id));
  return ids.filter((id) => alive.has(id));
}

export function undo() {
  finishEditing();
  commit();
  const s = get();
  if (!s.past.length) return;
  const prev = s.past[s.past.length - 1];
  set({
    elements: prev,
    past: s.past.slice(0, -1),
    future: [s.elements, ...s.future],
    selectedIds: pruneSelection(prev, s.selectedIds),
    docVersion: s.docVersion + 1,
  });
}

export function redo() {
  finishEditing();
  commit();
  const s = get();
  if (!s.future.length) return;
  const next = s.future[0];
  set({
    elements: next,
    past: [...s.past, s.elements],
    future: s.future.slice(1),
    selectedIds: pruneSelection(next, s.selectedIds),
    docVersion: s.docVersion + 1,
  });
}

export function setTool(tool: Tool) {
  finishEditing();
  set({ tool, selectedIds: tool === 'select' ? get().selectedIds : [] });
}

export function setSelection(ids: string[]) {
  set({ selectedIds: ids });
}

export function setCamera(camera: Camera) {
  set({ camera });
}

export function setStyle(key: StyleKey, patch: Partial<ToolStyle>) {
  const s = get();
  set({ styles: { ...s.styles, [key]: { ...s.styles[key], ...patch } } });
}

export function startEditing(id: string) {
  mark();
  set({ editingId: id, selectedIds: [] });
}

/** Leave text editing; empty text elements are removed. Whole edit = one undo step. */
export function finishEditing() {
  const s = get();
  if (!s.editingId) return;
  const el = s.elements.find((e) => e.id === s.editingId);
  set({ editingId: null });
  if (el && el.type === 'text' && !el.text.trim()) {
    setElements(s.elements.filter((e) => e.id !== el.id), false);
  }
  commit();
}

export function updateText(id: string, text: string) {
  updateElements(
    (els) =>
      els.map((e) => {
        if (e.id !== id) return e;
        if (e.type === 'text') {
          const m = measureText(text, e.fontSize, e);
          // Centered text grows from its center.
          const x = e.align === 'center' ? e.x + e.w / 2 - m.w / 2 : e.x;
          return { ...e, text, x, ...m };
        }
        if (e.type === 'sticky') return { ...e, text };
        return e;
      }),
    false,
  );
}

/** `ids` plus the ids of labels attached to any of them. */
export function withAttached(els: readonly BoardElement[], ids: Iterable<string>): Set<string> {
  const set = new Set(ids);
  for (const e of els) if (e.type === 'text' && e.attachedTo && set.has(e.attachedTo)) set.add(e.id);
  return set;
}

export function deleteSelected() {
  const s = get();
  if (!s.selectedIds.length) return;
  const ids = withAttached(s.elements, s.selectedIds);
  setElements(s.elements.filter((e) => !ids.has(e.id)));
  set({ selectedIds: [] });
}

export function selectAll() {
  finishEditing();
  set({ tool: 'select', selectedIds: get().elements.map((e) => e.id) });
}

export function bringToFront() {
  const s = get();
  if (!s.selectedIds.length) return;
  const ids = withAttached(s.elements, s.selectedIds);
  setElements([...s.elements.filter((e) => !ids.has(e.id)), ...s.elements.filter((e) => ids.has(e.id))]);
}

export function sendToBack() {
  const s = get();
  if (!s.selectedIds.length) return;
  const ids = withAttached(s.elements, s.selectedIds);
  setElements([...s.elements.filter((e) => ids.has(e.id)), ...s.elements.filter((e) => !ids.has(e.id))]);
}

/** Apply a color to the selected elements (stickies only take sticky colors). */
export function recolorSelected(color: string, kind: 'ink' | 'sticky') {
  const s = get();
  const ids = new Set(s.selectedIds);
  setElements(
    s.elements.map((e) => {
      if (!ids.has(e.id) || e.type === 'image') return e;
      if ((e.type === 'sticky') !== (kind === 'sticky')) return e;
      return { ...e, color };
    }),
  );
}

export type FormatKey = keyof TextFormat;

/** Elements the B / I / U buttons act on right now: the one being edited, else selected text & notes. */
export function formatTargets(s: BoardState = get()): BoardElement[] {
  if (s.editingId) return s.elements.filter((e) => e.id === s.editingId);
  const ids = new Set(s.selectedIds);
  return s.elements.filter((e) => ids.has(e.id) && (e.type === 'text' || e.type === 'sticky'));
}

/** Toggle bold / italic / underline on the edited or selected text, or on the defaults for new text. */
export function toggleFormat(key: FormatKey) {
  const s = get();
  const targets = formatTargets(s);
  if (!targets.length) {
    set({ textFormat: { ...s.textFormat, [key]: !s.textFormat[key] } });
    return;
  }
  const on = !targets.every((e) => (e.type === 'text' || e.type === 'sticky') && e[key]);
  const ids = new Set(targets.map((e) => e.id));
  setElements(
    s.elements.map((e) => {
      if (!ids.has(e.id)) return e;
      if (e.type === 'sticky') return { ...e, [key]: on };
      if (e.type !== 'text') return e;
      const next = { ...e, [key]: on };
      // Bold / italic change the text's size; centered labels stay centered.
      const m = measureText(next.text, next.fontSize, next);
      const x = next.align === 'center' ? e.x + e.w / 2 - m.w / 2 : e.x;
      return { ...next, x, ...m };
    }),
    !s.editingId, // while editing, the whole edit is already one undo step
  );
}

/** Replace the whole board (open file / restore autosave / new board). */
export function loadBoard(opts: {
  elements: BoardElement[];
  camera?: Camera;
  fileName: string | null;
  dirty: boolean;
}) {
  const s = get();
  const docVersion = s.docVersion + 1;
  set({
    elements: opts.elements,
    camera: opts.camera ?? s.camera,
    past: [],
    future: [],
    pending: null,
    selectedIds: [],
    editingId: null,
    fileName: opts.fileName,
    docVersion,
    savedVersion: opts.dirty ? -1 : docVersion,
  });
}

export function markSaved(fileName: string) {
  set({ fileName, savedVersion: get().docVersion });
}

let toastId = 0;
export function toast(message: string, ms = 2600) {
  const id = ++toastId;
  set({ toasts: [...get().toasts, { id, message }] });
  setTimeout(() => set({ toasts: get().toasts.filter((t) => t.id !== id) }), ms);
}
