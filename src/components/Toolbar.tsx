import type { ReactNode } from 'react';
import {
  ArrowUpRight,
  Circle,
  Eraser,
  Hand,
  Highlighter,
  ImagePlus,
  Minus,
  MousePointer2,
  PenLine,
  Shapes,
  Square,
  StickyNote,
  Type,
  Zap,
} from 'lucide-react';
import type { Tool } from '../types';
import { setTool, useBoard } from '../store';
import { pickFile } from '../persistence';
import { addImageFile } from '../actions';

interface ToolDef {
  tool: Tool;
  label: string;
  key: string;
  icon: ReactNode;
}

const S = 20;
export const TOOL_GROUPS: ToolDef[][] = [
  [
    { tool: 'select', label: 'Select', key: 'V', icon: <MousePointer2 size={S} /> },
    { tool: 'hand', label: 'Pan', key: 'H', icon: <Hand size={S} /> },
  ],
  [
    { tool: 'pen', label: 'Pen', key: 'P', icon: <PenLine size={S} /> },
    { tool: 'highlighter', label: 'Highlighter', key: 'M', icon: <Highlighter size={S} /> },
    { tool: 'eraser', label: 'Eraser', key: 'E', icon: <Eraser size={S} /> },
    { tool: 'laser', label: 'Laser pointer', key: 'K', icon: <Zap size={S} /> },
  ],
  [
    { tool: 'text', label: 'Text', key: 'T', icon: <Type size={S} /> },
    { tool: 'sticky', label: 'Sticky note', key: 'N', icon: <StickyNote size={S} /> },
  ],
  [
    { tool: 'rect', label: 'Rectangle', key: 'R', icon: <Square size={S} /> },
    { tool: 'ellipse', label: 'Ellipse', key: 'O', icon: <Circle size={S} /> },
    { tool: 'line', label: 'Line', key: 'L', icon: <Minus size={S} /> },
    { tool: 'arrow', label: 'Arrow', key: 'A', icon: <ArrowUpRight size={S} /> },
  ],
];

export function Toolbar() {
  const tool = useBoard((s) => s.tool);
  const libraryOpen = useBoard((s) => s.libraryOpen);

  return (
    <nav className="toolbar panel" aria-label="Tools">
      {TOOL_GROUPS.map((group, gi) => (
        <div className="tool-group" key={gi}>
          {group.map((t) => (
            <button
              key={t.tool}
              className={`tool-btn${tool === t.tool ? ' active' : ''}`}
              onClick={() => setTool(t.tool)}
              title={`${t.label} (${t.key})`}
              aria-label={t.label}
              aria-pressed={tool === t.tool}
            >
              {t.icon}
            </button>
          ))}
        </div>
      ))}
      <div className="tool-group">
        <button
          className="tool-btn"
          title="Insert image"
          aria-label="Insert image"
          onClick={async () => {
            const file = await pickFile('image/*');
            if (file) addImageFile(file);
          }}
        >
          <ImagePlus size={S} />
        </button>
        <button
          className={`tool-btn${libraryOpen ? ' active' : ''}`}
          title="Icon library: Azure, SAP, databases… (I)"
          aria-label="Icon library"
          aria-pressed={libraryOpen}
          onClick={() => useBoard.setState({ libraryOpen: !libraryOpen })}
        >
          <Shapes size={S} />
        </button>
      </div>
    </nav>
  );
}
