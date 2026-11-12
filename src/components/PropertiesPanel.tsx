import { Bold, BringToFront, Copy, Italic, PaintBucket, SendToBack, Trash, Underline, Wand } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { MOD } from './Chrome';
import {
  formatTargets,
  toggleFormat,
  type FormatKey,
  HIGHLIGHTER_COLORS,
  PEN_COLORS,
  SIZES,
  STICKY_COLORS,
  bringToFront,
  deleteSelected,
  recolorSelected,
  sendToBack,
  setElements,
  setStyle,
  useBoard,
  type StyleKey,
} from '../store';
import { duplicateSelected } from '../actions';
import type { BoardElement, Tool } from '../types';

const STYLE_FOR_TOOL: Partial<Record<Tool, StyleKey>> = {
  pen: 'pen',
  highlighter: 'highlighter',
  rect: 'shape',
  ellipse: 'shape',
  line: 'shape',
  arrow: 'shape',
  text: 'text',
  sticky: 'sticky',
};

function paletteFor(key: StyleKey) {
  if (key === 'highlighter') return HIGHLIGHTER_COLORS;
  if (key === 'sticky') return STICKY_COLORS;
  return PEN_COLORS;
}

function Swatches({ colors, value, onPick }: { colors: string[]; value?: string; onPick: (c: string) => void }) {
  return (
    <div className="swatches" role="radiogroup" aria-label="Color">
      {colors.map((c) => (
        <button
          key={c}
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          className={`swatch${value === c ? ' active' : ''}`}
          style={{ '--swatch': c } as React.CSSProperties}
          onClick={() => onPick(c)}
        />
      ))}
    </div>
  );
}

function Sizes({ sizes, value, onPick, kind }: { sizes: number[]; value: number; onPick: (n: number) => void; kind: StyleKey }) {
  if (!sizes.length) return null;
  const max = Math.max(...sizes);
  return (
    <div className="sizes" role="radiogroup" aria-label="Size">
      {sizes.map((n) => (
        <button
          key={n}
          role="radio"
          aria-checked={value === n}
          className={`size-btn${value === n ? ' active' : ''}`}
          onClick={() => onPick(n)}
          title={kind === 'text' ? `${n}px` : `${n}`}
        >
          {kind === 'text' ? (
            <span style={{ fontSize: 9 + (n / max) * 9, fontWeight: 600 }}>A</span>
          ) : (
            <span className="dot" style={{ width: 3 + (n / max) * 15, height: 3 + (n / max) * 15 }} />
          )}
        </button>
      ))}
    </div>
  );
}

const Sep = () => <span className="panel-sep" aria-hidden />;

const FORMATS: { key: FormatKey; label: string; shortcut: string; icon: React.ReactNode }[] = [
  { key: 'bold', label: 'Bold', shortcut: 'B', icon: <Bold size={17} strokeWidth={2.5} /> },
  { key: 'italic', label: 'Italic', shortcut: 'I', icon: <Italic size={17} /> },
  { key: 'underline', label: 'Underline', shortcut: 'U', icon: <Underline size={17} /> },
];

/** B / I / U toggles: act on the text being edited, the selected text/notes, or the defaults for new text. */
function FormatButtons() {
  const targets = useBoard(useShallow((s) => formatTargets(s)));
  const defaults = useBoard((s) => s.textFormat);
  return (
    <div className="format-group" role="group" aria-label="Text format">
      {FORMATS.map((f) => {
        const active = targets.length
          ? targets.every((e) => (e.type === 'text' || e.type === 'sticky') && !!e[f.key])
          : !!defaults[f.key];
        return (
          <button
            key={f.key}
            className={`icon-btn${active ? ' active' : ''}`}
            onClick={() => toggleFormat(f.key)}
            title={`${f.label} (${MOD}+${f.shortcut})`}
            aria-label={f.label}
            aria-pressed={active}
          >
            {f.icon}
          </button>
        );
      })}
    </div>
  );
}

function SelectionPanel({ selected }: { selected: BoardElement[] }) {
  const inkEls = selected.filter((e) => e.type !== 'sticky' && e.type !== 'image');
  const stickies = selected.filter((e) => e.type === 'sticky');
  const fillable = selected.filter((e) => e.type === 'rect' || e.type === 'ellipse' || e.type === 'polygon');
  const common = (els: BoardElement[]) => (els.length && els.every((e) => e.color === els[0].color) ? els[0].color : undefined);
  const allFilled = fillable.length > 0 && fillable.every((e) => 'fill' in e && e.fill);
  const hasText = selected.some((e) => e.type === 'text' || e.type === 'sticky');

  const toggleFill = () => {
    const ids = new Set(fillable.map((e) => e.id));
    setElements(
      useBoard.getState().elements.map((e) =>
        ids.has(e.id) && (e.type === 'rect' || e.type === 'ellipse' || e.type === 'polygon') ? { ...e, fill: !allFilled } : e,
      ),
    );
  };

  return (
    <>
      {inkEls.length > 0 && <Swatches colors={PEN_COLORS} value={common(inkEls)} onPick={(c) => recolorSelected(c, 'ink')} />}
      {stickies.length > 0 && (
        <>
          {inkEls.length > 0 && <Sep />}
          <Swatches colors={STICKY_COLORS} value={common(stickies)} onPick={(c) => recolorSelected(c, 'sticky')} />
        </>
      )}
      {fillable.length > 0 && (
        <button className={`icon-btn${allFilled ? ' active' : ''}`} onClick={toggleFill} title="Fill shape" aria-pressed={allFilled}>
          <PaintBucket size={18} />
        </button>
      )}
      {hasText && (
        <>
          <Sep />
          <FormatButtons />
        </>
      )}
      {(inkEls.length > 0 || stickies.length > 0) && <Sep />}
      <button className="icon-btn" onClick={duplicateSelected} title="Duplicate (Ctrl+D)">
        <Copy size={18} />
      </button>
      <button className="icon-btn" onClick={bringToFront} title="Bring to front (])">
        <BringToFront size={18} />
      </button>
      <button className="icon-btn" onClick={sendToBack} title="Send to back ([)">
        <SendToBack size={18} />
      </button>
      <button className="icon-btn danger" onClick={deleteSelected} title="Delete (Del)">
        <Trash size={18} />
      </button>
    </>
  );
}

export function PropertiesPanel() {
  const tool = useBoard((s) => s.tool);
  const styles = useBoard((s) => s.styles);
  const shapeFill = useBoard((s) => s.shapeFill);
  const autoShape = useBoard((s) => s.autoShape);
  const selectedIds = useBoard((s) => s.selectedIds);
  const elements = useBoard((s) => s.elements);
  const editing = useBoard((s) => s.editingId);

  let content: React.ReactNode = null;
  const editingEl = editing ? elements.find((e) => e.id === editing) : undefined;
  if (editingEl && (editingEl.type === 'text' || editingEl.type === 'sticky')) {
    // While typing: format the box being edited (and recolor free text).
    content = (
      <>
        {editingEl.type === 'text' && (
          <>
            <Swatches
              colors={PEN_COLORS}
              value={editingEl.color}
              onPick={(color) =>
                setElements(
                  useBoard.getState().elements.map((e) => (e.id === editingEl.id ? { ...e, color } : e)),
                  false,
                )
              }
            />
            <Sep />
          </>
        )}
        <FormatButtons />
      </>
    );
  } else if (tool === 'select' && selectedIds.length && !editing) {
    const ids = new Set(selectedIds);
    content = <SelectionPanel selected={elements.filter((e) => ids.has(e.id))} />;
  } else {
    const key = STYLE_FOR_TOOL[tool];
    if (key) {
      const style = styles[key];
      content = (
        <>
          <Swatches colors={paletteFor(key)} value={style.color} onPick={(color) => setStyle(key, { color })} />
          {SIZES[key].length > 0 && <Sep />}
          <Sizes sizes={SIZES[key]} value={style.size} onPick={(size) => setStyle(key, { size })} kind={key} />
          {(key === 'text' || key === 'sticky') && (
            <>
              <Sep />
              <FormatButtons />
            </>
          )}
          {key === 'shape' && (tool === 'rect' || tool === 'ellipse') && (
            <button
              className={`icon-btn${shapeFill ? ' active' : ''}`}
              onClick={() => useBoard.setState({ shapeFill: !shapeFill })}
              title="Fill shape"
              aria-pressed={shapeFill}
            >
              <PaintBucket size={18} />
            </button>
          )}
          {tool === 'pen' && (
            <>
              <Sep />
              <button
                className={`chip-toggle${autoShape ? ' active' : ''}`}
                onClick={() => useBoard.setState({ autoShape: !autoShape })}
                title="Turn hand-drawn circles, boxes, triangles and lines into clean shapes"
                aria-pressed={autoShape}
              >
                <Wand size={16} /> Shapes
              </button>
            </>
          )}
        </>
      );
    }
  }

  if (!content) return null;
  return (
    <div
      className="props panel"
      onPointerDown={(e) => e.stopPropagation()}
      // Keep focus in the text being edited when clicking B / I / U or a color.
      onMouseDown={(e) => e.preventDefault()}
    >
      {content}
    </div>
  );
}
