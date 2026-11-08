import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { SearchEntry, WorldCtx } from '../../app/feature.js';
import { isEditableTarget } from '../../app/keyboard.js';
import { useWorldPage, worldPath } from '../../app/pages.js';
import { useUiStore } from '../../app/store.js';
import { useIsMobile } from '../../app/useMediaQuery.js';
import { Button } from '../../components/Button.js';
import { CloseIcon, SearchIcon } from '../../components/icons.js';
import { IconButton } from '../../components/IconButton.js';
import { WINDOW_FRAME } from '../../components/Window.js';
import { MIN_QUERY_LENGTH, normalize } from './match.js';
import { useSearch } from './useSearch.js';

/** How many results the list shows; the map highlights all of them. */
export const MAX_SHOWN = 8;

/** "/" (not while typing) or Ctrl/Cmd+K opens the search; neither while a modal dialog is open. */
export function isSearchShortcut(e: KeyboardEvent): boolean {
  if (e.defaultPrevented || document.querySelector('dialog[open]') !== null) return false;
  if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) return !isEditableTarget(e.target);
  return e.key.toLowerCase() === 'k' && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey;
}

/**
 * The search in the middle of the top bar: collectibles by name, label or actor ID, biomes, caves,
 * crash sites, and whatever other features add as `searchProviders`. While a query is typed its
 * matches are highlighted on the map (the rest fades); choosing a result keeps its own items
 * highlighted and runs its action (select an item, scope a biome, show a cave). A combobox with a
 * listbox: arrows move, Enter chooses, Esc closes the list, then clears. On mobile a button in the
 * bar opens it over the bar. On a world page (planner, ...) a result about the map (one with `actors`)
 * goes back to the map first; the others act where they are (a machine opens its wiki entry).
 */
export function SearchBox({ ctx }: { ctx: WorldCtx }) {
  const { t } = useTranslation();
  const mobile = useIsMobile();
  const onPage = useWorldPage() !== undefined;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [chosen, setChosen] = useState<SearchEntry | null>(null);
  /** Providers load their data from the first use on. */
  const [used, setUsed] = useState(false);
  /** Mobile: the field is open over the top bar. */
  const [expanded, setExpanded] = useState(false);
  const [focusTick, setFocusTick] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const optionId = (i: number) => `${listId}-${i}`;

  const { results, actors, loading } = useSearch(ctx, chosen ? '' : query, used);
  const shown = results.slice(0, MAX_SHOWN);
  const active = Math.min(activeIdx, shown.length - 1);
  const searching = !chosen && normalize(query).length >= MIN_QUERY_LENGTH;
  const listOpen = open && searching;

  // The map highlights the matches while typing, the chosen result's items after choosing.
  const setHighlight = useUiStore(s => s.setSearchHighlight);
  useEffect(() => {
    setHighlight(chosen ? (chosen.actors?.length ? new Set(chosen.actors) : null) : actors);
  }, [chosen, actors, setHighlight]);
  useEffect(() => () => setHighlight(null), [setHighlight]);

  useEffect(() => {
    if (focusTick === 0) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [focusTick]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!isSearchShortcut(e)) return;
      e.preventDefault();
      setExpanded(true);
      setFocusTick(n => n + 1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (listOpen && active >= 0) document.getElementById(optionId(active))?.scrollIntoView?.({ block: 'nearest' });
  });

  function choose(entry: SearchEntry) {
    setChosen(entry);
    setQuery(entry.label);
    setOpen(false);
    // The entry acts on the map through requests (focus, fit, scope) the map carries out once it is shown.
    if (entry.actors && onPage) ctx.navigate(worldPath(ctx.worldId));
    entry.onSelect?.(ctx);
    // On a phone the map is what the user wants to see now.
    if (mobile) setExpanded(false);
  }

  function clear() {
    setQuery('');
    setChosen(null);
    setOpen(false);
    inputRef.current?.focus();
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    const n = shown.length;
    switch (e.key) {
      case 'ArrowDown':
      case 'ArrowUp':
        if (!searching) return;
        e.preventDefault();
        if (!open) {
          setOpen(true);
          setActiveIdx(e.key === 'ArrowDown' ? 0 : n - 1);
        } else if (n > 0) {
          setActiveIdx((active + (e.key === 'ArrowDown' ? 1 : -1) + n) % n);
        }
        return;
      case 'Enter': {
        const pick = listOpen ? shown[active] : undefined;
        if (!pick) return;
        e.preventDefault();
        choose(pick.entry);
        return;
      }
      case 'Escape':
        // Used up here, so page-wide Esc handlers (item panel, map modes) leave this press alone.
        e.preventDefault();
        if (listOpen) setOpen(false);
        else if (query) clear();
        else {
          inputRef.current?.blur();
          setExpanded(false);
        }
        return;
    }
  }

  function onBlur(e: FocusEvent<HTMLDivElement>) {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setOpen(false);
    if (!query) setExpanded(false);
  }

  const status = !searching ? '' : results.length === 0
    ? t(loading ? 'common.loading' : 'search.none')
    : actors
      ? t('search.countOnMap', { count: results.length, onMap: actors.size })
      : t('search.count', { count: results.length });

  const field = (
    // On a phone the results hang from the whole bar (the field is not their anchor), so they fit the screen.
    <div className={`min-w-0 flex-1 ${mobile ? '' : 'relative'}`} onBlur={onBlur}>
      <div className="flex h-8 items-center gap-2 chamfer border border-line bg-bg px-2 transition-colors hover:border-edge focus-within:border-accent">
        <SearchIcon className="text-muted" />
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-label={t('search.label')}
          aria-expanded={listOpen}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={listOpen && active >= 0 ? optionId(active) : undefined}
          aria-keyshortcuts="/ Control+K"
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
          placeholder={t('search.placeholder')}
          value={query}
          onChange={e => {
            setQuery(e.target.value);
            setChosen(null);
            setOpen(true);
            setActiveIdx(0);
            setUsed(true);
          }}
          onFocus={e => {
            setUsed(true);
            if (chosen) e.currentTarget.select();
            else if (query) setOpen(true);
          }}
          onKeyDown={onKeyDown}
          className="h-full min-w-0 flex-1 bg-transparent text-sm text-fg outline-none placeholder:text-muted [&::-webkit-search-cancel-button]:appearance-none"
        />
        {query
          ? (
            <button
              type="button"
              aria-label={t('search.clear')}
              title={t('search.clear')}
              onClick={clear}
              className="-mr-1 flex size-6 shrink-0 items-center justify-center chamfer text-muted focus-ring hover:bg-line hover:text-fg"
            >
              <CloseIcon size={14} />
            </button>
          )
          : !mobile && <kbd aria-hidden="true" className="chamfer border border-line px-1.5 font-sans text-xs text-muted">/</kbd>}
      </div>
      <div
        className={`absolute top-full z-[1400] mt-1.5 ${mobile ? 'inset-x-2' : 'left-1/2 w-[max(100%,26rem)] max-w-[calc(100vw-1rem)] -translate-x-1/2'}`}
        hidden={!listOpen}
      >
        <div className={`overflow-hidden border-t-2 border-t-accent ${WINDOW_FRAME}`}>
          <ul id={listId} role="listbox" aria-label={t('search.results')} className="max-h-[min(60vh,26rem)] overflow-y-auto py-1">
            {listOpen && shown.map((r, i) => (
              <li
                key={r.entry.id}
                id={optionId(i)}
                role="option"
                aria-selected={i === active}
                // Keep the focus in the input; the click chooses.
                onMouseDown={e => e.preventDefault()}
                onMouseMove={() => { if (i !== active) setActiveIdx(i); }}
                onClick={() => choose(r.entry)}
                className={`flex cursor-pointer items-center gap-2.5 border-l-2 py-1.5 pr-3 pl-2.5 ${i === active ? 'border-l-accent bg-raised' : 'border-l-transparent'}`}
              >
                <span aria-hidden="true" className="flex size-6 shrink-0 items-center justify-center">{r.entry.icon}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm text-fg">{r.entry.label}</span>
                  {r.entry.detail && <span className="block truncate text-xs text-muted">{r.entry.detail}</span>}
                </span>
                <span className="shrink-0 font-display text-xs tracking-wider text-muted uppercase">{t(r.entry.kindKey)}</span>
              </li>
            ))}
          </ul>
          <p aria-hidden="true" className="border-t border-line bg-bg/50 px-3 py-1.5 text-xs text-muted">{status}</p>
        </div>
      </div>
      <p role="status" className="sr-only">{listOpen ? status : ''}</p>
    </div>
  );

  if (!mobile) return <div role="search" className="flex w-[clamp(14rem,30vw,28rem)]">{field}</div>;
  return (
    <>
      <IconButton
        aria-label={t('search.open')}
        aria-keyshortcuts="/ Control+K"
        size="sm"
        variant={query ? 'link-accent' : 'ghost'}
        onClick={() => {
          setExpanded(true);
          setFocusTick(n => n + 1);
        }}
      >
        <SearchIcon />
      </IconButton>
      {expanded && (
        <div role="search" className="absolute inset-0 z-[1400] flex items-center gap-2 border-b border-line bg-panel px-2">
          {field}
          <Button size="sm" variant="ghost" onClick={() => { setOpen(false); setExpanded(false); }}>{t('common.close')}</Button>
        </div>
      )}
    </>
  );
}
