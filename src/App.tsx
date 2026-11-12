import { useEffect, useState } from 'react';
import { Canvas } from './components/Canvas';
import { TextEditor } from './components/TextEditor';
import { Toolbar } from './components/Toolbar';
import { PropertiesPanel } from './components/PropertiesPanel';
import { ActionBar, HelpDialog, Toasts, TopBar, ZoomControls } from './components/Chrome';
import { IconLibrary } from './components/IconLibrary';
import { ErrorBoundary } from './components/ErrorBoundary';
import {
  bringToFront,
  deleteSelected,
  finishEditing,
  formatTargets,
  redo,
  selectAll,
  sendToBack,
  setSelection,
  setTool,
  toast,
  toggleFormat,
  undo,
  useBoard,
} from './store';
import { openBoard, restoreAutosave, saveBoard, startAutosave } from './persistence';
import { copySelection, cutSelection, duplicateSelected, handlePaste, nudgeSelected, resetZoom, zoomBy, zoomToFit } from './actions';
import type { Tool } from './types';

const TOOL_KEYS: Record<string, Tool> = {
  v: 'select',
  h: 'hand',
  p: 'pen',
  m: 'highlighter',
  e: 'eraser',
  k: 'laser',
  t: 'text',
  n: 'sticky',
  r: 'rect',
  o: 'ellipse',
  l: 'line',
  a: 'arrow',
};

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

function useShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // F1 = help, from anywhere (and instead of the browser's own help page).
      if (e.key === 'F1') {
        e.preventDefault();
        useBoard.setState({ helpOpen: !useBoard.getState().helpOpen });
        return;
      }
      if (isTyping(e.target)) return;
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      const s = useBoard.getState();

      if (mod) {
        const handled = () => e.preventDefault();
        if (key === 'z' && !e.shiftKey) return handled(), undo();
        if (key === 'y' || (key === 'z' && e.shiftKey)) return handled(), redo();
        if (key === 's') return handled(), saveBoard(e.shiftKey);
        if (key === 'o') return handled(), openBoard();
        if (key === 'a') return handled(), selectAll();
        if (key === 'd') return handled(), duplicateSelected();
        // Bold / italic / underline for selected text & notes (also overrides Ctrl+U "view source").
        if ((key === 'b' || key === 'i' || key === 'u') && formatTargets().length) {
          return handled(), toggleFormat(key === 'b' ? 'bold' : key === 'i' ? 'italic' : 'underline');
        }
        if (key === '=' || key === '+') return handled(), zoomBy(1.25);
        if (key === '-') return handled(), zoomBy(1 / 1.25);
        if (key === '0') return handled(), resetZoom();
        return; // let copy/cut/paste fire their native events
      }
      if (e.altKey) return;

      if (key === ' ') {
        e.preventDefault();
        if (!s.spaceDown) useBoard.setState({ spaceDown: true });
        return;
      }
      if (key === 'escape') {
        if (s.helpOpen) return useBoard.setState({ helpOpen: false });
        if (s.libraryOpen) return useBoard.setState({ libraryOpen: false });
        finishEditing();
        setSelection([]);
        return;
      }
      if (key === 'delete' || key === 'backspace') return e.preventDefault(), deleteSelected();
      if (key.startsWith('arrow') && s.selectedIds.length) {
        e.preventDefault();
        const step = (e.shiftKey ? 10 : 1) / s.camera.z;
        const d = { arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, -step], arrowdown: [0, step] }[key];
        if (d) nudgeSelected(d[0], d[1]);
        return;
      }
      if (key === '+' || key === '=') return zoomBy(1.25);
      if (key === '-' || key === '_') return zoomBy(1 / 1.25);
      if (key === '0') return resetZoom();
      if (key === '1') return zoomToFit();
      if (key === '[') return sendToBack();
      if (key === ']') return bringToFront();
      if (key === 'g') return useBoard.setState({ showGrid: !s.showGrid });
      if (key === 'i') {
        e.preventDefault(); // otherwise the "i" lands in the library's freshly focused search box
        return useBoard.setState({ libraryOpen: !s.libraryOpen });
      }
      if (key === '?') return useBoard.setState({ helpOpen: true });
      if (key === 'f') {
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen?.().catch(() => undefined);
        return;
      }
      const tool = TOOL_KEYS[key];
      if (tool && !e.shiftKey) setTool(tool);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') useBoard.setState({ spaceDown: false });
    };
    const onBlur = () => useBoard.setState({ spaceDown: false });

    const onCopy = (e: ClipboardEvent) => !isTyping(e.target) && copySelection(e);
    const onCut = (e: ClipboardEvent) => !isTyping(e.target) && cutSelection(e);
    const onPaste = (e: ClipboardEvent) => !isTyping(e.target) && handlePaste(e);

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    document.addEventListener('copy', onCopy);
    document.addEventListener('cut', onCut);
    document.addEventListener('paste', onPaste);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('cut', onCut);
      document.removeEventListener('paste', onPaste);
    };
  }, []);
}

export default function App() {
  const [ready, setReady] = useState(false);
  const libraryOpen = useBoard((s) => s.libraryOpen);
  useShortcuts();

  // Restore the last session, then autosave every change to this browser.
  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    restoreAutosave().then((restored) => {
      if (cancelled) return;
      if (restored) toast('Restored your last session');
      stop = startAutosave();
      setReady(true);
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  return (
    <div className={`app${ready ? ' ready' : ''}`}>
      <Canvas />
      <TextEditor />
      <TopBar />
      <ActionBar />
      <div className="bottom-dock">
        <PropertiesPanel />
        <Toolbar />
      </div>
      <ZoomControls />
      {libraryOpen && (
        <ErrorBoundary>
          <IconLibrary onClose={() => useBoard.setState({ libraryOpen: false })} />
        </ErrorBoundary>
      )}
      <HelpDialog />
      <Toasts />
    </div>
  );
}
