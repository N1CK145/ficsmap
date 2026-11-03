import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useId, useLayoutEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useMatch, useNavigate, useParams, useSearchParams } from 'react-router';
import { ApiClientError } from '../../app/api.js';
import { collect, type SidebarPanel, type WorldCtx } from '../../app/feature.js';
import { useFeatures } from '../../app/FeaturesContext.js';
import { loadView, setLastWorld } from '../../app/persist.js';
import { useUiStore } from '../../app/store.js';
import { useIsMobile } from '../../app/useMediaQuery.js';
import { Button, buttonClass } from '../../components/Button.js';
import { Header } from '../../components/Header.js';
import { IconButton } from '../../components/IconButton.js';
import { Panel } from '../../components/Panel.js';
import { useToast } from '../../components/Toast.js';
import { ImportBanner } from '../import/ImportBanner.js';
import { ImportDialogHost } from '../import/ImportDialog.js';
import { useWorldEvents } from '../live/useWorldEvents.js';
import { ListView } from '../listView/ListView.js';
import { SettingsPage } from '../sharing/SettingsPage.js';
import { ItemPanel } from '../itemPanel/ItemPanel.js';
import { MapView } from '../map/MapView.js';
import { useDatasetQuery } from '../map/useDataset.js';
import { SIDEBAR, useSidebarWidth } from './useSidebarWidth.js';
import { useMarks, useMarksQuery } from '../marks/useMarks.js';
import { useUndoStack } from '../marks/undo.js';
import { useUndoShortcut } from '../marks/useUndoShortcut.js';
import { BottomSheet } from '../mobile/BottomSheet.js';
import { ItemSheet } from '../mobile/ItemSheet.js';
import type { Snap } from '../mobile/snap.js';
import { ProgressChips } from '../progress/ProgressChips.js';
import { useQuickCheckKeys } from '../quickCheck/useQuickCheckKeys.js';
import { NextStopButton } from '../routes/NextStopButton.js';
import { useRouteDraft } from '../routes/useRoutes.js';
import { AccountMenu } from './AccountMenu.js';
import { useMe, useWorld } from './queries.js';
import { useSidebarKey } from './useSidebarKey.js';

/**
 * `/w/:id`: loads everything a world needs (me, world, dataset, marks), then renders the header,
 * the sidebar panels from the features' extension points, the map (which hosts the map ones) and the
 * item panel over it. Ctrl+Z, Q, Esc and `[` (sidebar) work anywhere in the world. Below 900 px the
 * panels move into a bottom sheet and the item panel into an item sheet (spec §10.11).
 */
export function WorldLayout() {
  const { id = '' } = useParams();
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();

  const me = useMe();
  const world = useWorld(id);
  const dataset = useDatasetQuery(me.data?.datasetVersion);
  const marks = useMarksQuery(id);

  // Per-world UI state is reset before anything of the new world renders.
  const [enteredId, setEnteredId] = useState<string | null>(null);
  useLayoutEffect(() => {
    useUiStore.getState().enterWorld(id, loadView(id) ?? undefined);
    useUndoStack.getState().clear();
    setEnteredId(id);
  }, [id]);

  const loadedWorld = world.data;
  useEffect(() => {
    if (loadedWorld) setLastWorld(loadedWorld.id);
  }, [loadedWorld]);

  // Info toasts after an invite link (spec §8, §10.9); the flag is removed so a reload stays quiet.
  const joined = params.get('joined') === '1';
  const already = params.get('already') === '1';
  useEffect(() => {
    if (!loadedWorld || (!joined && !already)) return;
    toast.show({
      message: joined
        ? t('world.joined', { world: loadedWorld.name, owner: loadedWorld.owner.displayName })
        : t('world.already'),
    });
    setParams(p => {
      p.delete('joined');
      p.delete('already');
      return p;
    }, { replace: true });
  }, [loadedWorld, joined, already, toast, t, setParams]);

  const ctx = useMemo<WorldCtx | null>(() => {
    if (!me.data || !world.data || !dataset.data) return null;
    return {
      worldId: id, world: world.data, me: me.data, index: dataset.data, queryClient,
      navigate: (to, opts) => void navigate(to, opts), toast,
    };
  }, [id, me.data, world.data, dataset.data, queryClient, navigate, toast]);

  // A failed background refetch keeps showing the loaded data; only a missing world replaces it.
  const isNotFound = (err: unknown) => err instanceof ApiClientError && err.status === 404;
  const failed = [world, me, dataset, marks].find(q => q.isError && (q.data === undefined || isNotFound(q.error)));
  if (failed) {
    const notFound = isNotFound(failed.error);
    return (
      <Screen>
        <h1 className="font-display text-3xl font-bold">{t(notFound ? 'world.notFound' : 'world.loadFailed')}</h1>
        <div className="flex gap-2">
          {!notFound && <Button onClick={() => void failed.refetch()}>{t('common.retry')}</Button>}
          <Link to="/?list=1" className={buttonClass({ variant: 'primary' })}>{t('world.goToWorlds')}</Link>
        </div>
      </Screen>
    );
  }
  if (!ctx || !marks.data || enteredId !== id) {
    return <Screen><p className="text-muted">{t('common.loading')}</p></Screen>;
  }
  return <WorldShell ctx={ctx} />;
}

function Screen({ children }: { children: ReactNode }) {
  return <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-4 text-center">{children}</main>;
}

function WorldShell({ ctx }: { ctx: WorldCtx }) {
  const { t } = useTranslation();
  const mainView = useUiStore(s => s.mainView);
  const inSettings = useMatch('/w/:id/settings') !== null;
  const mobile = useIsMobile();
  const features = useFeatures();
  useWorldEvents(ctx.worldId, ctx);
  useUndoShortcut(ctx);
  useQuickCheckKeys();
  useSidebarKey(!mobile && !inSettings);
  // Sidebar panels' `visible` read the marks cache, so the shell re-renders when it changes.
  useMarks(ctx.worldId);

  const { headerItems, panels } = useMemo(() => ({
    headerItems: collect(features, 'headerItems'),
    panels: collect(features, 'sidebarPanels'),
  }), [features]);
  const shown = panels.filter(p => p.visible?.(ctx) ?? true);
  const sidebarId = useId();
  const hasSidebar = !inSettings && !mobile;
  // On mobile the map is always the main area; the sheet's full height is the list view.
  const view = inSettings ? 'settings' : mobile ? 'map' : mainView;

  return (
    <div className="flex h-dvh flex-col">
      <Header end={<AccountMenu />}>
        {hasSidebar && <SidebarToggle sidebarId={sidebarId} />}
        <h1 className="min-w-0 truncate font-display text-lg font-semibold">{ctx.world.name}</h1>
        {headerItems.map(h => <h.Component key={h.id} ctx={ctx} />)}
      </Header>
      <div className="flex min-h-0 flex-1">
        {hasSidebar && <Sidebar id={sidebarId} ctx={ctx} panels={shown} />}
        <section role="region" aria-label={t(view === 'settings' ? 'settings.title' : view === 'list' ? 'list.caption' : 'world.map')} className="relative min-w-0 flex-1 bg-bg">
          {view === 'settings' ? <SettingsPage ctx={ctx} /> : view === 'list' ? <ListView ctx={ctx} /> : <MapView ctx={ctx} />}
          <ImportBanner worldId={ctx.worldId} />
          {view === 'map' && !mobile && <ItemPanel ctx={ctx} />}
        </section>
      </div>
      {!inSettings && mobile && <MobileSheets ctx={ctx} panels={shown.filter(p => !p.desktopOnly)} />}
      <ImportDialogHost ctx={ctx} />
    </div>
  );
}

/**
 * The desktop sidebar. Closing it (`[`) slides it to zero width, instantly with reduced motion; while
 * closed it is inert and hidden from assistive technology. It starts as wide as its panels need and
 * can be resized with the handle on its right edge (double-click: fit the content again).
 */
function Sidebar({ id, ctx, panels }: { id: string; ctx: WorldCtx; panels: SidebarPanel[] }) {
  const { t } = useTranslation();
  const open = useUiStore(s => s.sidebarOpen);
  const { width, fit, dragging, scrollRef, contentRef, handleProps, bounds } = useSidebarWidth();
  return (
    <aside
      id={id}
      aria-label={t('world.sidebar')}
      aria-hidden={open ? undefined : true}
      inert={!open}
      style={{ width: open ? width : 0 }}
      className={`relative shrink-0 overflow-hidden border-line bg-panel ${dragging ? '' : 'motion-safe:transition-[width,visibility] motion-safe:duration-200'} ${open ? 'visible border-r' : 'invisible'}`}
    >
      <div ref={scrollRef} className="h-full overflow-y-auto [scrollbar-gutter:stable]" style={{ width }}>
        <div
          ref={contentRef}
          data-fit={fit || undefined}
          style={fit ? { width: 'max-content', minWidth: SIDEBAR.fitMin, maxWidth: SIDEBAR.fitMax } : undefined}
        >
          {panels.map(p => (
            <Panel key={p.id} title={t(p.titleKey)}><p.Component worldId={ctx.worldId} /></Panel>
          ))}
        </div>
      </div>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t('world.resizeSidebar')}
        aria-controls={id}
        aria-valuenow={width}
        aria-valuemin={bounds.min}
        aria-valuemax={bounds.max}
        title={t('world.resizeSidebarHint')}
        tabIndex={open ? 0 : -1}
        {...handleProps}
        className={`absolute inset-y-0 right-0 z-10 w-1.5 cursor-col-resize touch-none select-none focus-ring hover:bg-accent/60 ${dragging ? 'bg-accent' : ''}`}
      />
    </aside>
  );
}

/** The header button that hides and shows the desktop sidebar, for mouse users (keyboard: `[`). */
function SidebarToggle({ sidebarId }: { sidebarId: string }) {
  const { t } = useTranslation();
  const open = useUiStore(s => s.sidebarOpen);
  return (
    <IconButton
      aria-label={t(open ? 'world.hideSidebar' : 'world.showSidebar')}
      title={t(open ? 'world.hideSidebar' : 'world.showSidebar')}
      aria-expanded={open}
      aria-controls={sidebarId}
      aria-keyshortcuts="["
      size="sm"
      className="-ml-1"
      onClick={() => useUiStore.getState().toggleSidebar()}
    >
      <span aria-hidden="true">☰</span>
    </IconButton>
  );
}

/**
 * Mobile (spec §10.11): the sidebar panels in the bottom sheet (peek: progress chips, half: the
 * panels with a sticky [Next stop ›] while a route is open, full: the list view) and the selected
 * item in the item sheet above it. "Show on map" from the list drops the sheet to peek.
 */
function MobileSheets({ ctx, panels }: { ctx: WorldCtx; panels: SidebarPanel[] }) {
  const { t } = useTranslation();
  const [snap, setSnap] = useState<Snap>('peek');
  const routeOpen = useRouteDraft(s => s.draft !== null);
  useEffect(() => useUiStore.subscribe((s, prev) => {
    if (s.focusRequest && !prev.focusRequest) setSnap('peek');
  }), []);

  return (
    <>
      <BottomSheet
        label={t('mobile.sheet.label')}
        snap={snap}
        onSnap={setSnap}
        footer={snap === 'half' && routeOpen ? <NextStopButton worldId={ctx.worldId} /> : undefined}
      >
        {snap === 'peek' && <ProgressChips worldId={ctx.worldId} />}
        {/* The panels stay mounted, so their state (route editor, conflict stepper) survives a resize. */}
        <div hidden={snap !== 'half'}>
          {panels.map(p => (
            <Panel key={p.id} title={t(p.titleKey)}><p.Component worldId={ctx.worldId} /></Panel>
          ))}
        </div>
        {snap === 'full' && <ListView ctx={ctx} />}
      </BottomSheet>
      <ItemSheet ctx={ctx} />
    </>
  );
}
