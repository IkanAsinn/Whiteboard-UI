import { useCallback, useEffect, useRef } from 'react';
import type { BoardElement, Box, Camera, LineElement, ShapeElement, StrokeElement, Tool, Vec } from '../types';
import {
  boxContains,
  elementAt,
  getBounds,
  handleAt,
  hitTest,
  newId,
  normalizeBox,
  padBox,
  resizeBox,
  scaleElement,
  screenToWorld,
  selectionPadding,
  snapAngle,
  translateElement,
  unionBounds,
  zoomAt,
  type Handle,
} from '../geometry';
import {
  commit,
  finishEditing,
  mark,
  setCamera,
  setElements,
  setSelection,
  startEditing,
  useBoard,
  withAttached,
} from '../store';
import { LASER_FADE_MS, renderScene, setImageLoadListener, type LaserPoint } from '../render';
import { LINE_HEIGHT, STICKY_SIZE, measureText } from '../text';
import { addImageFile } from '../actions';
import { recognizeShape } from '../recognize';
import { ICON_DRAG_MIME, insertIcon, type IconPayload } from '../icons';
import { FILE_EXT, openDroppedFile } from '../persistence';

type Interaction =
  | { kind: 'none' }
  | { kind: 'pan'; start: Vec; cam: Camera }
  | { kind: 'draw' }
  | { kind: 'shape'; start: Vec }
  | { kind: 'erase'; last: Vec }
  | { kind: 'laser' }
  | { kind: 'move'; start: Vec; originals: Map<string, BoardElement> }
  | {
      kind: 'resize';
      handle: Handle;
      startBox: Box;
      originals: Map<string, BoardElement>;
      followers: Map<string, { label: BoardElement; parentId: string }>;
      uniform: boolean;
    }
  | { kind: 'marquee'; start: Vec; base: string[] };

const get = useBoard.getState;

const HANDLE_CURSOR: Record<Handle, string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize' };

const ERASER_RADIUS = 10; // screen px
const HIT_TOLERANCE = 6; // screen px

/**
 * Where an attached label's center goes (one axis) when its element is resized from
 * [s0, s0+len0] to [s1, s1+len1]: outside the element it keeps its distance to the nearest
 * edge (a label under an icon stays just under it); over the element it keeps its relative position.
 */
function followAxis(c: number, s0: number, len0: number, s1: number, len1: number) {
  if (c < s0) return s1 - (s0 - c);
  if (c > s0 + len0) return s1 + len1 + (c - (s0 + len0));
  return s1 + (len0 ? (c - s0) / len0 : 0.5) * len1;
}

function toolCursor(tool: Tool): string {
  switch (tool) {
    case 'hand':
      return 'grab';
    case 'text':
      return 'text';
    case 'eraser':
      return 'none';
    case 'select':
      return 'default';
    default:
      return 'crosshair';
  }
}

export function Canvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const inter = useRef<Interaction>({ kind: 'none' });
  const draft = useRef<BoardElement | null>(null);
  const marquee = useRef<Box | null>(null);
  const laser = useRef<LaserPoint[]>([]);
  const pointerWorld = useRef<Vec | null>(null);
  const hoverId = useRef<string | null>(null);
  const touches = useRef(new Map<number, Vec>());
  const pinch = useRef<{ dist: number; mid: Vec; cam: Camera } | null>(null);
  const frame = useRef(0);
  const shiftDown = useRef(false);

  // ---------- rendering ----------

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const s = get();
    const now = performance.now();
    laser.current = laser.current.filter((p) => now - p.t < LASER_FADE_MS);
    const showEraser = (s.tool === 'eraser' || inter.current.kind === 'erase') && pointerWorld.current;
    renderScene(ctx, s.elements, {
      camera: s.camera,
      width: size.current.w,
      height: size.current.h,
      dpr: size.current.dpr,
      showGrid: s.showGrid,
      selectedIds: s.selectedIds,
      editingId: s.editingId,
      draft: draft.current,
      marquee: marquee.current,
      laser: laser.current,
      eraser: showEraser ? { ...pointerWorld.current!, r: ERASER_RADIUS / s.camera.z } : null,
      hoverId: s.tool === 'select' && inter.current.kind === 'none' ? hoverId.current : null,
      now,
    });
    // Keep animating while the laser trail fades out.
    if (laser.current.length) requestDraw();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const requestDraw = useCallback(() => {
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      draw();
    });
  }, [draw]);

  useEffect(() => {
    const unsub = useBoard.subscribe(requestDraw);
    setImageLoadListener(requestDraw);
    return () => {
      unsub();
      setImageLoadListener(null);
    };
  }, [requestDraw]);

  // Keep the canvas sized to its element at device pixel ratio.
  useEffect(() => {
    const canvas = canvasRef.current!;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth, h = canvas.clientHeight;
      size.current = { w, h, dpr };
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      draw();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();
    return () => ro.disconnect();
  }, [draw]);

  // ---------- helpers ----------

  const screenPoint = (e: { clientX: number; clientY: number }): Vec => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const setCursor = (c: string) => {
    if (canvasRef.current && canvasRef.current.style.cursor !== c) canvasRef.current.style.cursor = c;
  };

  const updateIdleCursor = useCallback((world: Vec | null) => {
    const s = get();
    if (s.spaceDown) return setCursor('grab');
    if (s.tool !== 'select' || !world) {
      hoverId.current = null;
      return setCursor(toolCursor(s.tool));
    }
    const z = s.camera.z;
    if (s.selectedIds.length) {
      const ub = selectedBounds();
      if (ub) {
        const b = padBox(ub, selectionPadding(z));
        const h = handleAt(b, world, 8 / z);
        if (h) {
          hoverId.current = null;
          return setCursor(HANDLE_CURSOR[h]);
        }
      }
    }
    const hit = elementAt(s.elements, world, HIT_TOLERANCE / z);
    const prevHover = hoverId.current;
    hoverId.current = hit?.id ?? null;
    if (prevHover !== hoverId.current) requestDraw();
    setCursor(hit ? 'move' : 'default');
  }, [requestDraw]);

  // Update cursor when tool / space state changes.
  useEffect(
    () =>
      useBoard.subscribe((s, prev) => {
        if (s.tool !== prev.tool || s.spaceDown !== prev.spaceDown) updateIdleCursor(pointerWorld.current);
      }),
    [updateIdleCursor],
  );

  function selectedBounds() {
    const s = get();
    const ids = new Set(s.selectedIds);
    return unionBounds(s.elements.filter((e) => ids.has(e.id)));
  }

  function eraseAlong(a: Vec, b: Vec) {
    const s = get();
    const r = ERASER_RADIUS / s.camera.z;
    const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (r / 2)));
    const remove = new Set<string>();
    for (const el of s.elements) {
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        if (hitTest(el, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, r)) {
          remove.add(el.id);
          break;
        }
      }
    }
    if (remove.size) {
      const all = withAttached(s.elements, remove); // erasing an icon also erases its label
      setElements(s.elements.filter((e) => !all.has(e.id)), false);
    }
  }

  function shapeFromDrag(start: Vec, p: Vec, shift: boolean) {
    const d = draft.current;
    if (!d) return;
    if (d.type === 'rect' || d.type === 'ellipse') {
      let { x, y } = p;
      if (shift) {
        const side = Math.max(Math.abs(p.x - start.x), Math.abs(p.y - start.y));
        x = start.x + Math.sign(p.x - start.x || 1) * side;
        y = start.y + Math.sign(p.y - start.y || 1) * side;
      }
      draft.current = { ...d, ...normalizeBox(start.x, start.y, x, y) } as ShapeElement;
    } else if (d.type === 'line' || d.type === 'arrow') {
      let dx = p.x - start.x, dy = p.y - start.y;
      if (shift) ({ x: dx, y: dy } = snapAngle(dx, dy));
      draft.current = { ...d, x2: start.x + dx, y2: start.y + dy } as LineElement;
    }
  }

  function createTextAt(world: Vec) {
    const s = get();
    const fontSize = s.styles.text.size;
    const m = measureText('', fontSize, s.textFormat);
    const el: BoardElement = {
      id: newId(),
      type: 'text',
      color: s.styles.text.color,
      x: world.x,
      y: world.y - (fontSize * LINE_HEIGHT) / 2,
      text: '',
      fontSize,
      ...s.textFormat,
      ...m,
    };
    mark();
    setElements([...s.elements, el], false);
    startEditing(el.id);
  }

  function cancelInteraction() {
    const it = inter.current;
    if (it.kind === 'move' || it.kind === 'resize' || it.kind === 'erase') commit();
    draft.current = null;
    marquee.current = null;
    inter.current = { kind: 'none' };
  }

  // ---------- pointer events ----------

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    e.preventDefault();
    // preventDefault keeps focus where it was; hand it back to the board so shortcuts work.
    const active = document.activeElement;
    if (active instanceof HTMLElement && active !== document.body && !active.classList.contains('text-editor')) active.blur();
    const sp = screenPoint(e);
    const s = get();
    const world = screenToWorld(sp, s.camera);
    pointerWorld.current = world;

    if (e.pointerType === 'touch') {
      touches.current.set(e.pointerId, sp);
      if (touches.current.size === 2) {
        // Second finger: abandon the current gesture and start pinch-zoom.
        cancelInteraction();
        const [a, b] = [...touches.current.values()];
        pinch.current = {
          dist: Math.hypot(a.x - b.x, a.y - b.y),
          mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
          cam: s.camera,
        };
        requestDraw();
        return;
      }
      if (touches.current.size > 2) return;
    }

    if (inter.current.kind !== 'none') return;
    canvas.setPointerCapture(e.pointerId);

    // Clicking away from a text being edited just commits it.
    if (s.editingId) {
      finishEditing();
      if (s.tool === 'text' || s.tool === 'sticky') return;
    }

    if (e.button === 1 || s.spaceDown || s.tool === 'hand') {
      inter.current = { kind: 'pan', start: sp, cam: s.camera };
      setCursor('grabbing');
      return;
    }
    if (e.button !== 0 && !(e.pointerType === 'pen' && e.button === 5)) return;

    // Pen eraser end / eraser button.
    const tool: Tool = e.pointerType === 'pen' && (e.buttons & 32) ? 'eraser' : s.tool;
    const z = s.camera.z;

    switch (tool) {
      case 'pen':
      case 'highlighter': {
        const style = s.styles[tool];
        const pressure = e.pointerType === 'pen';
        draft.current = {
          id: newId(),
          type: 'stroke',
          color: style.color,
          size: style.size,
          highlighter: tool === 'highlighter',
          pressure,
          points: [pressure ? [world.x, world.y, e.pressure] : [world.x, world.y]],
        } satisfies StrokeElement;
        inter.current = { kind: 'draw' };
        break;
      }
      case 'rect':
      case 'ellipse':
      case 'line':
      case 'arrow': {
        const st = s.styles.shape;
        draft.current =
          tool === 'rect' || tool === 'ellipse'
            ? { id: newId(), type: tool, color: st.color, strokeWidth: st.size, fill: s.shapeFill, x: world.x, y: world.y, w: 0, h: 0 }
            : { id: newId(), type: tool, color: st.color, strokeWidth: st.size, x1: world.x, y1: world.y, x2: world.x, y2: world.y };
        inter.current = { kind: 'shape', start: world };
        break;
      }
      case 'eraser':
        mark();
        inter.current = { kind: 'erase', last: world };
        eraseAlong(world, world);
        break;
      case 'laser':
        laser.current.push({ ...world, t: performance.now() });
        inter.current = { kind: 'laser' };
        break;
      case 'text': {
        const hit = elementAt(s.elements, world, HIT_TOLERANCE / z);
        if (hit && (hit.type === 'text' || hit.type === 'sticky')) startEditing(hit.id);
        else createTextAt(world);
        break;
      }
      case 'sticky': {
        const st = s.styles.sticky;
        const el: BoardElement = {
          id: newId(),
          type: 'sticky',
          color: st.color,
          x: world.x - STICKY_SIZE / 2,
          y: world.y - STICKY_SIZE / 2,
          w: STICKY_SIZE,
          h: STICKY_SIZE,
          text: '',
          ...s.textFormat,
        };
        mark();
        setElements([...s.elements, el], false);
        useBoard.setState({ tool: 'select' });
        startEditing(el.id);
        break;
      }
      case 'select': {
        // Resize handles first.
        if (s.selectedIds.length) {
          const ub = selectedBounds();
          if (ub) {
            const box = padBox(ub, selectionPadding(z));
            const h = handleAt(box, world, 8 / z);
            if (h) {
              const ids = new Set(s.selectedIds);
              const selected = s.elements.filter((el) => ids.has(el.id));
              const freeform = selected.every((el) => el.type === 'rect' || el.type === 'ellipse' || el.type === 'sticky' || el.type === 'image');
              // Unselected labels attached to resized elements stay at the same spot relative
              // to their element's bottom-center.
              const followers = new Map<string, { label: BoardElement; parentId: string }>();
              for (const el of s.elements) {
                if (el.type === 'text' && el.attachedTo && ids.has(el.attachedTo) && !ids.has(el.id)) {
                  followers.set(el.id, { label: el, parentId: el.attachedTo });
                }
              }
              mark();
              inter.current = {
                kind: 'resize',
                handle: h,
                startBox: ub,
                originals: new Map(selected.map((el) => [el.id, el])),
                followers,
                uniform: !freeform,
              };
              break;
            }
          }
        }
        const hit = elementAt(s.elements, world, HIT_TOLERANCE / z);
        if (hit) {
          let ids = s.selectedIds;
          if (e.shiftKey) {
            ids = ids.includes(hit.id) ? ids.filter((id) => id !== hit.id) : [...ids, hit.id];
            setSelection(ids);
            if (!ids.includes(hit.id)) break;
          } else if (!ids.includes(hit.id)) {
            ids = [hit.id];
            setSelection(ids);
          }
          // Attached labels (icon names) travel with their element.
          const idSet = withAttached(s.elements, ids);
          mark();
          inter.current = {
            kind: 'move',
            start: world,
            originals: new Map(s.elements.filter((el) => idSet.has(el.id)).map((el) => [el.id, el])),
          };
        } else {
          const base = e.shiftKey ? s.selectedIds : [];
          if (!e.shiftKey) setSelection([]);
          inter.current = { kind: 'marquee', start: world, base };
          marquee.current = { x: world.x, y: world.y, w: 0, h: 0 };
        }
        break;
      }
    }
    requestDraw();
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const sp = screenPoint(e);
    const s = get();

    if (e.pointerType === 'touch' && touches.current.has(e.pointerId)) {
      touches.current.set(e.pointerId, sp);
      if (pinch.current && touches.current.size >= 2) {
        const [a, b] = [...touches.current.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const p = pinch.current;
        const startWorld = screenToWorld(p.mid, p.cam);
        const zoomed = zoomAt(p.cam, p.mid, p.cam.z * (dist / Math.max(p.dist, 1)));
        setCamera({ x: startWorld.x - mid.x / zoomed.z, y: startWorld.y - mid.y / zoomed.z, z: zoomed.z });
        return;
      }
    }

    const world = screenToWorld(sp, s.camera);
    pointerWorld.current = world;
    shiftDown.current = e.shiftKey;
    const it = inter.current;

    switch (it.kind) {
      case 'none':
        updateIdleCursor(world);
        if (s.tool === 'eraser') requestDraw();
        break;
      case 'pan':
        setCamera({
          ...it.cam,
          x: it.cam.x - (sp.x - it.start.x) / it.cam.z,
          y: it.cam.y - (sp.y - it.start.y) / it.cam.z,
        });
        break;
      case 'draw': {
        const d = draft.current as StrokeElement;
        const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
        const pts = d.points.slice();
        const minDist = 0.6 / s.camera.z;
        for (const ev of events.length ? events : [e.nativeEvent]) {
          const w = screenToWorld(screenPoint(ev), s.camera);
          const last = pts[pts.length - 1];
          if (Math.hypot(w.x - last[0], w.y - last[1]) < minDist) continue;
          pts.push(d.pressure ? [w.x, w.y, ev.pressure] : [w.x, w.y]);
        }
        draft.current = { ...d, points: pts };
        requestDraw();
        break;
      }
      case 'shape':
        shapeFromDrag(it.start, world, e.shiftKey);
        requestDraw();
        break;
      case 'erase':
        eraseAlong(it.last, world);
        it.last = world;
        requestDraw();
        break;
      case 'laser':
        laser.current.push({ ...world, t: performance.now() });
        requestDraw();
        break;
      case 'move': {
        const dx = world.x - it.start.x, dy = world.y - it.start.y;
        setElements(
          s.elements.map((el) => {
            const orig = it.originals.get(el.id);
            return orig ? translateElement(orig, dx, dy) : el;
          }),
          false,
        );
        break;
      }
      case 'resize': {
        const box = resizeBox(it.startBox, it.handle, world, it.uniform || e.shiftKey);
        const scaled = new Map<string, BoardElement>();
        for (const [id, orig] of it.originals) scaled.set(id, scaleElement(orig, it.startBox, box));
        for (const [id, f] of it.followers) {
          const before = getBounds(it.originals.get(f.parentId)!);
          const after = getBounds(scaled.get(f.parentId)!);
          const lb = getBounds(f.label);
          const cx = lb.x + lb.w / 2, cy = lb.y + lb.h / 2;
          const dx = followAxis(cx, before.x, before.w, after.x, after.w) - cx;
          const dy = followAxis(cy, before.y, before.h, after.y, after.h) - cy;
          scaled.set(id, translateElement(f.label, dx, dy));
        }
        setElements(
          s.elements.map((el) => scaled.get(el.id) ?? el),
          false,
        );
        break;
      }
      case 'marquee': {
        const m = normalizeBox(it.start.x, it.start.y, world.x, world.y);
        marquee.current = m;
        const inside = s.elements.filter((el) => boxContains(m, getBounds(el))).map((el) => el.id);
        setSelection([...new Set([...it.base, ...inside])]);
        requestDraw();
        break;
      }
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType === 'touch') {
      touches.current.delete(e.pointerId);
      if (pinch.current) {
        if (touches.current.size < 2) pinch.current = null;
        return;
      }
    }
    const it = inter.current;
    const s = get();
    switch (it.kind) {
      case 'draw': {
        const d = draft.current as StrokeElement | null;
        if (d) {
          const shape = s.autoShape && !d.highlighter ? recognizeShape(d, 50 / s.camera.z) : null;
          setElements([...s.elements, shape ?? d]);
        }
        break;
      }
      case 'shape': {
        const d = draft.current;
        if (d) {
          const b = getBounds(d);
          const tiny = 3 / s.camera.z;
          const big = d.type === 'line' || d.type === 'arrow' ? Math.hypot(d.x2 - d.x1, d.y2 - d.y1) > tiny : b.w > tiny || b.h > tiny;
          if (big) setElements([...s.elements, d]);
        }
        break;
      }
      case 'erase':
      case 'move':
      case 'resize':
        commit();
        break;
      default:
        break;
    }
    draft.current = null;
    marquee.current = null;
    inter.current = { kind: 'none' };
    if (canvasRef.current?.hasPointerCapture(e.pointerId)) canvasRef.current.releasePointerCapture(e.pointerId);
    updateIdleCursor(pointerWorld.current);
    requestDraw();
  };

  const onPointerLeave = () => {
    if (inter.current.kind === 'none') {
      pointerWorld.current = null;
      hoverId.current = null;
      requestDraw();
    }
  };

  const onDoubleClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const s = get();
    if (s.tool !== 'select') return;
    const world = screenToWorld(screenPoint(e), s.camera);
    const hit = elementAt(s.elements, world, HIT_TOLERANCE / s.camera.z);
    if (hit && (hit.type === 'text' || hit.type === 'sticky')) startEditing(hit.id);
    else if (!hit) createTextAt(world);
  };

  // ---------- wheel (needs a non-passive listener) ----------

  useEffect(() => {
    const canvas = canvasRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const cam = get().camera;
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
      const dx = e.deltaX * unit, dy = e.deltaY * unit;
      if (e.ctrlKey || e.metaKey) {
        // Trackpad pinch arrives as ctrl+wheel.
        const factor = Math.exp(-dy * (e.deltaMode === 0 ? 0.01 : 0.002));
        setCamera(zoomAt(cam, screenPoint(e), cam.z * Math.min(Math.max(factor, 0.5), 2)));
      } else if (e.shiftKey && !dx) {
        setCamera({ ...cam, x: cam.x + dy / cam.z });
      } else {
        setCamera({ ...cam, x: cam.x + dx / cam.z, y: cam.y + dy / cam.z });
      }
    };
    canvas.addEventListener('wheel', onWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', onWheel);
  }, []);

  // ---------- drag & drop (images, board files) ----------

  const onDragOver = (e: React.DragEvent) => {
    const types = e.dataTransfer.types;
    if (types.includes('Files') || types.includes(ICON_DRAG_MIME)) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const world = screenToWorld(screenPoint(e), get().camera);
    const icon = e.dataTransfer.getData(ICON_DRAG_MIME);
    if (icon) {
      try {
        const p = JSON.parse(icon) as IconPayload & { withLabel: boolean };
        insertIcon(p, world, p.withLabel);
      } catch {
        /* ignore malformed drag data */
      }
      return;
    }
    const files = Array.from(e.dataTransfer.files);
    files.forEach((file, i) => {
      if (file.name.toLowerCase().endsWith(FILE_EXT)) openDroppedFile(file);
      else if (file.type.startsWith('image/')) addImageFile(file, { x: world.x + i * 30, y: world.y + i * 30 });
    });
  };

  return (
    <canvas
      ref={canvasRef}
      className="board-canvas"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={onPointerLeave}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => e.preventDefault()}
      onDragOver={onDragOver}
      onDrop={onDrop}
    />
  );
}
