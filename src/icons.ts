import type { BoardElement, Vec } from './types';
import { newId, screenToWorld } from './geometry';
import { setElements, useBoard } from './store';
import { measureText } from './text';
import { viewportCenter } from './actions';

export interface IconSetInfo {
  id: string;
  name: string;
  count: number;
  categories: string[];
  source: string;
  license: string;
  file: string;
}

export interface LibraryIcon {
  id: string;
  name: string;
  category: string;
  svg: string;
  /** The artwork already spells out the product name (e.g. SAP lockups), so no label is added. */
  wordmark?: boolean;
}

export const ICON_DRAG_MIME = 'application/x-whiteboard-icon';

const base = import.meta.env.BASE_URL;
let indexPromise: Promise<IconSetInfo[]> | null = null;
const setCache = new Map<string, Promise<LibraryIcon[]>>();

export function loadIconIndex(): Promise<IconSetInfo[]> {
  indexPromise ??= fetch(`${base}icons/index.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json();
    })
    .then((j: { sets: IconSetInfo[] }) => j.sets)
    .catch((e) => {
      indexPromise = null;
      throw e;
    });
  return indexPromise;
}

export function loadIconSet(info: IconSetInfo): Promise<LibraryIcon[]> {
  let p = setCache.get(info.id);
  if (!p) {
    p = fetch(`${base}icons/${info.file}`)
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((j: { icons: LibraryIcon[] }) => j.icons)
      .catch((e) => {
        setCache.delete(info.id);
        throw e;
      });
    setCache.set(info.id, p);
  }
  return p;
}

/** Aspect ratio from the root <svg>'s viewBox (or width/height). */
function svgAspect(svg: string): number {
  const head = svg.slice(0, svg.indexOf('>') + 1);
  const vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(head);
  if (vb) return +vb[1] / +vb[2] || 1;
  const w = /\swidth\s*=\s*["']([\d.]+)/i.exec(head), h = /\sheight\s*=\s*["']([\d.]+)/i.exec(head);
  return w && h ? +w[1] / +h[1] || 1 : 1;
}

const previewCache = new Map<string, string>();

/** Data URL used for both the panel preview and the board element. */
export function iconDataUrl(icon: LibraryIcon): string {
  let url = previewCache.get(icon.id);
  if (!url) {
    // Give the SVG an explicit, generous intrinsic size so every browser can rasterize it crisply.
    const aspect = svgAspect(icon.svg);
    const w = aspect >= 1 ? 256 : Math.round(256 * aspect);
    const h = aspect >= 1 ? Math.round(256 / aspect) : 256;
    const svg = icon.svg.replace(/<svg\b([^>]*)>/i, (_m, attrs: string) => {
      const cleaned = attrs.replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*')/gi, '');
      const ns = /xmlns=/.test(cleaned) ? '' : ' xmlns="http://www.w3.org/2000/svg"';
      return `<svg${cleaned}${ns} width="${w}" height="${h}">`;
    });
    url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    previewCache.set(icon.id, url);
  }
  return url;
}

export interface IconPayload {
  name: string;
  src: string;
  aspect: number;
  wordmark?: boolean;
}

export function iconPayload(icon: LibraryIcon): IconPayload {
  return { name: icon.name, src: iconDataUrl(icon), aspect: svgAspect(icon.svg), wordmark: icon.wordmark };
}

/** Insert an icon (optionally with its product name underneath) at a world point. */
export function insertIcon(p: IconPayload, at?: Vec, withLabel = true) {
  const s = useBoard.getState();
  const z = s.camera.z;
  const c = at ?? screenToWorld(viewportCenter(), s.camera);
  // Same visual area for square icons and wide wordmarks (a 5:1 logo becomes ~143×29, not 64×13).
  const size = 64 / z;
  // Extreme ratios are capped for sizing only; the artwork keeps its true proportions.
  const a = p.aspect || 1;
  // Wordmarks (SAP lockups) share one height so their lettering matches, however long the name.
  const w = p.wordmark ? (28 / z) * a : a >= 1 ? size * Math.sqrt(Math.min(a, 6)) : (size / Math.sqrt(Math.max(a, 1 / 6))) * a;
  const h = w / a;
  const image: BoardElement = { id: newId(), type: 'image', color: '', x: c.x - w / 2, y: c.y - h / 2, w, h, src: p.src };
  const els: BoardElement[] = [image];
  if (withLabel && !p.wordmark) {
    const fontSize = 14 / z;
    const m = measureText(p.name, fontSize);
    els.push({
      id: newId(),
      type: 'text',
      color: '#1e1e1e',
      x: c.x - m.w / 2,
      y: image.y + h + 6 / z,
      text: p.name,
      fontSize,
      align: 'center',
      attachedTo: image.id, // follows the icon; can still be dragged on its own
      ...m,
    });
  }
  setElements([...s.elements, ...els]);
  useBoard.setState({ tool: 'select', selectedIds: [image.id] });
}
