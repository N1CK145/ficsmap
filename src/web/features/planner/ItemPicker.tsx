import { useId, useMemo, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { GameItem, RecipeIndex } from '../../../shared/recipes.js';
import { fold, type Lang } from './format.js';

const MAX_RESULTS = 50;

/**
 * Items whose English or German name contains every word of `query`, best first: name in the UI
 * language starts with the query, then the other language's name does, then any match; then by name.
 */
export function matchItems(items: readonly GameItem[], query: string, lang: Lang): GameItem[] {
  const q = fold(query.trim());
  const words = q.split(/\s+/).filter(Boolean);
  const other: Lang = lang === 'de' ? 'en' : 'de';
  const scored: { item: GameItem; score: number }[] = [];
  for (const item of items) {
    const own = fold(item.name[lang]);
    const alt = fold(item.name[other]);
    if (!words.every(w => own.includes(w) || alt.includes(w))) continue;
    const score = q === '' ? 2 : own.startsWith(q) ? 0 : alt.startsWith(q) ? 1 : 2;
    scored.push({ item, score });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.item.name[lang].localeCompare(b.item.name[lang], lang))
    .map(s => s.item);
}

export interface ItemPickerProps {
  index: RecipeIndex;
  lang: Lang;
  value: string | null;
  onChange(item: string): void;
  /** Accessible name of the input. */
  label: string;
}

/**
 * A searchable item picker (WAI-ARIA combobox with a list box): type a part of the English or German
 * name, pick with the arrow keys and Enter or with a click.
 */
export function ItemPicker({ index, lang, value, onChange, label }: ItemPickerProps) {
  const { t } = useTranslation();
  const listId = useId();
  const optionId = (i: number) => `${listId}-o${i}`;
  const selectedName = value ? index.items.get(value)?.name[lang] ?? value : '';
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const text = query ?? selectedName;
  const results = useMemo(
    () => (open ? matchItems(index.plannable, query ?? '', lang).slice(0, MAX_RESULTS) : []),
    [open, index, query, lang],
  );

  function choose(item: GameItem) {
    onChange(item.id);
    setQuery(null);
    setOpen(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) { setOpen(true); setActive(0); return; }
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setActive(a => (results.length === 0 ? 0 : (a + step + results.length) % results.length));
    } else if (e.key === 'Enter') {
      const item = results[active];
      if (open && item) { e.preventDefault(); choose(item); }
    } else if (e.key === 'Escape' && open) {
      // Close the list only, not the dialog around it.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      setQuery(null);
    }
  }

  return (
    <div className="relative min-w-0 flex-1 basis-56">
      <input
        type="text"
        role="combobox"
        aria-label={label}
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && results[active] ? optionId(active) : undefined}
        placeholder={t('planner.pickItem')}
        autoComplete="off"
        spellCheck={false}
        value={text}
        onChange={e => { setQuery(e.target.value); setOpen(true); setActive(0); }}
        onFocus={e => { e.target.select(); setOpen(true); setActive(0); }}
        onBlur={() => { setOpen(false); setQuery(null); }}
        onKeyDown={onKeyDown}
        className="h-10 w-full rounded border border-line bg-bg px-3 text-fg placeholder:text-muted focus-ring"
      />
      <ul
        id={listId}
        role="listbox"
        aria-label={label}
        hidden={!open}
        className="absolute inset-x-0 top-full z-10 mt-1 max-h-64 overflow-y-auto rounded border border-line bg-panel py-1 shadow-lg"
      >
        {results.length === 0 && open && <li role="presentation" className="px-3 py-2 text-sm text-muted">{t('planner.noMatch')}</li>}
        {results.map((item, i) => (
          <li
            key={item.id}
            id={optionId(i)}
            role="option"
            aria-selected={i === active}
            // mousedown, not click: the input keeps focus and its blur does not close the list first.
            onMouseDown={e => { e.preventDefault(); choose(item); }}
            onMouseEnter={() => setActive(i)}
            className={`cursor-pointer px-3 py-2 text-sm ${i === active ? 'bg-line' : ''}`}
          >
            {item.name[lang]}
            {item.name[lang] !== item.name[lang === 'de' ? 'en' : 'de'] && (
              <span className="ml-2 text-muted">{item.name[lang === 'de' ? 'en' : 'de']}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
