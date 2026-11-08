import { useContext, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { GameItem, RecipeIndex } from '../../../shared/recipes.js';
import { fieldClass } from '../../components/Field.js';
import { POPOVER } from '../../components/Window.js';
import { GameIcon, IconsContext } from '../machineWiki/icons.js';
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

/** Where the open list goes: under the field, or above it when there is not room for a few rows below. */
function listPlace(input: HTMLElement): CSSProperties {
  const r = input.getBoundingClientRect();
  const below = window.innerHeight - r.bottom - 8;
  const above = r.top - 8;
  const flip = below < 160 && above > below;
  return {
    position: 'fixed', left: r.left, width: r.width, maxHeight: Math.min(288, flip ? above : below),
    ...(flip ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
  };
}

/**
 * A searchable item picker (WAI-ARIA combobox with a list box): type a part of the English or German
 * name, pick with the arrow keys and Enter or with a click. Items show the game's picture (dataset part `icons`), the
 * picked one inside the field. The list floats over the page (in `document.body`, placed at the field), so a window's
 * frame or the page's own scrolling does not cut it off.
 */
export function ItemPicker({ index, lang, value, onChange, label }: ItemPickerProps) {
  const { t } = useTranslation();
  const icons = useContext(IconsContext);
  const listId = useId();
  const optionId = (i: number) => `${listId}-o${i}`;
  const selectedName = value ? index.items.get(value)?.name[lang] ?? value : '';
  const [query, setQuery] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const [place, setPlace] = useState<CSSProperties>({});
  const text = query ?? selectedName;
  // The picked item's picture inside the field, while its name is shown (not while typing).
  const picture = value !== null && query === null && icons?.has(value) ? value : null;
  const results = useMemo(
    () => (open ? matchItems(index.plannable, query ?? '', lang).slice(0, MAX_RESULTS) : []),
    [open, index, query, lang],
  );

  // While open, the list follows the field when the page scrolls or the window changes size.
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => { if (inputRef.current) setPlace(listPlace(inputRef.current)); };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [open]);

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
      // Close the list only; page-wide Esc handlers leave this press alone.
      e.preventDefault();
      e.stopPropagation();
      setOpen(false);
      setQuery(null);
    }
  }

  return (
    <div className="relative min-w-0 flex-1 basis-56">
      {picture && <GameIcon cls={picture} px={24} className="pointer-events-none absolute top-2 left-2" />}
      <input
        ref={inputRef}
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
        className={fieldClass({}, `w-full ${picture ? 'pl-10' : ''}`)}
      />
      {createPortal(<ul
        id={listId}
        role="listbox"
        aria-label={label}
        hidden={!open}
        style={place}
        className={`z-50 overflow-y-auto py-1 ${POPOVER}`}
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
            className={`flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm ${i === active ? 'bg-raised text-fg' : ''}`}
          >
            <GameIcon cls={item.id} px={24} placeholder />
            <span className="min-w-0 truncate">
              {item.name[lang]}
              {item.name[lang] !== item.name[lang === 'de' ? 'en' : 'de'] && (
                <span className="ml-2 text-muted">{item.name[lang === 'de' ? 'en' : 'de']}</span>
              )}
            </span>
          </li>
        ))}
      </ul>, document.body)}
    </div>
  );
}
