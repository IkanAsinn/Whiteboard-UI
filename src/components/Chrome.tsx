import { useEffect, useRef, useState } from 'react';
import {
  Download,
  Expand,
  FilePlus,
  FolderOpen,
  Grid3x3,
  Keyboard,
  Menu,
  Redo2,
  Save,
  SaveAll,
  Scan,
  Shrink,
  Undo2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { isDirty, redo, undo, useBoard } from '../store';
import { exportPng, newBoard, openBoard, saveBoard, supportsFileSystemAccess } from '../persistence';
import { resetZoom, zoomBy, zoomToFit } from '../actions';
import { Keys } from './Keys';

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? '⌘' : 'Ctrl';

// ---------- top-left: menu + document status ----------

export function TopBar() {
  const [open, setOpen] = useState(false);
  const fileName = useBoard((s) => s.fileName);
  const dirty = useBoard(isDirty);
  const hasSelection = useBoard((s) => s.selectedIds.length > 0);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);

  const run = (fn: () => unknown) => () => {
    setOpen(false);
    fn();
  };

  return (
    <div className="topbar" ref={ref}>
      <div className="panel title-chip">
        <button className="icon-btn" onClick={() => setOpen(!open)} aria-haspopup="menu" aria-expanded={open} title="Menu">
          <Menu size={18} />
        </button>
        <div className="doc-title">
          <span className="doc-name">{fileName ?? 'Untitled board'}</span>
          <span className={`doc-status${dirty ? ' dirty' : ''}`}>
            {dirty ? 'Not saved to a file · kept in this browser' : 'Saved'}
          </span>
        </div>
      </div>
      {open && (
        <div className="menu panel" role="menu">
          <button role="menuitem" onClick={run(newBoard)}>
            <FilePlus size={16} /> New board
          </button>
          <button role="menuitem" onClick={run(openBoard)}>
            <FolderOpen size={16} /> Open… <Keys small combos={[['Mod', 'O']]} />
          </button>
          <button role="menuitem" onClick={run(() => saveBoard(false))}>
            <Save size={16} /> {supportsFileSystemAccess ? 'Save' : 'Download'} <Keys small combos={[['Mod', 'S']]} />
          </button>
          {supportsFileSystemAccess && (
            <button role="menuitem" onClick={run(() => saveBoard(true))}>
              <SaveAll size={16} /> Save as… <Keys small combos={[['Mod', 'Shift', 'S']]} />
            </button>
          )}
          <hr />
          <button role="menuitem" onClick={run(() => exportPng(false))}>
            <Download size={16} /> Export board as PNG
          </button>
          {hasSelection && (
            <button role="menuitem" onClick={run(() => exportPng(true))}>
              <Download size={16} /> Export selection as PNG
            </button>
          )}
          <hr />
          <button role="menuitem" onClick={run(() => useBoard.setState({ helpOpen: true }))}>
            <Keyboard size={16} /> Keyboard shortcuts <Keys small combos={[['F1']]} />
          </button>
          <p className="menu-note">
            Boards never leave your device. Changes are kept in this browser automatically; save to a
            <code>.whiteboard</code> file to keep or share them.
          </p>
        </div>
      )}
    </div>
  );
}

// ---------- top-right: history + view toggles ----------

export function ActionBar() {
  const canUndo = useBoard((s) => s.past.length > 0 || s.pending !== null);
  const canRedo = useBoard((s) => s.future.length > 0);
  const showGrid = useBoard((s) => s.showGrid);
  const [fullscreen, setFullscreen] = useState(!!document.fullscreenElement);

  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  return (
    <div className="actionbar panel">
      <button className="icon-btn" onClick={undo} disabled={!canUndo} title={`Undo (${MOD}+Z)`} aria-label="Undo">
        <Undo2 size={18} />
      </button>
      <button className="icon-btn" onClick={redo} disabled={!canRedo} title={`Redo (${MOD}+Shift+Z)`} aria-label="Redo">
        <Redo2 size={18} />
      </button>
      <span className="panel-sep" />
      <button
        className={`icon-btn${showGrid ? ' active' : ''}`}
        onClick={() => useBoard.setState({ showGrid: !showGrid })}
        title="Dot grid (G)"
        aria-pressed={showGrid}
      >
        <Grid3x3 size={18} />
      </button>
      {document.fullscreenEnabled && (
        <button
          className="icon-btn"
          onClick={() => (fullscreen ? document.exitFullscreen() : document.documentElement.requestFullscreen())}
          title="Present full screen (F)"
        >
          {fullscreen ? <Shrink size={18} /> : <Expand size={18} />}
        </button>
      )}
    </div>
  );
}

// ---------- bottom-right: zoom ----------

export function ZoomControls() {
  const z = useBoard((s) => s.camera.z);
  return (
    <div className="zoom panel">
      <button className="icon-btn" onClick={() => zoomBy(1 / 1.25)} title="Zoom out (-)" aria-label="Zoom out">
        <ZoomOut size={18} />
      </button>
      <button className="zoom-value" onClick={resetZoom} title="Reset to 100% (0)">
        {Math.round(z * 100)}%
      </button>
      <button className="icon-btn" onClick={() => zoomBy(1.25)} title="Zoom in (+)" aria-label="Zoom in">
        <ZoomIn size={18} />
      </button>
      <button className="icon-btn" onClick={zoomToFit} title="Fit to content (1)" aria-label="Fit to content">
        <Scan size={18} />
      </button>
    </div>
  );
}

// ---------- toasts ----------

export function Toasts() {
  const toasts = useBoard((s) => s.toasts);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className="toast">
          {t.message}
        </div>
      ))}
    </div>
  );
}

// ---------- help ----------

/** [description, alternatives of key combos]. "Mod" = Ctrl (⌘ on Mac); "~text" = mouse/touch action. */
type Shortcut = [string, string[][]];

const SHORTCUT_SECTIONS: { title: string; items: Shortcut[] }[] = [
  {
    title: 'Tools',
    items: [
      ['Select', [['V']]],
      ['Pan', [['H']]],
      ['Pen', [['P']]],
      ['Highlighter', [['M']]],
      ['Eraser', [['E']]],
      ['Laser pointer', [['K']]],
      ['Text', [['T']]],
      ['Sticky note', [['N']]],
      ['Rectangle', [['R']]],
      ['Ellipse', [['O']]],
      ['Line', [['L']]],
      ['Arrow', [['A']]],
      ['Icon library', [['I']]],
    ],
  },
  {
    title: 'Navigate',
    items: [
      ['Pan the board', [['Space', '~drag'], ['~middle-drag']]],
      ['Scroll', [['~wheel']]],
      ['Scroll sideways', [['Shift', '~wheel']]],
      ['Zoom', [['Mod', '~wheel'], ['~pinch']]],
      ['Zoom in / out', [['+'], ['−']]],
      ['Zoom to 100%', [['0']]],
      ['Fit to content', [['1']]],
      ['Full screen', [['F']]],
      ['Dot grid', [['G']]],
    ],
  },
  {
    title: 'Edit',
    items: [
      ['Undo', [['Mod', 'Z']]],
      ['Redo', [['Mod', 'Shift', 'Z'], ['Mod', 'Y']]],
      ['Copy', [['Mod', 'C']]],
      ['Cut', [['Mod', 'X']]],
      ['Paste (also images)', [['Mod', 'V']]],
      ['Duplicate', [['Mod', 'D']]],
      ['Select all', [['Mod', 'A']]],
      ['Delete', [['Delete'], ['Backspace']]],
      ['Nudge', [['Arrows']]],
      ['Nudge 10×', [['Shift', 'Arrows']]],
      ['Bring to front', [[']']]],
      ['Send to back', [['[']]],
      ['Square / circle / 45°', [['Shift', '~drag']]],
      ['Deselect / close', [['Escape']]],
    ],
  },
  {
    title: 'Text',
    items: [
      ['Edit text or note', [['~double-click']]],
      ['Bold', [['Mod', 'B']]],
      ['Italic', [['Mod', 'I']]],
      ['Underline', [['Mod', 'U']]],
      ['Finish editing', [['Escape'], ['Mod', 'Enter']]],
    ],
  },
  {
    title: 'File',
    items: [
      ['Save', [['Mod', 'S']]],
      ['Save as', [['Mod', 'Shift', 'S']]],
      ['Open', [['Mod', 'O']]],
      ['This help', [['F1'], ['?']]],
    ],
  },
];

export function HelpDialog() {
  const open = useBoard((s) => s.helpOpen);
  if (!open) return null;
  const close = () => useBoard.setState({ helpOpen: false });
  return (
    <div className="modal-backdrop" onPointerDown={close}>
      <div className="modal panel" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onPointerDown={(e) => e.stopPropagation()}>
        <header>
          <h2>Keyboard shortcuts</h2>
          <button className="icon-btn" onClick={close} aria-label="Close">
            <X size={18} />
          </button>
        </header>
        <div className="shortcut-sections">
          {SHORTCUT_SECTIONS.map((section) => (
            <section key={section.title}>
              <h3>{section.title}</h3>
              <dl className="shortcuts">
                {section.items.map(([label, combos]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>
                      <Keys combos={combos} />
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
        <p className="modal-note">
          Pen tip: with <strong>Shapes</strong> on, a hand-drawn circle, ellipse, box, triangle, diamond or straight line
          snaps to a clean shape that keeps the size and angle you drew. Turn it off in the pen options.
        </p>
      </div>
    </div>
  );
}
