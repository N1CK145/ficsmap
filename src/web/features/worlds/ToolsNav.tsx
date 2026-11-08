import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { collect, type Tool, type WorldCtx } from '../../app/feature.js';
import { useFeatures } from '../../app/FeaturesContext.js';
import { useWorldPage, worldPath } from '../../app/pages.js';
import { useMediaQuery } from '../../app/useMediaQuery.js';
import { Button, buttonClass } from '../../components/Button.js';
import { ChevronDownIcon, MapIcon } from '../../components/icons.js';
import { POPOVER } from '../../components/Window.js';

/** From this width the sections are a tab strip under the top bar; below it they are in the section menu. */
export const WIDE_QUERY = '(min-width: 1280px)';

/** A switch of the map (a layer): neither a page nor an action of its own. Shown only while the map is. */
const isMapSwitch = (tool: Tool) => tool.page === undefined && !tool.action;

/** The features' tools, split into the sections (page tools) and what belongs to the map view. */
function useToolGroups() {
  const features = useFeatures();
  return useMemo(() => {
    const tools = collect(features, 'tools');
    return {
      pages: tools.filter(tool => tool.page !== undefined),
      // Map switches first, then other actions; both act on the map view, so both live with it.
      mapTools: [...tools.filter(isMapSwitch), ...tools.filter(tool => tool.page === undefined && tool.action)],
    };
  }, [features]);
}

/** The world page shown now, or null on the map (the settings page has no navigation). */
function useCurrentSection(): string | null {
  return useWorldPage()?.id ?? null;
}

/**
 * The world's navigation, chosen by width: the tab strip (`WorldTabs`) from 1280 px, else the section menu
 * (`SectionMenu`). The world layout places the two itself (the strip under the top bar, the menu in it); this
 * component is the one-line form of that choice.
 */
export function ToolsNav({ ctx, mobile }: { ctx: WorldCtx; mobile: boolean }) {
  const wide = useMediaQuery(WIDE_QUERY);
  return wide && !mobile ? <WorldTabs ctx={ctx} /> : <SectionMenu ctx={ctx} />;
}

/**
 * The tab strip under the top bar from 1280 px: [Map | Planner | Vehicles | Machines], an icon and a word each, the
 * section shown now with an accent underline as in the game's tabbed menus (and `aria-current="page"`). A tab's word
 * is the page's tool label, the same word as the page's heading. On the map the map's switches (layers such as Caves
 * and the height map) follow at the right end; on a world page they are not shown, they would do nothing there.
 */
export function WorldTabs({ ctx }: { ctx: WorldCtx }) {
  const { t } = useTranslation();
  const { pages, mapTools } = useToolGroups();
  const current = useCurrentSection();
  return (
    <div className="flex h-10 shrink-0 items-stretch justify-between gap-3 border-b border-line bg-panel px-2 min-[900px]:px-3">
      <nav aria-label={t('nav.label')} className="flex items-stretch">
        <Tab to={worldPath(ctx.worldId)} current={current === null} icon={<MapIcon />} label={t('nav.map')} />
        {pages.map(tool => <PageTab key={tool.id} tool={tool} ctx={ctx} current={current === tool.page} />)}
      </nav>
      {current === null && mapTools.length > 0 && (
        // The map's switches as one bar of plates, like the game's hotbar; empty (hidden) while none is available.
        <div role="group" aria-label={t('nav.layers')} className="flex items-center gap-0.5 self-center chamfer border border-line bg-bg p-0.5 empty:hidden">
          {mapTools.map(tool => <SwitchButton key={tool.id} tool={tool} ctx={ctx} />)}
        </div>
      )}
    </div>
  );
}

function Tab({ to, current, icon, label, hint }: { to: string; current: boolean; icon: ReactNode; label: string; hint?: string }) {
  return (
    <Link
      to={to}
      aria-current={current ? 'page' : undefined}
      title={hint}
      className={`relative flex items-center gap-2 px-3.5 font-display text-sm font-semibold tracking-wider uppercase transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none focus-visible:ring-inset ${
        current ? 'bg-raised text-fg' : 'text-muted hover:bg-raised hover:text-fg'}`}
    >
      <span aria-hidden="true" className={current ? 'text-accent' : ''}>{icon}</span>
      {label}
      {current && <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-0.5 bg-accent" />}
    </Link>
  );
}

function PageTab({ tool, ctx, current }: { tool: Tool; ctx: WorldCtx; current: boolean }) {
  const { t } = useTranslation();
  const state = tool.useTool(ctx);
  if (!state.available || tool.page === undefined) return null;
  return <Tab to={worldPath(ctx.worldId, tool.page)} current={current} icon={tool.icon} label={t(tool.labelKey)} hint={tool.hintKey ? t(tool.hintKey) : undefined} />;
}

/** Where a page tool links to, and whether its page is shown now (needs the router). */
function usePageLink(page: string, ctx: WorldCtx): { to: string; current: boolean } {
  const shown = useWorldPage();
  return { to: worldPath(ctx.worldId, page), current: shown?.id === page };
}

/** One tool as a top-bar button (a link for a page tool); nothing while the tool is not available. */
export function ToolButton({ tool, ctx }: { tool: Tool; ctx: WorldCtx }) {
  return tool.page === undefined ? <SwitchButton tool={tool} ctx={ctx} /> : <PageToolButton tool={tool} page={tool.page} ctx={ctx} />;
}

function PageToolButton({ tool, page, ctx }: { tool: Tool; page: string; ctx: WorldCtx }) {
  const { t } = useTranslation();
  const state = tool.useTool(ctx);
  const link = usePageLink(page, ctx);
  if (!state.available) return null;
  return (
    <Link
      to={link.to}
      aria-current={link.current ? 'page' : undefined}
      title={tool.hintKey ? t(tool.hintKey) : undefined}
      className={buttonClass({ variant: link.current ? 'primary' : 'secondary', size: 'sm' })}
    >
      {tool.icon !== undefined && <span aria-hidden="true">{tool.icon}</span>}
      {t(tool.labelKey)}
    </Link>
  );
}

function SwitchButton({ tool, ctx }: { tool: Tool; ctx: WorldCtx }) {
  const { t } = useTranslation();
  const state = tool.useTool(ctx);
  if (!state.available) return null;
  return (
    <Button
      variant={state.pressed ? 'primary' : 'ghost'}
      size="sm"
      aria-pressed={state.pressed}
      aria-keyshortcuts={tool.shortcut}
      title={tool.hintKey ? t(tool.hintKey) : undefined}
      onClick={state.run}
    >
      {tool.icon !== undefined && <span aria-hidden="true">{tool.icon}</span>}
      {t(tool.labelKey)}
    </Button>
  );
}

/**
 * Below 1280 px (and on phones): one menu button in the top bar named after the section shown now ("Map ⌄", with its
 * icon), a WAI-ARIA menu button (arrows, Home/End, Esc, Tab). The menu lists the sections under "Sections" (links,
 * the current one marked) and, on the map, the map's switches under "Map layers" (`menuitemcheckbox`).
 */
export function SectionMenu({ ctx }: { ctx: WorldCtx }) {
  const { t } = useTranslation();
  const { pages, mapTools } = useToolGroups();
  const current = useCurrentSection();
  const currentTool = pages.find(tool => tool.page === current);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const sectionsId = useId();
  const layersId = useId();

  const items = () => [...(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    // preventDefault: this Esc is used up, so page-wide Esc handlers (item panel) leave it alone.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      close(true);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function onMenuKeyDown(e: ReactKeyboardEvent) {
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => {
      e.preventDefault();
      list[(i + list.length) % list.length]?.focus();
    };
    if (e.key === 'ArrowDown') go(at + 1);
    else if (e.key === 'ArrowUp') go(at - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(list.length - 1);
    else if (e.key === 'Tab') setOpen(false);
  }

  const section = currentTool ? t(currentTool.labelKey) : t('nav.map');
  return (
    <div ref={rootRef} className="relative min-w-0 shrink-0">
      <Button
        ref={buttonRef}
        size="sm"
        aria-label={t('nav.menu', { section })}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen(o => !o)}
        onKeyDown={e => {
          if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
          e.preventDefault();
          setOpen(true);
        }}
        className="max-[899px]:gap-1.5 max-[899px]:px-2"
      >
        <span aria-hidden="true" className="text-accent">{currentTool ? currentTool.icon : <MapIcon />}</span>
        <span className="font-display font-semibold tracking-wider uppercase">{section}</span>
        <ChevronDownIcon size={12} className={`-mr-1 motion-safe:transition-transform ${open ? 'rotate-180' : ''}`} />
      </Button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={t('nav.label')}
          onKeyDown={onMenuKeyDown}
          // On a phone the menu spans the screen under the top bar, so it is never cut off at an edge.
          className={`z-[1400] flex flex-col gap-1 p-1 ${POPOVER} max-[899px]:fixed max-[899px]:inset-x-2 max-[899px]:top-14 min-[900px]:absolute min-[900px]:top-full min-[900px]:right-0 min-[900px]:mt-2 min-[900px]:w-64`}
        >
          <div role="group" aria-labelledby={sectionsId} className="flex flex-col">
            <p id={sectionsId} className={GROUP_LABEL}>{t('nav.label')}</p>
            <SectionMenuItem to={worldPath(ctx.worldId)} current={current === null} icon={<MapIcon />} label={t('nav.map')} onDone={() => close(true)} />
            {pages.map(tool => (
              <PageMenuItem key={tool.id} tool={tool} ctx={ctx} current={current === tool.page} onDone={() => close(true)} />
            ))}
          </div>
          {current === null && mapTools.length > 0 && (
            // Hidden while none of the switches is available (e.g. a dataset without caves and heights).
            <div role="group" aria-labelledby={layersId} className="hidden flex-col border-t border-line pt-1 has-[[role^='menuitem']]:flex">
              <p id={layersId} className={GROUP_LABEL}>{t('nav.layers')}</p>
              {mapTools.map(tool => <ToolMenuItem key={tool.id} tool={tool} ctx={ctx} onDone={() => close(true)} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const GROUP_LABEL = 'px-2.5 pt-1.5 pb-1 font-display text-xs font-semibold tracking-wider text-muted uppercase max-[899px]:text-sm';
const MENU_ITEM = 'flex min-h-11 w-full items-center gap-2.5 chamfer px-2.5 text-left text-sm text-fg outline-none hover:bg-raised focus:bg-raised focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset min-[900px]:min-h-9 max-[899px]:text-base';

/** A section as a menu entry: a link item, the current one marked (also with a dot). Space follows it too. */
function SectionMenuItem({ to, current, icon, label, hint, onDone }: {
  to: string; current: boolean; icon: ReactNode; label: string; hint?: string; onDone(): void;
}) {
  return (
    <Link
      to={to}
      role="menuitem"
      aria-current={current ? 'page' : undefined}
      title={hint}
      tabIndex={-1}
      onClick={onDone}
      // A menu item also takes Space; a link alone only Enter.
      onKeyDown={e => {
        if (e.key !== ' ') return;
        e.preventDefault();
        e.currentTarget.click();
      }}
      className={`${MENU_ITEM} ${current ? 'font-semibold text-accent' : ''}`}
    >
      <span aria-hidden="true" className="flex w-4 shrink-0 justify-center">{icon}</span>
      <span className="min-w-0 flex-1">{label}</span>
      {current && <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-accent" />}
    </Link>
  );
}

function PageMenuItem({ tool, ctx, current, onDone }: { tool: Tool; ctx: WorldCtx; current: boolean; onDone(): void }) {
  const { t } = useTranslation();
  const state = tool.useTool(ctx);
  if (!state.available || tool.page === undefined) return null;
  return (
    <SectionMenuItem to={worldPath(ctx.worldId, tool.page)} current={current} icon={tool.icon} label={t(tool.labelKey)}
      hint={tool.hintKey ? t(tool.hintKey) : undefined} onDone={onDone} />
  );
}

/** A switch or an action as a menu entry: a checkbox item with an on/off pill for a switch, a plain item for an action. */
function ToolMenuItem({ tool, ctx, onDone }: { tool: Tool; ctx: WorldCtx; onDone(): void }) {
  const { t } = useTranslation();
  const state = tool.useTool(ctx);
  if (!state.available) return null;
  const isSwitch = state.pressed !== undefined;
  return (
    <button
      type="button"
      role={isSwitch ? 'menuitemcheckbox' : 'menuitem'}
      aria-checked={isSwitch ? state.pressed : undefined}
      aria-keyshortcuts={tool.shortcut}
      title={tool.hintKey ? t(tool.hintKey) : undefined}
      tabIndex={-1}
      onClick={() => {
        state.run?.();
        onDone();
      }}
      className={MENU_ITEM}
    >
      <span aria-hidden="true" className="flex w-4 shrink-0 justify-center">{tool.icon}</span>
      <span className="min-w-0 flex-1">{t(tool.labelKey)}</span>
      {tool.shortcut && <kbd aria-hidden="true" className="chamfer border border-line px-1.5 font-sans text-xs text-muted">{tool.shortcut}</kbd>}
      {isSwitch && (
        <span aria-hidden="true" className={`relative h-4 w-7 shrink-0 chamfer border transition-colors ${state.pressed ? 'border-accent bg-accent' : 'border-edge bg-bg'}`}>
          <span className={`absolute top-px size-3 chamfer transition-[left] ${state.pressed ? 'left-3 bg-on-accent' : 'left-px bg-muted'}`} />
        </span>
      )}
    </button>
  );
}
