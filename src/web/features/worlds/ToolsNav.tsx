import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { collect, type Tool, type WorldCtx } from '../../app/feature.js';
import { useFeatures } from '../../app/FeaturesContext.js';
import { useWorldPage, worldPath } from '../../app/pages.js';
import { useMediaQuery } from '../../app/useMediaQuery.js';
import { Button, buttonClass } from '../../components/Button.js';
import { ChevronDownIcon, SlidersIcon as ToolsIcon } from '../../components/icons.js';
import { IconButton } from '../../components/IconButton.js';
import { POPOVER } from '../../components/Window.js';

/** From this width the tools are buttons in the top bar; below it they are in the Tools menu. */
export const WIDE_QUERY = '(min-width: 1280px)';

/**
 * The tool navigation in the top bar: every feature's `tools` (map layers such as Caves and Heights,
 * resource nodes). Wide screens get a button per map switch, filled while it is on, and one "Tools" menu
 * for the tools that are not map switches (`action`: the pages planner, vehicle calculator and machine wiki);
 * narrower screens and phones get one "Tools" menu with every entry. A tool with a `page` is a link to that
 * world page, marked with `aria-current="page"` while the page is shown.
 */
export function ToolsNav({ ctx, mobile }: { ctx: WorldCtx; mobile: boolean }) {
  const { t } = useTranslation();
  const features = useFeatures();
  const tools = useMemo(() => collect(features, 'tools'), [features]);
  const wide = useMediaQuery(WIDE_QUERY);
  if (tools.length === 0) return null;
  if (mobile || !wide) return <ToolsMenu ctx={ctx} tools={tools} iconOnly={mobile} />;
  const actions = tools.filter(tool => tool.action);
  return (
    <nav aria-label={t('tools.label')} className="flex shrink-0 items-center gap-2">
      {/* The map switches as one bar of plates, like the game's hotbar; the pages' menu next to it. */}
      <div className="flex items-center gap-0.5 chamfer border border-line bg-bg p-0.5">
        {tools.filter(tool => !tool.action).map(tool => <ToolButton key={tool.id} tool={tool} ctx={ctx} />)}
      </div>
      {actions.length > 0 && <ToolsMenu ctx={ctx} tools={actions} iconOnly={false} />}
    </nav>
  );
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

/** The Tools menu button and its menu (a WAI-ARIA menu button: arrows, Home/End, Esc, Tab). */
function ToolsMenu({ ctx, tools, iconOnly }: { ctx: WorldCtx; tools: readonly Tool[]; iconOnly: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

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

  const buttonProps = {
    ref: buttonRef,
    'aria-haspopup': 'menu' as const,
    'aria-expanded': open,
    'aria-controls': open ? menuId : undefined,
    onClick: () => setOpen(o => !o),
    onKeyDown: (e: ReactKeyboardEvent) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      setOpen(true);
    },
  };

  return (
    <div ref={rootRef} className="relative shrink-0">
      {iconOnly
        ? <IconButton aria-label={t('tools.label')} size="sm" variant={open ? 'secondary' : 'ghost'} {...buttonProps}><ToolsIcon /></IconButton>
        : (
          <Button size="sm" {...buttonProps}>
            <ToolsIcon />{t('tools.label')}
            <ChevronDownIcon size={12} className={`-mr-1 motion-safe:transition-transform ${open ? 'rotate-180' : ''}`} />
          </Button>
        )}
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={t('tools.label')}
          onKeyDown={onMenuKeyDown}
          // On a phone the menu spans the screen under the top bar, so it is never cut off at an edge.
          className={`z-[1400] flex flex-col p-1 ${POPOVER} ${iconOnly ? 'fixed inset-x-2 top-14' : 'absolute top-full right-0 mt-2 w-64'}`}
        >
          {tools.map(tool => (tool.page === undefined
            ? <ToolMenuItem key={tool.id} tool={tool} ctx={ctx} onDone={() => close(true)} />
            : <PageMenuItem key={tool.id} tool={tool} page={tool.page} ctx={ctx} onDone={() => close(true)} />))}
        </div>
      )}
    </div>
  );
}

const MENU_ITEM = 'flex min-h-11 w-full items-center gap-2.5 chamfer px-2.5 text-left text-sm text-fg outline-none hover:bg-raised focus:bg-raised focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-inset min-[900px]:min-h-9';

/** A page tool as a menu entry: a link item, the current page marked (also with a dot). */
function PageMenuItem({ tool, page, ctx, onDone }: { tool: Tool; page: string; ctx: WorldCtx; onDone(): void }) {
  const { t } = useTranslation();
  const state = tool.useTool(ctx);
  const link = usePageLink(page, ctx);
  if (!state.available) return null;
  return (
    <Link
      to={link.to}
      role="menuitem"
      aria-current={link.current ? 'page' : undefined}
      title={tool.hintKey ? t(tool.hintKey) : undefined}
      tabIndex={-1}
      onClick={onDone}
      // A menu item also takes Space; a link alone only Enter.
      onKeyDown={e => {
        if (e.key !== ' ') return;
        e.preventDefault();
        e.currentTarget.click();
      }}
      className={`${MENU_ITEM} ${link.current ? 'font-semibold text-accent' : ''}`}
    >
      <span aria-hidden="true" className="flex w-4 shrink-0 justify-center">{tool.icon}</span>
      <span className="min-w-0 flex-1">{t(tool.labelKey)}</span>
      {link.current && <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-accent" />}
    </Link>
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
