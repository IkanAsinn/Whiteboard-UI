import type { BoardElement, Box, Camera, Vec } from './types';
import { measureText } from './text';

let idCounter = 0;
/** Works in insecure contexts too (crypto.randomUUID needs HTTPS). */
export function newId(): string {
  idCounter = (idCounter + 1) % 1e6;
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8) + idCounter.toString(36);
}

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;

export function screenToWorld(p: Vec, cam: Camera): Vec {
  return { x: p.x / cam.z + cam.x, y: p.y / cam.z + cam.y };
}

export function worldToScreen(p: Vec, cam: Camera): Vec {
  return { x: (p.x - cam.x) * cam.z, y: (p.y - cam.y) * cam.z };
}

/** Zoom to `z` keeping the world point under `screenPoint` fixed. */
export function zoomAt(cam: Camera, screenPoint: Vec, z: number): Camera {
  const nz = clamp(z, MIN_ZOOM, MAX_ZOOM);
  const w = screenToWorld(screenPoint, cam);
  return { x: w.x - screenPoint.x / nz, y: w.y - screenPoint.y / nz, z: nz };
}

export function arrowHeadLength(strokeWidth: number) {
  return Math.max(12, strokeWidth * 4);
}

export function getBounds(el: BoardElement): Box {
  switch (el.type) {
    case 'stroke':
    case 'polygon': {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const p of el.points) {
        if (p[0] < minX) minX = p[0];
        if (p[1] < minY) minY = p[1];
        if (p[0] > maxX) maxX = p[0];
        if (p[1] > maxY) maxY = p[1];
      }
      const pad = (el.type === 'stroke' ? el.size : el.strokeWidth) / 2;
      return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
    }
    case 'line':
    case 'arrow': {
      const pad = el.strokeWidth / 2 + (el.type === 'arrow' ? arrowHeadLength(el.strokeWidth) / 2 : 0);
      const x = Math.min(el.x1, el.x2), y = Math.min(el.y1, el.y2);
      return {
        x: x - pad,
        y: y - pad,
        w: Math.abs(el.x2 - el.x1) + pad * 2,
        h: Math.abs(el.y2 - el.y1) + pad * 2,
      };
    }
    default:
      return { x: el.x, y: el.y, w: el.w, h: el.h };
  }
}

export function unionBounds(els: readonly BoardElement[]): Box | null {
  if (!els.length) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const el of els) {
    const b = getBounds(el);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

export function boxContains(outer: Box, inner: Box) {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}

export function boxesIntersect(a: Box, b: Box) {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

export function normalizeBox(x1: number, y1: number, x2: number, y2: number): Box {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}

export function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** Is world point (px, py) on the element, with tolerance `tol` (world units)? */
export function hitTest(el: BoardElement, px: number, py: number, tol: number): boolean {
  const b = getBounds(el);
  if (px < b.x - tol || py < b.y - tol || px > b.x + b.w + tol || py > b.y + b.h + tol) return false;
  switch (el.type) {
    case 'stroke': {
      const r = el.size / 2 + tol;
      const pts = el.points;
      if (pts.length === 1) return Math.hypot(px - pts[0][0], py - pts[0][1]) <= r;
      for (let i = 1; i < pts.length; i++) {
        if (distToSegment(px, py, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) <= r) return true;
      }
      return false;
    }
    case 'line':
    case 'arrow':
      return distToSegment(px, py, el.x1, el.y1, el.x2, el.y2) <= el.strokeWidth / 2 + tol;
    case 'polygon': {
      const pts = el.points;
      if (el.fill && pointInPolygon(px, py, pts)) return true;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        if (distToSegment(px, py, a[0], a[1], b[0], b[1]) <= el.strokeWidth / 2 + tol) return true;
      }
      return false;
    }
    case 'rect': {
      if (el.fill) return true;
      const inset = el.strokeWidth / 2 + tol;
      const inside =
        px > el.x + inset && py > el.y + inset && px < el.x + el.w - inset && py < el.y + el.h - inset;
      return !inside;
    }
    case 'ellipse': {
      const rx = el.w / 2, ry = el.h / 2;
      if (rx < 1 || ry < 1) return true;
      const cx = el.x + rx, cy = el.y + ry;
      const d = Math.sqrt(((px - cx) / rx) ** 2 + ((py - cy) / ry) ** 2);
      if (el.fill && d <= 1) return true;
      return Math.abs(d - 1) * Math.min(rx, ry) <= el.strokeWidth / 2 + tol;
    }
    default:
      return true; // text, sticky, image: whole box
  }
}

export function pointInPolygon(px: number, py: number, pts: readonly number[][]) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Topmost element under a world point. */
export function elementAt(els: readonly BoardElement[], p: Vec, tol: number): BoardElement | null {
  for (let i = els.length - 1; i >= 0; i--) if (hitTest(els[i], p.x, p.y, tol)) return els[i];
  return null;
}

export function translateElement<T extends BoardElement>(el: T, dx: number, dy: number): T {
  switch (el.type) {
    case 'stroke':
    case 'polygon':
      return { ...el, points: el.points.map((p) => (p.length > 2 ? [p[0] + dx, p[1] + dy, p[2]] : [p[0] + dx, p[1] + dy])) };
    case 'line':
    case 'arrow':
      return { ...el, x1: el.x1 + dx, y1: el.y1 + dy, x2: el.x2 + dx, y2: el.y2 + dy };
    default:
      return { ...el, x: (el as { x: number }).x + dx, y: (el as { y: number }).y + dy };
  }
}

/** Map an element from box `from` to box `to` (linear scale, no flipping). */
export function scaleElement(el: BoardElement, from: Box, to: Box): BoardElement {
  const sx = from.w ? to.w / from.w : 1;
  const sy = from.h ? to.h / from.h : 1;
  const mx = (x: number) => to.x + (x - from.x) * sx;
  const my = (y: number) => to.y + (y - from.y) * sy;
  const avg = (sx + sy) / 2;
  switch (el.type) {
    case 'stroke':
      return {
        ...el,
        size: Math.max(0.5, el.size * avg),
        points: el.points.map((p) => (p.length > 2 ? [mx(p[0]), my(p[1]), p[2]] : [mx(p[0]), my(p[1])])),
      };
    case 'polygon':
      return { ...el, points: el.points.map((p) => [mx(p[0]), my(p[1])]) };
    case 'line':
    case 'arrow':
      return { ...el, x1: mx(el.x1), y1: my(el.y1), x2: mx(el.x2), y2: my(el.y2) };
    case 'text': {
      const fontSize = Math.max(2, el.fontSize * Math.min(sx, sy));
      const m = measureText(el.text, fontSize, el);
      const x = el.align === 'center' ? mx(el.x + el.w / 2) - m.w / 2 : mx(el.x);
      return { ...el, x, y: my(el.y), fontSize, w: m.w, h: m.h };
    }
    default:
      return { ...el, x: mx(el.x), y: my(el.y), w: Math.max(1, el.w * sx), h: Math.max(1, el.h * sy) };
  }
}

export type Handle = 'nw' | 'ne' | 'sw' | 'se';
export const HANDLES: Handle[] = ['nw', 'ne', 'sw', 'se'];

export function handlePosition(b: Box, h: Handle): Vec {
  return { x: h[1] === 'w' ? b.x : b.x + b.w, y: h[0] === 'n' ? b.y : b.y + b.h };
}

export function handleAt(b: Box, p: Vec, tol: number): Handle | null {
  for (const h of HANDLES) {
    const hp = handlePosition(b, h);
    if (Math.abs(p.x - hp.x) <= tol && Math.abs(p.y - hp.y) <= tol) return h;
  }
  return null;
}

/** Selection box padding in world units, constant on screen. */
export const selectionPadding = (z: number) => 6 / z;

export function padBox(b: Box, pad: number): Box {
  return { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
}

/** Resize `start` by dragging handle `h` to point `p`. */
export function resizeBox(start: Box, h: Handle, p: Vec, uniform: boolean): Box {
  const dirX = h[1] === 'w' ? -1 : 1;
  const dirY = h[0] === 'n' ? -1 : 1;
  const ax = dirX > 0 ? start.x : start.x + start.w; // anchor = opposite corner
  const ay = dirY > 0 ? start.y : start.y + start.h;
  const w0 = Math.max(start.w, 1e-6), h0 = Math.max(start.h, 1e-6);
  let sx = ((p.x - ax) * dirX) / w0;
  let sy = ((p.y - ay) * dirY) / h0;
  const minScale = 0.02;
  if (uniform) {
    const s = Math.max(sx, sy, minScale);
    sx = sy = s;
  }
  sx = Math.max(sx, minScale);
  sy = Math.max(sy, minScale);
  const w = w0 * sx, hh = h0 * sy;
  return { x: dirX > 0 ? ax : ax - w, y: dirY > 0 ? ay : ay - hh, w, h: hh };
}

/** Snap a vector to multiples of 45°. */
export function snapAngle(dx: number, dy: number): Vec {
  const len = Math.hypot(dx, dy);
  const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  return { x: Math.cos(a) * len, y: Math.sin(a) * len };
}
