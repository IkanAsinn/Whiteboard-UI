export const FONT_FAMILY =
  'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
export const LINE_HEIGHT = 1.25;
export const STICKY_PADDING = 14;
export const STICKY_SIZE = 200;

let measureCtx: CanvasRenderingContext2D | null = null;
function ctx(): CanvasRenderingContext2D {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d')!;
  return measureCtx;
}

/** Formatting that changes glyph metrics (underline doesn't). */
export interface FontStyle {
  bold?: boolean;
  italic?: boolean;
}

export function fontString(size: number, style?: FontStyle): string {
  return `${style?.italic ? 'italic ' : ''}${style?.bold ? 700 : 400} ${size}px ${FONT_FAMILY}`;
}

/** Size of free text (no wrapping, explicit newlines only). */
export function measureText(text: string, fontSize: number, style?: FontStyle): { w: number; h: number } {
  const c = ctx();
  c.font = fontString(fontSize, style);
  const lines = text.split('\n');
  let w = 0;
  for (const line of lines) w = Math.max(w, c.measureText(line).width);
  // Italic glyphs lean past their advance width; leave a little room.
  if (style?.italic) w += fontSize * 0.15;
  return { w: Math.max(w, fontSize * 0.6), h: lines.length * fontSize * LINE_HEIGHT };
}

/** Word-wrap text to a maximum width. */
export function wrapText(text: string, fontSize: number, maxWidth: number, style?: FontStyle): string[] {
  const c = ctx();
  c.font = fontString(fontSize, style);
  const out: string[] = [];
  for (const paragraph of text.split('\n')) {
    const words = paragraph.split(/(\s+)/);
    let line = '';
    for (const word of words) {
      const candidate = line + word;
      if (c.measureText(candidate).width <= maxWidth || line === '') {
        // A single word longer than the line: break it by characters.
        if (line === '' && c.measureText(word).width > maxWidth) {
          let chunk = '';
          for (const ch of word) {
            if (c.measureText(chunk + ch).width > maxWidth && chunk) {
              out.push(chunk);
              chunk = ch;
            } else chunk += ch;
          }
          line = chunk;
        } else line = candidate;
      } else {
        out.push(line.trimEnd());
        line = word.trimStart();
      }
    }
    out.push(line.trimEnd());
  }
  return out;
}

const fitCache = new Map<string, { fontSize: number; lines: string[] }>();

/** Largest font size (24 → 10) at which the sticky note text fits inside the note. */
export function fitStickyText(text: string, w: number, h: number, style?: FontStyle) {
  const key = `${w.toFixed(1)}|${h.toFixed(1)}|${style?.bold ? 'b' : ''}${style?.italic ? 'i' : ''}|${text}`;
  const cached = fitCache.get(key);
  if (cached) return cached;
  const innerW = Math.max(10, w - STICKY_PADDING * 2);
  const innerH = Math.max(10, h - STICKY_PADDING * 2);
  const scale = Math.min(w, h) / STICKY_SIZE;
  const max = Math.max(10, Math.round(24 * scale));
  const min = Math.max(4, Math.round(9 * scale));
  let result = { fontSize: min, lines: wrapText(text, min, innerW, style) };
  for (let size = max; size >= min; size -= 1) {
    const lines = wrapText(text, size, innerW, style);
    if (lines.length * size * LINE_HEIGHT <= innerH) {
      result = { fontSize: size, lines };
      break;
    }
  }
  if (fitCache.size > 500) fitCache.clear();
  fitCache.set(key, result);
  return result;
}
