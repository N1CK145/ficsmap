import { useEffect, useMemo, useRef, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { COLLECTIBLE_TYPES, type CollectibleType } from '../../../shared/collectibleTypes.js';
import { useUiStore } from '../../app/store.js';
import { useDatasetQuery } from '../map/useDataset.js';
import { TypeIcon } from '../map/TypeIcon.js';
import { isCollected, useMarks } from '../marks/useMarks.js';
import { useMe } from '../worlds/queries.js';
import { countProgress, type Count } from './count.js';
import { VisibilityControl } from './VisibilityControl.js';

const LONG_PRESS_MS = 500;

/**
 * The Progress panel (spec §10): one row per collectible type with done/total, each a filter toggle
 * (Alt-click, Alt+Enter/Space or a long press shows only that type), and the collected visibility control. With a
 * biome selected the counts cover that biome.
 */
export function ProgressPanel({ worldId }: { worldId: string }) {
  const { i18n } = useTranslation();
  const index = useDatasetQuery(useMe().data?.datasetVersion).data;
  const marks = useMarks(worldId);
  const typeFilter = useUiStore(s => s.typeFilter);
  const biomeScope = useUiStore(s => s.biomeScope);

  const counts = useMemo(() => {
    if (!index || !marks) return null;
    return countProgress(index.items, name => isCollected(marks, name), { typeFilter, biome: biomeScope, biomeCount: index.ds.biomes.length });
  }, [index, marks, typeFilter, biomeScope]);
  if (!index || !counts) return null;

  const biome = biomeScope === null ? undefined : index.ds.biomes[biomeScope];
  const biomeName = biome ? biome.name[i18n.language === 'de' ? 'de' : 'en'] : null;

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col">
        {COLLECTIBLE_TYPES.map(type => (
          <li key={type.id}>
            <ProgressRow type={type} count={counts.byType[type.id]} biomeName={biomeName} enabled={typeFilter.has(type.id)} />
          </li>
        ))}
      </ul>
      <VisibilityControl />
    </div>
  );
}

function ProgressRow({ type, count, biomeName, enabled }: { type: CollectibleType; count: Count; biomeName: string | null; enabled: boolean }) {
  const { t } = useTranslation();
  const toggleType = useUiStore(s => s.toggleType);
  const showOnlyType = useUiStore(s => s.showOnlyType);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Set when a long press fired, so the click that ends it does not toggle again.
  const longPressed = useRef(false);
  // Set when Alt+Enter/Space was handled, so a keyboard click that may follow does not toggle.
  const keyHandled = useRef(false);

  const cancelPress = () => {
    clearTimeout(timer.current);
    timer.current = undefined;
  };
  useEffect(() => cancelPress, []);

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    longPressed.current = false;
    cancelPress();
    timer.current = setTimeout(() => {
      timer.current = undefined;
      longPressed.current = true;
      showOnlyType(type.id);
    }, LONG_PRESS_MS);
  }

  // Browsers differ in whether Alt+Enter/Space clicks a button, so it is handled here.
  function onKeyDown(e: KeyboardEvent) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    keyHandled.current = e.altKey;
    if (!e.altKey) return;
    e.preventDefault();
    showOnlyType(type.id);
  }

  function onClick(e: MouseEvent) {
    if (longPressed.current) {
      longPressed.current = false;
      return;
    }
    // detail 0: the click came from the keyboard.
    if (e.detail === 0 && keyHandled.current) {
      keyHandled.current = false;
      return;
    }
    if (e.altKey) showOnlyType(type.id);
    else toggleType(type.id);
  }

  const numbers = { done: count.done, total: count.total };
  return (
    <button
      type="button"
      aria-pressed={enabled}
      title={t('progress.hint')}
      onPointerDown={onPointerDown}
      onPointerUp={cancelPress}
      onPointerLeave={cancelPress}
      onPointerCancel={cancelPress}
      // A long press on touch would also open the context menu.
      onContextMenu={e => { if (longPressed.current || timer.current !== undefined) e.preventDefault(); }}
      onKeyDown={onKeyDown}
      onClick={onClick}
      className={`flex h-9 w-full items-center gap-2 rounded px-2 text-left select-none focus-ring hover:bg-bg ${enabled ? 'text-fg' : 'text-muted'}`}
    >
      <TypeIcon type={type} className={`shrink-0 ${enabled ? '' : 'opacity-40'}`} />
      <span className="min-w-0 flex-1 truncate">{t(`progress.types.${type.id}`)}</span>
      <span className="shrink-0 font-display tabular-nums">
        {biomeName === null ? t('progress.count', numbers) : t('progress.inBiome', { ...numbers, biome: biomeName })}
      </span>
    </button>
  );
}
