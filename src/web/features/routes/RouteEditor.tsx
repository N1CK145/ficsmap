import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { MeDto, RouteDto, WorldDto } from '../../../shared/api.js';
import { typeById } from '../../../shared/collectibleTypes.js';
import type { DatasetIndex, Item } from '../../../shared/dataset.js';
import { distance3d, UNITS_PER_METER } from '../../../shared/geo.js';
import { detectLocale } from '../../../shared/i18n.js';
import { MAX_ROUTE_STOPS } from '../../../shared/route.js';
import { ApiClientError } from '../../app/api.js';
import { useUiStore } from '../../app/store.js';
import { useIsMobile } from '../../app/useMediaQuery.js';
import { Button } from '../../components/Button.js';
import { ConfirmDialog } from '../../components/ConfirmDialog.js';
import { IconButton } from '../../components/IconButton.js';
import { useToast } from '../../components/Toast.js';
import { itemLabel } from '../itemPanel/label.js';
import { TypeIcon } from '../map/TypeIcon.js';
import { useDatasetQuery } from '../map/useDataset.js';
import { isCollected, useMarks, useSetMark, type MarksCache } from '../marks/useMarks.js';
import { useMe, useWorld } from '../worlds/queries.js';
import { goToStop, useNextStop } from './NextStopButton.js';
import { PodChecklist } from './PodChecklist.js';
import { nearestUncollected, optimizeDraft, replan, routeStats, type DraftAction, type RouteDraft } from './draft.js';
import { canEditRoute, deleteRoute, saveRoute, useRouteDraft, useRoutesQuery, isDirty, type DraftEnv } from './useRoutes.js';

const HINT_KEY = 'ficsmap:routeHintDismissed';
const MAX_NAME = 80;

function hintDismissed(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === '1';
  } catch {
    return false;
  }
}

function dismissHint(): void {
  try {
    localStorage.setItem(HINT_KEY, '1');
  } catch {
    // The hint shows again next time; that is fine.
  }
}

/** "310 m" below a kilometre, else "2.4 km". */
export function formatDistance(metres: number, locale: string): string {
  return metres < 1000
    ? new Intl.NumberFormat(locale, { style: 'unit', unit: 'meter', maximumFractionDigits: 0 }).format(metres)
    : new Intl.NumberFormat(locale, { style: 'unit', unit: 'kilometer', maximumFractionDigits: 1 }).format(metres / 1000);
}

/** The open route in the Routes panel (spec §10.6); edit controls only in the `route` map mode. */
export function RouteEditor({ worldId }: { worldId: string }) {
  const me = useMe().data;
  const world = useWorld(worldId).data;
  const index = useDatasetQuery(me?.datasetVersion).data;
  const marks = useMarks(worldId);
  const draft = useRouteDraft(s => s.draft);
  const routes = useRoutesQuery(worldId).data;
  if (!me || !world || !index || !marks || !draft) return null;
  const route = draft.id === null ? undefined : routes?.find(r => r.id === draft.id);
  return <EditorBody worldId={worldId} me={me} world={world} index={index} marks={marks} draft={draft} route={route} />;
}

interface BodyProps { worldId: string; me: MeDto; world: WorldDto; index: DatasetIndex; marks: MarksCache; draft: RouteDraft; route: RouteDto | undefined }

function EditorBody({ worldId, me, world, index, marks, draft, route }: BodyProps) {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const queryClient = useQueryClient();
  const setMark = useSetMark(worldId);
  const editing = useUiStore(s => s.interactionMode === 'route');
  const typeFilter = useUiStore(s => s.typeFilter);
  const biomeScope = useUiStore(s => s.biomeScope);
  const pickingStart = useRouteDraft(s => s.pickingStart);
  const dirty = useRouteDraft(isDirty);
  const [showHint, setShowHint] = useState(() => !hintDismissed());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  // On mobile [Next stop ›] is the sheet's sticky footer button (NextStopButton).
  const mobile = useIsMobile();

  const locale = detectLocale([i18n.language]);
  const env: DraftEnv = { index, toast, t };
  const apply = (a: DraftAction) => useRouteDraft.getState().apply(a, env);
  const canEdit = canEditRoute(route, draft.id, me, world);
  const isDone = (name: string) => isCollected(marks, name);

  const start = draft.start === null ? undefined : index.byName.get(draft.start);
  const stops = useMemo(() => draft.stops.flatMap(s => index.byName.get(s) ?? []), [draft.stops, index]);
  const stats = start && stops.length > 0 ? routeStats(start, stops, isDone) : null;
  const nextStop = useNextStop(worldId);

  /** Who checked a stop, when that is someone else. A write of the user's own still pending counts as theirs. */
  const doneBy = (name: string): number | null | undefined => {
    if (!isDone(name) || marks.pending.has(name)) return undefined;
    return marks.marks.get(name)?.updatedBy;
  };
  const byOthers = (name: string) => {
    const by = doneBy(name);
    return by !== undefined && by !== me.id;
  };
  const memberName = (id: number | null | undefined) => (id == null ? undefined : world.members.find(m => m.userId === id)?.displayName);
  // Stops others checked that still sit after an open stop: re-planning would move them to the front.
  const firstOpen = stops.findIndex(s => !isDone(s.name));
  const outOfPlace = firstOpen < 0 ? 0 : stops.slice(firstOpen + 1).filter(s => byOthers(s.name)).length;

  const beginEdit = () => useRouteDraft.getState().beginEdit(env);

  const candidates = () => index.items.filter(i => typeFilter.has(i.type) && (biomeScope === null || i.biome === biomeScope));
  const exclude = () => new Set([...(draft.start === null ? [] : [draft.start]), ...draft.stops]);
  const fillNearest = () => {
    if (!start) return;
    apply({ type: 'add', actors: nearestUncollected(start, candidates(), isDone, exclude(), MAX_ROUTE_STOPS - draft.stops.length) });
  };
  const addAllInBiome = () => {
    if (!start) return;
    apply({ type: 'add', actors: nearestUncollected(start, candidates(), isDone, exclude(), Infinity) });
  };
  const doReplan = () => {
    if (!start) return;
    if (!editing) beginEdit();
    apply({ type: 'optimize', order: replan(start, stops, isDone) });
  };
  const goToNext = () => {
    if (nextStop) goToStop(nextStop.name);
  };

  const failMessage = (err: unknown, fallback: string) =>
    (err instanceof ApiClientError && err.status === 403 ? t('routes.forbidden') : t(fallback));

  const save = async () => {
    setBusy(true);
    try {
      const saved = await saveRoute(worldId, draft, queryClient);
      useRouteDraft.getState().load(saved);
      toast.show({ message: t('routes.saved') });
      if (useUiStore.getState().interactionMode === 'route') useUiStore.getState().setMode('inspect');
    } catch (err) {
      toast.show({ message: failMessage(err, 'routes.saveFailed') });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (draft.id === null) return;
    setBusy(true);
    try {
      await deleteRoute(worldId, draft.id, queryClient);
      setConfirmDelete(false);
      useRouteDraft.getState().close();
      if (useUiStore.getState().interactionMode === 'route') useUiStore.getState().setMode('inspect');
      toast.show({ message: t('routes.deleted') });
    } catch (err) {
      setConfirmDelete(false);
      toast.show({ message: failMessage(err, 'routes.deleteFailed') });
    } finally {
      setBusy(false);
    }
  };

  const back = () => {
    const s = useRouteDraft.getState();
    if (editing && dirty) {
      s.requestLeave({ mode: 'inspect', close: true });
      return;
    }
    s.close();
    if (editing) useUiStore.getState().setMode('inspect');
  };

  const name = draft.name.trim();
  const canSave = name.length >= 1 && name.length <= MAX_NAME && start !== undefined && stops.length > 0 && (dirty || draft.id === null);
  const label = (item: Item) => itemLabel(item, t, index.ds.biomes, locale);

  return (
    <div className="flex flex-col gap-3">
      <Button variant="ghost" size="sm" className="self-start" onClick={back}>{t('routes.back')}</Button>

      <div className="flex items-baseline gap-2">
        <h3 className="shrink-0 font-display text-sm font-semibold tracking-wider text-muted uppercase">{t('routes.heading')}</h3>
        {editing && canEdit ? (
          <input
            aria-label={t('routes.name')}
            value={draft.name}
            maxLength={MAX_NAME}
            onChange={e => apply({ type: 'rename', name: e.target.value })}
            className="min-w-0 flex-1 rounded border border-line bg-bg px-2 py-1 focus-ring"
          />
        ) : (
          <span className="min-w-0 flex-1 truncate font-medium">“{draft.name}”</span>
        )}
        <span className="shrink-0 font-display tabular-nums">{t('routes.capacity', { count: stops.length, max: MAX_ROUTE_STOPS })}</span>
      </div>

      <div className="flex items-center gap-2 text-sm">
        <span className="text-muted">{t('routes.start')}</span>
        {start && !pickingStart ? (
          <>
            <TypeIcon type={typeById(start.type)} size={14} className="shrink-0" />
            <span className="min-w-0 flex-1 truncate">{label(start)}</span>
          </>
        ) : (
          <span className="min-w-0 flex-1 text-accent">{t('routes.pickStart')}</span>
        )}
        {editing && start && (
          <Button size="sm" variant="ghost" aria-pressed={pickingStart} onClick={() => useRouteDraft.getState().setPickingStart(!pickingStart)}>
            {t('routes.change')}
          </Button>
        )}
      </div>

      {editing && (
        <div className="flex flex-col gap-2">
          <Button size="sm" disabled={!start || draft.stops.length >= MAX_ROUTE_STOPS} onClick={fillNearest}>
            {t('routes.fillNearest', { max: MAX_ROUTE_STOPS })}
          </Button>
          {biomeScope !== null && index.ds.biomes[biomeScope] && (
            <Button size="sm" disabled={!start} onClick={addAllInBiome}>
              {t('routes.allInBiome', { biome: index.ds.biomes[biomeScope].name[locale] })}
            </Button>
          )}
        </div>
      )}

      {showHint && (
        <p className="flex items-center gap-2 text-sm text-muted">
          <span className="flex-1">{t('routes.hint')}</span>
          <Button size="sm" variant="ghost" onClick={() => { dismissHint(); setShowHint(false); }}>{t('routes.dismiss')}</Button>
        </p>
      )}

      {outOfPlace > 0 && (editing || canEdit) && (
        <Button size="sm" variant="link-accent" className="self-start" onClick={doReplan}>
          {t('routes.doneByOthers', { count: outOfPlace })} · {t('routes.replan')}
        </Button>
      )}

      {editing && draft.manualOrder && (
        <p className="flex items-center gap-2 text-sm">
          <span className="text-muted">{t('routes.orderChanged')} ·</span>
          <Button size="sm" variant="link-accent" onClick={() => apply({ type: 'optimize', order: optimizeDraft(draft, index).stops })}>
            {t('routes.optimizeAgain')}
          </Button>
        </p>
      )}

      <StopList
        start={start}
        stops={stops}
        editing={editing}
        isDone={isDone}
        doneByName={n => (byOthers(n) ? memberName(doneBy(n)) ?? '' : undefined)}
        label={label}
        locale={i18n.language}
        onCheck={(n, on) => void setMark(n, on)}
        onMove={(from, to) => apply({ type: 'move', from, to })}
        onRemove={n => apply({ type: 'remove', actor: n })}
      />

      {stats && (
        <p className="font-display text-sm tabular-nums">
          {t('routes.total', {
            total: formatDistance(stats.totalM, i18n.language), left: formatDistance(stats.leftM, i18n.language), done: stats.done, count: stats.count,
          })}
        </p>
      )}

      {/* On desktop the list floats over the map instead (PodChecklistOverlay). */}
      {mobile && <PodChecklist worldId={worldId} />}

      <div className="flex flex-wrap gap-2">
        {editing && (
          <Button size="sm" disabled={!start || stops.length < 2} onClick={() => apply({ type: 'optimize', order: optimizeDraft(draft, index).stops })}>
            {t('routes.optimize')}
          </Button>
        )}
        {!mobile && (
          <Button size="sm" variant={editing ? 'secondary' : 'primary'} disabled={!nextStop} onClick={goToNext}>{t('routes.next')}</Button>
        )}
        {editing && canEdit && (
          <Button size="sm" variant="primary" disabled={!canSave || busy} onClick={() => void save()}>{t('routes.save')}</Button>
        )}
        {!editing && canEdit && <Button size="sm" onClick={beginEdit}>{t('routes.edit')}</Button>}
        {canEdit && draft.id !== null && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmDelete(true)}>{t('routes.delete')}</Button>
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        message={t('routes.deleteTitle', { name: draft.name })}
        confirmLabel={t('routes.delete')}
        danger
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}

interface StopListProps {
  start: Item | undefined;
  stops: Item[];
  editing: boolean;
  isDone(name: string): boolean;
  /** The teammate's name for a stop someone else checked ('' if unknown), else undefined. */
  doneByName(name: string): string | undefined;
  label(item: Item): string;
  locale: string;
  onCheck(name: string, collected: boolean): void;
  onMove(from: number, to: number): void;
  onRemove(name: string): void;
}

/**
 * The stop rows: number, shape, label, distance from the previous point; in edit mode drag (≡),
 * Alt+↑/↓ and ×. Touch has no HTML5 drag and drop, so on mobile ▲/▼ buttons replace the drag handle.
 */
function StopList({ start, stops, editing, isDone, doneByName, label, locale, onCheck, onMove, onRemove }: StopListProps) {
  const { t } = useTranslation();
  const mobile = useIsMobile();
  const rows = useRef(new Map<string, HTMLLIElement>());
  const dragFrom = useRef<number | null>(null);
  // A moved row keeps the keyboard focus.
  const refocus = useRef<string | null>(null);
  useEffect(() => {
    if (refocus.current === null) return;
    rows.current.get(refocus.current)?.focus();
    refocus.current = null;
  });

  const move = (i: number, to: number) => {
    if (to >= 0 && to < stops.length) onMove(i, to);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLLIElement>, i: number, name: string) => {
    if (!editing || !e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
    e.preventDefault();
    refocus.current = name;
    move(i, e.key === 'ArrowUp' ? i - 1 : i + 1);
  };
  const onDrop = (e: DragEvent<HTMLLIElement>, to: number) => {
    e.preventDefault();
    const from = dragFrom.current;
    dragFrom.current = null;
    if (from !== null && from !== to) onMove(from, to);
  };

  return (
    <ol aria-label={t('routes.stops')} className="flex flex-col border-y border-line">
      {stops.map((stop, i) => {
        const done = isDone(stop.name);
        const by = doneByName(stop.name);
        const prev = i === 0 ? start : stops[i - 1];
        const metres = prev ? distance3d(prev, stop) / UNITS_PER_METER : null;
        return (
          <li
            key={stop.name}
            ref={el => { if (el) rows.current.set(stop.name, el); else rows.current.delete(stop.name); }}
            tabIndex={0}
            draggable={editing && !mobile}
            onKeyDown={e => onKeyDown(e, i, stop.name)}
            onDragStart={e => {
              dragFrom.current = i;
              // Firefox only starts a drag that carries data.
              e.dataTransfer.setData('text/plain', stop.name);
              e.dataTransfer.effectAllowed = 'move';
            }}
            onDragOver={e => { if (editing) e.preventDefault(); }}
            onDrop={e => onDrop(e, i)}
            className={`flex items-center py-1 text-sm focus-ring ${mobile ? 'gap-1' : 'gap-2'}`}
          >
            <span className="w-6 shrink-0 text-right font-display tabular-nums">{done && '✓'}{i + 1}</span>
            <input type="checkbox" aria-label={t('routes.done')} checked={done} onChange={e => onCheck(stop.name, e.target.checked)} className="size-4 shrink-0 accent-accent focus-ring" />
            <TypeIcon type={typeById(stop.type)} size={14} className="shrink-0" />
            <span className={`min-w-0 flex-1 truncate ${done ? 'text-muted line-through' : ''}`}>{label(stop)}</span>
            {by !== undefined && by !== '' && <span className="shrink-0 text-muted">{t('routes.doneBy', { name: by })}</span>}
            <span className="shrink-0 text-muted tabular-nums">
              {done || metres === null ? t('routes.noDistance') : formatDistance(metres, locale)}
            </span>
            {editing && mobile && (
              <>
                <IconButton aria-label={t('routes.moveUp')} size="touch" disabled={i === 0} onClick={() => move(i, i - 1)}>
                  <span aria-hidden="true">▲</span>
                </IconButton>
                <IconButton aria-label={t('routes.moveDown')} size="touch" disabled={i === stops.length - 1} onClick={() => move(i, i + 1)}>
                  <span aria-hidden="true">▼</span>
                </IconButton>
              </>
            )}
            {editing && (
              <>
                {!mobile && <span aria-hidden="true" title={t('routes.drag')} className="shrink-0 cursor-grab px-1 text-muted">≡</span>}
                <IconButton aria-label={t('routes.remove')} size={mobile ? 'touch' : 'sm'} onClick={() => onRemove(stop.name)}><span aria-hidden="true">×</span></IconButton>
              </>
            )}
          </li>
        );
      })}
    </ol>
  );
}
