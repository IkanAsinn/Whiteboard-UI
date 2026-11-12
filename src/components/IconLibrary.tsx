import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import {
  ICON_DRAG_MIME,
  iconDataUrl,
  iconPayload,
  insertIcon,
  loadIconIndex,
  loadIconSet,
  type IconSetInfo,
  type LibraryIcon,
} from '../icons';

const PAGE = 120;

function readPref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
function writePref(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable */
  }
}

export function IconLibrary({ onClose }: { onClose: () => void }) {
  const [sets, setSets] = useState<IconSetInfo[] | null>(null);
  const [setId, setSetId] = useState<string>(() => readPref('wb.icons.set', 'azure'));
  const [icons, setIcons] = useState<LibraryIcon[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const [limit, setLimit] = useState(PAGE);
  const [withLabel, setWithLabel] = useState<boolean>(() => readPref('wb.icons.label', true));

  // Focus the search one frame after opening, so the "I" shortcut that opened the
  // panel doesn't get typed into it.
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const t = setTimeout(() => searchRef.current?.focus(), 50);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    loadIconIndex()
      .then(setSets)
      .catch(() => setError('Icon library is unavailable.'));
  }, []);

  const current = sets?.find((s) => s.id === setId) ?? sets?.[0];

  useEffect(() => {
    if (!current) return;
    let cancelled = false;
    setIcons(null);
    setError(null);
    loadIconSet(current)
      .then((list) => !cancelled && setIcons(list))
      .catch(() => !cancelled && setError(`Could not load ${current.name} icons.`));
    return () => {
      cancelled = true;
    };
  }, [current]);

  const filtered = useMemo(() => {
    if (!icons) return [];
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return icons.filter((i) => {
      if (category !== 'All' && i.category !== category) return false;
      const hay = `${i.name} ${i.category}`.toLowerCase();
      return terms.every((t) => hay.includes(t));
    });
  }, [icons, query, category]);

  const chooseSet = (id: string) => {
    setSetId(id);
    setCategory('All');
    setLimit(PAGE);
    writePref('wb.icons.set', id);
  };

  return (
    <aside
      className="library panel"
      aria-label="Icon library"
      onKeyDown={(e) => {
        if (e.key === 'F1') return; // let the global help shortcut through
        e.stopPropagation();
        if (e.key === 'Escape') onClose();
      }}
    >
      <header className="library-head">
        <h2>Icons</h2>
        <button className="icon-btn" onClick={onClose} title="Close (Esc)" aria-label="Close icon library">
          <X size={18} />
        </button>
      </header>

      <div className="segmented" role="tablist">
        {sets?.map((s) => (
          <button
            key={s.id}
            role="tab"
            aria-selected={s.id === current?.id}
            className={s.id === current?.id ? 'active' : ''}
            onClick={() => chooseSet(s.id)}
          >
            {s.name}
          </button>
        ))}
      </div>

      <label className="search">
        <Search size={16} />
        <input
          type="search"
          placeholder={current ? `Search ${current.count} ${current.name} icons` : 'Search icons'}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setLimit(PAGE);
          }}
          ref={searchRef}
        />
      </label>

      <div className="library-filters">
        <select
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setLimit(PAGE);
          }}
          aria-label="Category"
        >
          <option>All</option>
          {current?.categories.map((c) => (
            <option key={c}>{c}</option>
          ))}
        </select>
        <label className="check">
          <input
            type="checkbox"
            checked={withLabel}
            onChange={(e) => {
              setWithLabel(e.target.checked);
              writePref('wb.icons.label', e.target.checked);
            }}
          />
          Add name
        </label>
      </div>

      <div className="library-grid">
        {error && <p className="library-msg">{error}</p>}
        {!error && !icons && <p className="library-msg">Loading…</p>}
        {icons && !filtered.length && <p className="library-msg">No icons match “{query}”.</p>}
        {filtered.slice(0, limit).map((icon) => (
          <button
            key={icon.id}
            className="library-item"
            title={`${icon.name}\n${icon.category}`}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(ICON_DRAG_MIME, JSON.stringify({ ...iconPayload(icon), withLabel }));
              e.dataTransfer.effectAllowed = 'copy';
            }}
            onClick={(e) => {
              insertIcon(iconPayload(icon), undefined, withLabel);
              e.currentTarget.blur(); // keep keyboard shortcuts (Delete, arrows…) working on the board
            }}
            onDragEnd={() => (document.activeElement as HTMLElement | null)?.blur()}
          >
            <img src={iconDataUrl(icon)} alt="" loading="lazy" draggable={false} />
            <span>{icon.name}</span>
          </button>
        ))}
        {filtered.length > limit && (
          <button className="library-more" onClick={() => setLimit((l) => l + PAGE)}>
            Show more ({filtered.length - limit} left)
          </button>
        )}
      </div>

      {current && (
        <footer className="library-foot">
          Source:{' '}
          <a href={current.source} target="_blank" rel="noreferrer">
            {current.name}
          </a>{' '}
          · {current.license}
        </footer>
      )}
    </aside>
  );
}
