/*
 * Ink-to-shape recognition.
 *
 * A freehand stroke is classified by how well it fits each candidate geometry,
 * and the clean shape is built from the *measured* geometry of the drawing
 * (its own size, proportions, position and rotation) — a lopsided oval becomes
 * that oval, a tall triangle stays tall, a tilted box stays tilted.
 *
 * Recognized: straight line, circle, ellipse (any rotation), triangle,
 * rectangle/square (any rotation), diamond, generic quadrilateral, pentagon/hexagon.
 * Anything that doesn't fit well enough stays as ink.
 */
import type { BoardElement, StrokeElement } from './types';
import { distToSegment, newId } from './geometry';

type P = [number, number];

const DEG = 180 / Math.PI;

function pathLength(pts: P[]) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return L;
}

/** Resample to n points evenly spaced along the path (removes drawing-speed bias). */
function resample(pts: P[], n: number): P[] {
  const L = pathLength(pts);
  if (L === 0) return [pts[0]];
  const step = L / (n - 1);
  const out: P[] = [pts[0]];
  let acc = 0;
  let prev = pts[0];
  for (let i = 1; i < pts.length; i++) {
    let cur = pts[i];
    let seg = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
    while (acc + seg >= step && seg > 0) {
      const t = (step - acc) / seg;
      const q: P = [prev[0] + (cur[0] - prev[0]) * t, prev[1] + (cur[1] - prev[1]) * t];
      out.push(q);
      prev = q;
      seg = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]);
      acc = 0;
    }
    acc += seg;
    prev = cur;
    cur = pts[i];
  }
  while (out.length < n) out.push(pts[pts.length - 1]);
  return out.slice(0, n);
}

function rdp(pts: P[], eps: number): P[] {
  if (pts.length < 3) return pts.slice();
  const [a, b] = [pts[0], pts[pts.length - 1]];
  let maxD = -1, idx = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = distToSegment(pts[i][0], pts[i][1], a[0], a[1], b[0], b[1]);
    if (d > maxD) {
      maxD = d;
      idx = i;
    }
  }
  if (maxD <= eps) return [a, b];
  const left = rdp(pts.slice(0, idx + 1), eps);
  const right = rdp(pts.slice(idx), eps);
  return [...left.slice(0, -1), ...right];
}

/** Interior angle at b (degrees, 0..180). */
function angleAt(a: P, b: P, c: P) {
  const v1x = a[0] - b[0], v1y = a[1] - b[1], v2x = c[0] - b[0], v2y = c[1] - b[1];
  const d = Math.hypot(v1x, v1y) * Math.hypot(v2x, v2y);
  if (!d) return 180;
  return Math.acos(Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / d))) * DEG;
}

function meanDistToPolygon(pts: P[], poly: P[]) {
  let sum = 0;
  for (const p of pts) {
    let best = Infinity;
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length];
      best = Math.min(best, distToSegment(p[0], p[1], a[0], a[1], b[0], b[1]));
    }
    sum += best;
  }
  return sum / pts.length;
}

// ---------- ellipse fit (PCA axes + extents) ----------

interface EllipseFit {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  angle: number; // radians
  error: number; // mean distance error, world units
}

function fitEllipse(pts: P[]): EllipseFit {
  const n = pts.length;
  let mx = 0, my = 0;
  for (const p of pts) {
    mx += p[0];
    my += p[1];
  }
  mx /= n;
  my /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of pts) {
    const dx = p[0] - mx, dy = p[1] - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const cos = Math.cos(angle), sin = Math.sin(angle);
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  const uv = pts.map((p) => {
    const dx = p[0] - mx, dy = p[1] - my;
    const u = dx * cos + dy * sin, v = -dx * sin + dy * cos;
    minU = Math.min(minU, u);
    maxU = Math.max(maxU, u);
    minV = Math.min(minV, v);
    maxV = Math.max(maxV, v);
    return [u, v] as P;
  });
  const cu = (minU + maxU) / 2, cv = (minV + maxV) / 2;
  // Average of extent-based and RMS-based radii is robust to small bumps.
  let su = 0, sv = 0;
  for (const [u, v] of uv) {
    su += (u - cu) ** 2;
    sv += (v - cv) ** 2;
  }
  const rx = ((maxU - minU) / 2 + Math.sqrt((2 * su) / n)) / 2;
  const ry = ((maxV - minV) / 2 + Math.sqrt((2 * sv) / n)) / 2;
  let err = 0;
  for (const [u, v] of uv) {
    const r = Math.hypot((u - cu) / Math.max(rx, 1e-6), (v - cv) / Math.max(ry, 1e-6));
    err += Math.abs(r - 1);
  }
  const error = (err / n) * Math.min(rx, ry);
  return { cx: mx + cu * cos - cv * sin, cy: my + cu * sin + cv * cos, rx, ry, angle, error };
}

// ---------- polygon fit ----------

function fitPolygon(closed: P[], diag: number): P[] {
  // Start at the point farthest from the centroid: it is almost always a corner.
  let cx = 0, cy = 0;
  for (const p of closed) {
    cx += p[0];
    cy += p[1];
  }
  cx /= closed.length;
  cy /= closed.length;
  let start = 0, far = -1;
  closed.forEach((p, i) => {
    const d = Math.hypot(p[0] - cx, p[1] - cy);
    if (d > far) {
      far = d;
      start = i;
    }
  });
  const loop = [...closed.slice(start), ...closed.slice(0, start)];
  loop.push(loop[0]);
  let verts = rdp(loop, diag * 0.055).slice(0, -1);

  // Merge near-duplicate vertices and drop near-straight ones until stable.
  for (let changed = true; changed && verts.length > 2; ) {
    changed = false;
    for (let i = 0; i < verts.length && verts.length > 3; i++) {
      const a = verts[(i - 1 + verts.length) % verts.length], b = verts[i], c = verts[(i + 1) % verts.length];
      if (Math.hypot(b[0] - c[0], b[1] - c[1]) < diag * 0.1 || angleAt(a, b, c) > 152) {
        verts.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return verts;
}

/** Snap near-horizontal / near-vertical edges exactly level (keeps everything else as drawn). */
function snapEdges(verts: P[], tolDeg = 7): P[] {
  const v = verts.map((p) => [p[0], p[1]] as P);
  for (let i = 0; i < v.length; i++) {
    const a = v[i], b = v[(i + 1) % v.length];
    const ang = Math.abs(Math.atan2(b[1] - a[1], b[0] - a[0]) * DEG) % 180;
    if (Math.min(ang, 180 - ang) < tolDeg) {
      const y = (a[1] + b[1]) / 2;
      a[1] = b[1] = y;
    } else if (Math.abs(ang - 90) < tolDeg) {
      const x = (a[0] + b[0]) / 2;
      a[0] = b[0] = x;
    }
  }
  return v;
}

function regularizeTriangle(verts: P[]): P[] {
  const v = snapEdges(verts);
  // Isosceles snap: apex roughly above/below the midpoint of a level base.
  for (let i = 0; i < 3; i++) {
    const a = v[i], b = v[(i + 1) % 3], apex = v[(i + 2) % 3];
    const width = Math.abs(b[0] - a[0]);
    if (a[1] === b[1] && width > 0 && Math.abs(apex[0] - (a[0] + b[0]) / 2) < width * 0.08) {
      apex[0] = (a[0] + b[0]) / 2;
    }
  }
  return v;
}

function rotatedRect(cx: number, cy: number, w: number, h: number, angle: number): P[] {
  const c = Math.cos(angle), s = Math.sin(angle);
  return ([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]] as P[]).map(
    ([x, y]) => [cx + x * c - y * s, cy + x * s + y * c] as P,
  );
}

function ellipsePolygon(f: EllipseFit, rx: number, ry: number, segments = 72): P[] {
  const c = Math.cos(f.angle), s = Math.sin(f.angle);
  const out: P[] = [];
  for (let i = 0; i < segments; i++) {
    const t = (i / segments) * Math.PI * 2;
    const x = Math.cos(t) * rx, y = Math.sin(t) * ry;
    out.push([f.cx + x * c - y * s, f.cy + x * s + y * c]);
  }
  return out;
}

/** Angle distance from the nearest multiple of 90° (degrees). */
function offAxis(angleRad: number) {
  const a = ((angleRad * DEG) % 90 + 90) % 90;
  return Math.min(a, 90 - a);
}

/**
 * @param minSize smallest bounding-box diagonal (world units) to consider — keeps
 *                handwriting such as "O" or "l" from turning into shapes.
 */
export function recognizeShape(stroke: StrokeElement, minSize = 24): BoardElement | null {
  if (stroke.highlighter) return null;
  const raw: P[] = stroke.points.map((p) => [p[0], p[1]]);
  if (raw.length < 6) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of raw) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const diag = Math.hypot(maxX - minX, maxY - minY);
  if (diag < minSize) return null; // dots, ticks, handwriting stay ink

  const L = pathLength(raw);
  const first = raw[0], last = raw[raw.length - 1];
  const endGap = Math.hypot(last[0] - first[0], last[1] - first[1]);
  const base = { id: newId(), color: stroke.color };
  const strokeWidth = Math.max(1.5, +(stroke.size * 0.8).toFixed(1));

  // ---- open stroke: straight line? ----
  if (endGap > Math.max(L * 0.2, diag * 0.3)) {
    if (endGap / L < 0.94) return null;
    const pts = resample(raw, 32);
    const maxDev = Math.max(...pts.map((p) => distToSegment(p[0], p[1], first[0], first[1], last[0], last[1])));
    if (maxDev > Math.max(endGap * 0.06, 4)) return null;
    let [x1, y1] = first, [x2, y2] = last;
    const ang = Math.atan2(y2 - y1, x2 - x1);
    if (offAxis(ang) < 4) {
      // Level / plumb lines.
      const a = Math.abs(ang * DEG) % 180;
      if (Math.min(a, 180 - a) < 4) y1 = y2 = (y1 + y2) / 2;
      else x1 = x2 = (x1 + x2) / 2;
    }
    return { ...base, type: 'line', x1, y1, x2, y2, strokeWidth };
  }

  // ---- closed stroke ----
  // Drop an overshooting tail: cut where the path comes back closest to its start.
  let cut = raw.length - 1, best = endGap;
  for (let i = Math.floor(raw.length * 0.7); i < raw.length; i++) {
    const d = Math.hypot(raw[i][0] - first[0], raw[i][1] - first[1]);
    if (d < best) {
      best = d;
      cut = i;
    }
  }
  const closed = resample(raw.slice(0, cut + 1), 96);

  const ell = fitEllipse(closed);
  const verts = fitPolygon(closed, diag);
  const polyErr = verts.length >= 3 ? meanDistToPolygon(closed, verts) : Infinity;
  const tol = diag * 0.035;

  const polygonWins = verts.length >= 3 && verts.length <= 6 && polyErr < tol && polyErr <= ell.error * 1.15;
  const ellipseWins = ell.error < tol * 1.1 && !polygonWins;

  if (ellipseWins) {
    let { rx, ry } = ell;
    if (Math.abs(rx - ry) / Math.max(rx, ry) < 0.12) {
      // Circle.
      const r = (rx + ry) / 2;
      return { ...base, type: 'ellipse', x: ell.cx - r, y: ell.cy - r, w: r * 2, h: r * 2, strokeWidth, fill: false };
    }
    if (offAxis(ell.angle) < 9) {
      // Axis-aligned ellipse; PCA angle near 90° swaps the radii.
      const a = ((ell.angle * DEG) % 180 + 180) % 180;
      if (Math.abs(a - 90) < 45) [rx, ry] = [ry, rx];
      return { ...base, type: 'ellipse', x: ell.cx - rx, y: ell.cy - ry, w: rx * 2, h: ry * 2, strokeWidth, fill: false };
    }
    return { ...base, type: 'polygon', points: ellipsePolygon(ell, rx, ry), strokeWidth, fill: false };
  }

  if (!polygonWins) return null;

  const n = verts.length;
  if (n === 3) {
    return { ...base, type: 'polygon', points: regularizeTriangle(verts), strokeWidth, fill: false };
  }

  if (n === 4) {
    const angles = verts.map((v, i) => angleAt(verts[(i + 3) % 4], v, verts[(i + 1) % 4]));
    const edge = (i: number) => Math.hypot(verts[(i + 1) % 4][0] - verts[i][0], verts[(i + 1) % 4][1] - verts[i][1]);

    // Diamond: diagonals roughly horizontal and vertical (checked before rectangles,
    // since a diamond drawn from a square is also a 45°-rotated rectangle).
    const diagAng = (i: number) => Math.atan2(verts[i + 2][1] - verts[i][1], verts[i + 2][0] - verts[i][0]);
    if (offAxis(diagAng(0)) < 12 && offAxis(diagAng(1)) < 12) {
      const xs = verts.map((v) => v[0]), ys = verts.map((v) => v[1]);
      const l = Math.min(...xs), r = Math.max(...xs), t = Math.min(...ys), b = Math.max(...ys);
      const cx = (l + r) / 2, cy = (t + b) / 2;
      return { ...base, type: 'polygon', points: [[cx, t], [r, cy], [cx, b], [l, cy]], strokeWidth, fill: false };
    }

    // Rectangle (any rotation).
    if (angles.every((a) => Math.abs(a - 90) < 16)) {
      let w = (edge(0) + edge(2)) / 2, h = (edge(1) + edge(3)) / 2;
      if (Math.abs(w - h) / Math.max(w, h) < 0.08) w = h = (w + h) / 2; // square
      // Rotation: average direction of the two "horizontal-ish" edges.
      const dir = (i: number) => Math.atan2(verts[(i + 1) % 4][1] - verts[i][1], verts[(i + 1) % 4][0] - verts[i][0]);
      let a = dir(0);
      const opp = dir(2) + Math.PI;
      const diff = Math.atan2(Math.sin(opp - a), Math.cos(opp - a));
      a += diff / 2;
      const cx = verts.reduce((s, v) => s + v[0], 0) / 4, cy = verts.reduce((s, v) => s + v[1], 0) / 4;
      if (offAxis(a) < 8) {
        // Axis-aligned: width/height measured along screen axes.
        const deg = ((a * DEG) % 180 + 180) % 180;
        if (Math.abs(deg - 90) < 45) [w, h] = [h, w];
        return { ...base, type: 'rect', x: cx - w / 2, y: cy - h / 2, w, h, strokeWidth, fill: false };
      }
      return { ...base, type: 'polygon', points: rotatedRect(cx, cy, w, h, a), strokeWidth, fill: false };
    }

    // Trapezoid / parallelogram / irregular quad: keep as drawn, level the edges.
    return { ...base, type: 'polygon', points: snapEdges(verts), strokeWidth, fill: false };
  }

  // Pentagon / hexagon.
  return { ...base, type: 'polygon', points: snapEdges(verts), strokeWidth, fill: false };
}
