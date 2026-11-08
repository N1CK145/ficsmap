import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { collect, type Tool, type WorldCtx } from '../../app/feature.js';
import { useFeatures } from '../../app/FeaturesContext.js';
import { useWorldPage, worldPath } from '../../app/pages.js';
import { useMediaQuery } from '../../app/useMediaQuery.js';
import { Button, buttonClass } from '../../components/Button.js';
import { IconButton } from '../../components/IconButton.js';

/** From this width the tools are buttons in the top bar; below it they are in the Tools menu. */
export const WIDE_QUERY = '(min-width: 1280px)';

/** Three sliders: the Tools menu's icon. */
function ToolsIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false" className="shrink-0">
      <g stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <path d="M2 4h12M2 8h12M2 12h12" opacity="0.55" />
      </g>
      <g fill="currentColor">
        <circle cx="5" cy="4" r="1.9" /><circle cx="11" cy="8" r="1.9" /><circle cx="7" cy="12" r="1.9" />
      </g>
    </svg>
  );
}

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
    <nav aria-label={t('tools.label')} className="flex shrink-0 items-center gap-1.5">
      {tools.filter(tool => !tool.action).map(tool => <ToolButton key={tool.id} tool={tool} ctx={ctx} />)}
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
      variant={state.pressed ? 'primary' : 'secondary'}
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
        ? <IconButton aria-label={t('tools.label')} size="sm" {...buttonProps}><ToolsIcon /></IconButton>
        : <Button size="sm" {...buttonProps}><ToolsIcon />{t('tools.label')}</Button>}
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={t('tools.label')}
          onKeyDown={onMenuKeyDown}
          className="absolute top-full right-0 z-[1400] mt-1 flex w-60 flex-col rounded border border-line bg-panel p-1 shadow-lg"
        >
          {tools.map(tool => (tool.page === undefined
            ? <ToolMenuItem key={tool.id} tool={tool} ctx={ctx} onDone={() => close(true)} />
            : <PageMenuItem key={tool.id} tool={tool} page={tool.page} ctx={ctx} onDone={() => close(true)} />))}
        </div>
      )}
    </div>
  );
}

const MENU_ITEM = 'flex min-h-11 w-full items-center gap-2 rounded px-2 text-left text-sm text-fg focus-ring hover:bg-line focus:bg-line min-[900px]:min-h-9';

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
      className={`${MENU_ITEM} ${link.current ? 'bg-line font-semibold' : ''}`}
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
      {tool.shortcut && <kbd aria-hidden="true" className="rounded border border-line px-1 font-sans text-xs text-muted">{tool.shortcut}</kbd>}
      {isSwitch && (
        <span aria-hidden="true" className={`relative h-4 w-7 shrink-0 rounded-full transition-colors ${state.pressed ? 'bg-accent' : 'bg-line'}`}>
          <span className={`absolute top-0.5 size-3 rounded-full bg-fg transition-[left] ${state.pressed ? 'left-3.5' : 'left-0.5'}`} />
        </span>
      )}
    </button>
  );
}
