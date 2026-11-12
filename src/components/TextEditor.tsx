import { useEffect, useLayoutEffect, useRef } from 'react';
import { finishEditing, toggleFormat, updateText, useBoard } from '../store';
import { FONT_FAMILY, LINE_HEIGHT, STICKY_PADDING, fitStickyText } from '../text';

/** A textarea overlaid exactly on the text / sticky note being edited. */
export function TextEditor() {
  const el = useBoard((s) => (s.editingId ? s.elements.find((e) => e.id === s.editingId) : undefined));
  const camera = useBoard((s) => s.camera);
  const ref = useRef<HTMLTextAreaElement>(null);
  const id = el?.id;

  // Focus after the pointer sequence that created the element has finished.
  useEffect(() => {
    if (!id) return;
    const raf = requestAnimationFrame(() => {
      const ta = ref.current;
      if (!ta) return;
      ta.focus();
      ta.setSelectionRange(ta.value.length, ta.value.length);
    });
    return () => cancelAnimationFrame(raf);
  }, [id]);

  // Grow free text to fit its content.
  useLayoutEffect(() => {
    const ta = ref.current;
    if (!ta || !el || el.type !== 'text') return;
    ta.style.width = '0px';
    ta.style.width = `${ta.scrollWidth + 2}px`;
  });

  if (!el || (el.type !== 'text' && el.type !== 'sticky')) return null;

  const z = camera.z;
  const isSticky = el.type === 'sticky';
  const centered = el.type === 'text' && el.align === 'center';
  // Centered text is anchored at its center so it grows evenly both ways while typing.
  const left = ((centered ? el.x + el.w / 2 : el.x) - camera.x) * z;
  const top = (el.y - camera.y) * z;
  const fontSize = isSticky ? fitStickyText(el.text || ' ', el.w, el.h, el).fontSize : el.fontSize;

  const style: React.CSSProperties = {
    left,
    top,
    fontFamily: FONT_FAMILY,
    fontSize: fontSize * z,
    fontWeight: el.bold ? 700 : 400,
    fontStyle: el.italic ? 'italic' : 'normal',
    textDecoration: el.underline ? 'underline' : 'none',
    lineHeight: LINE_HEIGHT,
    color: isSticky ? '#1e1e1e' : el.color,
    ...(isSticky
      ? {
          width: el.w * z,
          height: el.h * z,
          padding: STICKY_PADDING * z,
          whiteSpace: 'pre-wrap',
          overflowWrap: 'anywhere',
        }
      : {
          minWidth: fontSize * z,
          height: el.h * z + 2,
          whiteSpace: 'pre',
          ...(centered ? { textAlign: 'center', transform: 'translateX(-50%)' } : {}),
        }),
  };

  return (
    <textarea
      ref={ref}
      className={`text-editor${isSticky ? ' sticky' : ''}`}
      style={style}
      value={el.text}
      spellCheck={false}
      placeholder={isSticky ? 'Type a note…' : ''}
      onChange={(e) => updateText(el.id, e.target.value)}
      onBlur={() => finishEditing()}
      onKeyDown={(e) => {
        if (e.key === 'F1') return; // let the global help shortcut through
        e.stopPropagation();
        if ((e.ctrlKey || e.metaKey) && !e.altKey) {
          const k = e.key.toLowerCase();
          const fmt = k === 'b' ? 'bold' : k === 'i' ? 'italic' : k === 'u' ? 'underline' : null;
          if (fmt) {
            e.preventDefault();
            toggleFormat(fmt);
            return;
          }
        }
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
          e.preventDefault();
          finishEditing();
        }
      }}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
}
