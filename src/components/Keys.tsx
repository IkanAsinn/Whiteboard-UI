import { Fragment } from 'react';

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

/** How each key name is printed on its keycap. */
const LABELS: Record<string, string> = {
  Mod: isMac ? '⌘' : 'Ctrl',
  Ctrl: 'Ctrl',
  Shift: '⇧ Shift',
  Alt: isMac ? '⌥' : 'Alt',
  Enter: '↵ Enter',
  Backspace: '⌫',
  Delete: 'Del',
  Escape: 'Esc',
  Space: 'Space',
  Up: '↑',
  Down: '↓',
  Left: '←',
  Right: '→',
};

const WIDE = new Set(['Space', 'Shift', 'Enter']);

/** One keycap. Names starting with "~" are mouse/touch actions shown as plain text (e.g. "~drag"). */
export function Key({ name, small }: { name: string; small?: boolean }) {
  if (name.startsWith('~')) return <span className="key-action">{name.slice(1)}</span>;
  if (name === 'Arrows') {
    return (
      <span className="key-cluster">
        {['Left', 'Up', 'Down', 'Right'].map((k) => (
          <Key key={k} name={k} small={small} />
        ))}
      </span>
    );
  }
  const label = LABELS[name] ?? name;
  return <kbd className={`key${WIDE.has(name) ? ' wide' : ''}${small ? ' small' : ''}`}>{label}</kbd>;
}

/**
 * Key combinations: `combos` are alternatives ("or"), each a list of keys pressed together ("+").
 * e.g. [['Mod', 'Shift', 'Z'], ['Mod', 'Y']]
 */
export function Keys({ combos, small }: { combos: string[][]; small?: boolean }) {
  return (
    <span className="keys">
      {combos.map((combo, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="key-sep">or</span>}
          <span className="key-combo">
            {combo.map((k, j) => (
              <Fragment key={j}>
                {j > 0 && <span className="key-plus">+</span>}
                <Key name={k} small={small} />
              </Fragment>
            ))}
          </span>
        </Fragment>
      ))}
    </span>
  );
}
