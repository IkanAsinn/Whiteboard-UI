import { getStroke } from 'perfect-freehand';
import type { BoardElement, Box, Camera, StrokeElement } from './types';
import { HANDLES, arrowHeadLength, getBounds, handlePosition, padBox, selectionPadding, unionBounds } from './geometry';
import { LINE_HEIGHT, STICKY_PADDING, fitStickyText, fontString } from './text';

export const ACCENT = '#2f6fed';
export const CANVAS_BG = '#f7f7f5';

export interface LaserPoint {
  x: number;
  y: number;
  t: number;
}
export const LASER_FADE_MS = 900;

// ---------- strokes ----------

const strokeCache = new WeakMap<StrokeElement, Path2D>();

function outlineToPath(points: number[][]): Path2D {
  const path = new Path2D();
  const len = points.length;
  if (len < 4) {
    if (len) {
      path.moveTo(points[0][0], points[0][1]);
      for (const p of points) path.lineTo(p[0], p[1]);
      path.closePath();
    }
    return path;
  }
  let a = points[0], b = points[1];
  const c = points[2];
  path.moveTo(a[0], a[1]);
  path.quadraticCurveTo(b[0], b[1], (b[0] + c[0]) / 2, (b[1] + c[1]) / 2);
  for (let i = 2; i < len - 1; i++) {
    a = points[i];
    b = points[i + 1];
    path.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
  }
  path.closePath();
  return path;
}

export function strokePath(el: StrokeElement): Path2D {
  let path = strokeCache.get(el);
  if (!path) {
    const outline = getStroke(el.points, {
      size: el.size,
      thinning: el.highlighter ? 0 : 0.55,
      smoothing: 0.5,
      streamline: 0.45,
      simulatePressure: !el.pressure && !el.highlighter,
      last: true,
    });
    path = outlineToPath(outline);
    strokeCache.set(el, path);
  }
  return path;
}

// ---------- images ----------

const imageCache = new Map<string, HTMLImageElement>();
let onImageLoad: (() => void) | null = null;
export function setImageLoadListener(fn: (() => void) | null) {
  onImageLoad = fn;
}

function getImage(src: string): HTMLImageElement | null {
  let img = imageCache.get(src);
  if (!img) {
    img = new Image();
    img.onload = () => onImageLoad?.();
    img.src = src;
    imageCache.set(src, img);
  }
  return img.complete && img.naturalWidth ? img : null;
}

export function preloadImages(els: readonly BoardElement[]): Promise<void> {
  const pending = els
    .filter((e) => e.type === 'image')
    .map((e) => {
      getImage(e.src);
      const img = imageCache.get(e.src)!;
      return img.complete ? Promise.resolve() : img.decode().catch(() => undefined);
    });
  return Promise.all(pending).then(() => undefined);
}

// ---------- elements ----------

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
}

/** Draw lines of text (font + fillStyle already set) with optional underline. */
function drawTextLines(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  x: number,
  top: number,
  fontSize: number,
  centered: boolean,
  underline: boolean,
) {
  const lh = fontSize * LINE_HEIGHT;
  ctx.textBaseline = 'middle';
  ctx.textAlign = centered ? 'center' : 'left';
  const thickness = Math.max(1, fontSize / 15);
  lines.forEach((line, i) => {
    const cy = top + i * lh + lh / 2;
    ctx.fillText(line, x, cy);
    if (underline && line.trim()) {
      const w = ctx.measureText(line).width;
      ctx.fillRect(centered ? x - w / 2 : x, cy + fontSize * 0.42, w, thickness);
    }
  });
  ctx.textAlign = 'left';
}

export function drawElement(ctx: CanvasRenderingContext2D, el: BoardElement, editingId: string | null) {
  switch (el.type) {
    case 'stroke': {
      ctx.fillStyle = el.color;
      if (el.highlighter) {
        ctx.save();
        ctx.globalAlpha = 0.45;
        ctx.globalCompositeOperation = 'multiply';
        ctx.fill(strokePath(el));
        ctx.restore();
      } else ctx.fill(strokePath(el));
      break;
    }
    case 'rect':
    case 'ellipse': {
      ctx.beginPath();
      if (el.type === 'rect') ctx.roundRect(el.x, el.y, el.w, el.h, Math.min(8, el.w / 4, el.h / 4));
      else ctx.ellipse(el.x + el.w / 2, el.y + el.h / 2, el.w / 2, el.h / 2, 0, 0, Math.PI * 2);
      if (el.fill) {
        ctx.save();
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = el.color;
        ctx.fill();
        ctx.restore();
      }
      ctx.strokeStyle = el.color;
      ctx.lineWidth = el.strokeWidth;
      ctx.lineJoin = 'round';
      ctx.stroke();
      break;
    }
    case 'polygon': {
      ctx.beginPath();
      el.points.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
      ctx.closePath();
      if (el.fill) {
        ctx.save();
        ctx.globalAlpha = 0.18;
        ctx.fillStyle = el.color;
        ctx.fill();
        ctx.restore();
      }
      ctx.strokeStyle = el.color;
      ctx.lineWidth = el.strokeWidth;
      ctx.lineJoin = 'round';
      ctx.stroke();
      break;
    }
    case 'line':
    case 'arrow': {
      ctx.strokeStyle = el.color;
      ctx.lineWidth = el.strokeWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      ctx.moveTo(el.x1, el.y1);
      ctx.lineTo(el.x2, el.y2);
      if (el.type === 'arrow') {
        const len = Math.hypot(el.x2 - el.x1, el.y2 - el.y1);
        const head = Math.min(arrowHeadLength(el.strokeWidth), len * 0.6);
        const a = Math.atan2(el.y2 - el.y1, el.x2 - el.x1);
        const spread = Math.PI / 7;
        ctx.moveTo(el.x2 - head * Math.cos(a - spread), el.y2 - head * Math.sin(a - spread));
        ctx.lineTo(el.x2, el.y2);
        ctx.lineTo(el.x2 - head * Math.cos(a + spread), el.y2 - head * Math.sin(a + spread));
      }
      ctx.stroke();
      break;
    }
    case 'text': {
      if (el.id === editingId) break;
      ctx.fillStyle = el.color;
      ctx.font = fontString(el.fontSize, el);
      const centered = el.align === 'center';
      drawTextLines(ctx, el.text.split('\n'), centered ? el.x + el.w / 2 : el.x, el.y, el.fontSize, centered, !!el.underline);
      break;
    }
    case 'sticky': {
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.16)';
      ctx.shadowBlur = 12;
      ctx.shadowOffsetY = 3;
      ctx.fillStyle = el.color;
      roundRect(ctx, el.x, el.y, el.w, el.h, 6);
      ctx.fill();
      ctx.restore();
      if (el.id === editingId || !el.text) break;
      const { fontSize, lines } = fitStickyText(el.text, el.w, el.h, el);
      ctx.save();
      roundRect(ctx, el.x, el.y, el.w, el.h, 6);
      ctx.clip();
      ctx.fillStyle = '#1e1e1e';
      ctx.font = fontString(fontSize, el);
      drawTextLines(ctx, lines, el.x + STICKY_PADDING, el.y + STICKY_PADDING, fontSize, false, !!el.underline);
      ctx.restore();
      break;
    }
    case 'image': {
      const img = getImage(el.src);
      if (img) ctx.drawImage(img, el.x, el.y, el.w, el.h);
      else {
        ctx.fillStyle = '#e9e9e7';
        ctx.fillRect(el.x, el.y, el.w, el.h);
      }
      break;
    }
  }
}

// ---------- scene ----------

export interface SceneOptions {
  camera: Camera;
  width: number;
  height: number;
  dpr: number;
  showGrid: boolean;
  selectedIds: readonly string[];
  editingId: string | null;
  draft: BoardElement | null;
  marquee: Box | null;
  laser: readonly LaserPoint[];
  eraser: { x: number; y: number; r: number } | null;
  hoverId: string | null;
  now: number;
}

function drawGrid(ctx: CanvasRenderingContext2D, cam: Camera, width: number, height: number) {
  let spacing = 24 * cam.z;
  while (spacing < 14) spacing *= 4;
  const ox = -((cam.x * cam.z) % spacing);
  const oy = -((cam.y * cam.z) % spacing);
  const r = Math.min(2.2, Math.max(1.5, cam.z * 1.8)); // dot size in screen px
  ctx.fillStyle = 'rgba(30, 30, 30, 0.32)';
  ctx.beginPath();
  for (let x = ox; x < width; x += spacing) {
    for (let y = oy; y < height; y += spacing) {
      ctx.moveTo(x + r / 2, y);
      ctx.arc(x, y, r / 2, 0, Math.PI * 2);
    }
  }
  ctx.fill();
}

export function renderScene(ctx: CanvasRenderingContext2D, elements: readonly BoardElement[], o: SceneOptions) {
  const { camera: cam, dpr } = o;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = CANVAS_BG;
  ctx.fillRect(0, 0, o.width, o.height);
  if (o.showGrid) drawGrid(ctx, cam, o.width, o.height);

  // World transform.
  ctx.setTransform(dpr * cam.z, 0, 0, dpr * cam.z, -cam.x * cam.z * dpr, -cam.y * cam.z * dpr);
  const view: Box = { x: cam.x, y: cam.y, w: o.width / cam.z, h: o.height / cam.z };
  for (const el of elements) {
    const b = getBounds(el);
    // Cull off-screen elements (sticky shadows need a little slack).
    if (b.x > view.x + view.w + 20 || b.y > view.y + view.h + 20 || b.x + b.w < view.x - 20 || b.y + b.h < view.y - 20)
      continue;
    drawElement(ctx, el, o.editingId);
  }
  if (o.draft) drawElement(ctx, o.draft, null);

  const px = 1 / cam.z; // one screen pixel in world units

  // Hover outline (select tool).
  if (o.hoverId && !o.selectedIds.includes(o.hoverId)) {
    const el = elements.find((e) => e.id === o.hoverId);
    if (el) {
      const b = padBox(getBounds(el), selectionPadding(cam.z));
      ctx.strokeStyle = 'rgba(47, 111, 237, 0.45)';
      ctx.lineWidth = px;
      ctx.strokeRect(b.x, b.y, b.w, b.h);
    }
  }

  // Selection.
  if (o.selectedIds.length) {
    const ids = new Set(o.selectedIds);
    const selected = elements.filter((e) => ids.has(e.id));
    const pad = selectionPadding(cam.z);
    ctx.lineWidth = px;
    if (selected.length > 1) {
      ctx.strokeStyle = 'rgba(47, 111, 237, 0.5)';
      for (const el of selected) {
        const b = padBox(getBounds(el), pad / 2);
        ctx.strokeRect(b.x, b.y, b.w, b.h);
      }
    }
    const ub = unionBounds(selected);
    if (ub) {
      const b = padBox(ub, pad);
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 1.5 * px;
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      const hs = 9 * px;
      for (const h of HANDLES) {
        const p = handlePosition(b, h);
        ctx.fillStyle = '#fff';
        ctx.beginPath();
        ctx.roundRect(p.x - hs / 2, p.y - hs / 2, hs, hs, 2 * px);
        ctx.fill();
        ctx.stroke();
      }
    }
  }

  // Marquee.
  if (o.marquee) {
    const m = o.marquee;
    ctx.fillStyle = 'rgba(47, 111, 237, 0.08)';
    ctx.fillRect(m.x, m.y, m.w, m.h);
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = px;
    ctx.setLineDash([4 * px, 3 * px]);
    ctx.strokeRect(m.x, m.y, m.w, m.h);
    ctx.setLineDash([]);
  }

  // Laser pointer trail.
  if (o.laser.length) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.shadowColor = 'rgba(255, 40, 40, 0.9)';
    ctx.shadowBlur = 10;
    for (let i = 1; i < o.laser.length; i++) {
      const a = o.laser[i - 1], b = o.laser[i];
      if (b.t - a.t > 120) continue; // gap between separate gestures
      const life = 1 - (o.now - b.t) / LASER_FADE_MS;
      if (life <= 0) continue;
      ctx.strokeStyle = `rgba(255, 45, 45, ${life})`;
      ctx.lineWidth = (2 + 4 * life) * px;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.restore();
  }

  // Eraser cursor.
  if (o.eraser) {
    ctx.beginPath();
    ctx.arc(o.eraser.x, o.eraser.y, o.eraser.r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(30,30,30,0.6)';
    ctx.lineWidth = px;
    ctx.stroke();
  }
}

/** Render elements into a standalone canvas (for PNG export). */
export async function renderToCanvas(elements: readonly BoardElement[], padding = 40, maxScale = 2) {
  const b = unionBounds(elements);
  if (!b) return null;
  await preloadImages(elements);
  const w = b.w + padding * 2, h = b.h + padding * 2;
  const scale = Math.min(maxScale, 8192 / w, 8192 / h);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(w * scale);
  canvas.height = Math.ceil(h * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(scale, 0, 0, scale, (-b.x + padding) * scale, (-b.y + padding) * scale);
  for (const el of elements) drawElement(ctx, el, null);
  return canvas;
}
