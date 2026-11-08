import { memo, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { typeById } from '../../../shared/collectibleTypes.js';
import type { Item } from '../../../shared/dataset.js';
import { detectLocale } from '../../../shared/i18n.js';
import type { WorldCtx } from '../../app/feature.js';
import { useUiStore } from '../../app/store.js';
import { Button } from '../../components/Button.js';
import { PinIcon } from '../../components/icons.js';
import { itemLabel } from '../itemPanel/label.js';
import { TypeIcon } from '../map/TypeIcon.js';
import { hasMismatch, isCollected, useMarks, useSetMark, type SetMark } from '../marks/useMarks.js';

interface RowProps {
  item: Item; label: string; typeLabel: string; biome: string; collected: boolean; conflict: boolean;
  /** undefined: unchecked; null: checked by someone who is not (or no longer) a member. */
  by: string | null | undefined;
  someone: string;
  texts: { conflict: string; showOnMap: string; none: string };
  setMark: SetMark;
  show(actor: string): void;
}

const Row = memo(function Row({ item, label, typeLabel, biome, collected, conflict, by, someone, texts, setMark, show }: RowProps) {
  const cell = 'px-2 py-1.5 align-middle @2xl:px-3';
  // Narrow (the phone's full sheet): the type, biome and "changed by" columns give way; the item cell shows the type's
  // icon and who changed it, and "Show on map" is an icon. The label already names type and biome.
  const wide = 'hidden @2xl:table-cell';
  const changed = by === undefined ? texts.none : by ?? someone;
  return (
    <tr className="border-t border-line hover:bg-raised">
      <td className={`${cell} ${wide}`}><span className="flex items-center gap-2"><TypeIcon type={typeById(item.type)} className="shrink-0" /><span>{typeLabel}</span></span></td>
      <td className={cell}>
        <span className="flex items-center gap-2">
          <TypeIcon type={typeById(item.type)} className="shrink-0 @2xl:hidden" />
          <span className="min-w-0">
            {label}
            {by !== undefined && <span className="block text-xs text-muted @2xl:hidden">{changed}</span>}
          </span>
        </span>
      </td>
      <td className={`${cell} ${wide}`}>{biome}</td>
      <td className={cell}>
        {/* The label is the touch target around the box: 44 px square on a phone. */}
        <label className="flex items-center gap-2 max-[899px]:-my-1.5 max-[899px]:cursor-pointer">
          <span className="flex shrink-0 items-center justify-center max-[899px]:size-11">
            <input type="checkbox" aria-label={label} checked={collected} onChange={() => void setMark(item.name, !collected)} className="size-4 accent-accent focus-ring max-[899px]:size-5" />
          </span>
          {conflict && (
            <>
              <span aria-hidden="true" className="font-bold text-conflict">!</span>
              <span className="sr-only">{texts.conflict}</span>
            </>
          )}
        </label>
      </td>
      <td className={`${cell} ${wide}`}>{changed}</td>
      <td className={`${cell} text-right`}>
        <Button size="sm" title={texts.showOnMap} onClick={() => show(item.name)}>
          <PinIcon className="@2xl:hidden" />
          <span className="@max-2xl:sr-only">{texts.showOnMap}</span><span className="sr-only"> {label}</span>
        </Button>
      </td>
    </tr>
  );
});

/**
 * The list view (spec §10.10): every item matching the type filter, biome scope and collected
 * visibility as a real table with labelled checkboxes. Also the accessible alternative to the map.
 * Conflicts ignore Hide, and "only conflicts" hides everything else, as on the map.
 */
export function ListView({ ctx }: { ctx: WorldCtx }) {
  const { t, i18n } = useTranslation();
  const marks = useMarks(ctx.worldId);
  const setMark = useSetMark(ctx.worldId);
  const typeFilter = useUiStore(s => s.typeFilter);
  const biomeScope = useUiStore(s => s.biomeScope);
  const visibility = useUiStore(s => s.visibility);
  const onlyConflicts = useUiStore(s => s.onlyConflicts);
  const show = useCallback((actor: string) => {
    useUiStore.getState().focusItem(actor);
  }, []);
  const { index, world } = ctx;
  const locale = detectLocale([i18n.language]);

  const texts = useMemo(() => ({
    conflict: t('item.status.conflict'), showOnMap: t('list.showOnMap'), none: t('list.none'),
  }), [t]);
  const members = useMemo(() => new Map(world.members.map(m => [m.userId, m.displayName])), [world.members]);
  const someone = t('item.someone');

  const rows = useMemo(() => {
    if (!marks) return [];
    const out: Omit<RowProps, 'setMark' | 'show' | 'texts' | 'someone'>[] = [];
    for (const item of index.items) {
      if (!typeFilter.has(item.type) || (biomeScope !== null && item.biome !== biomeScope)) continue;
      const collected = isCollected(marks, item.name);
      const conflict = collected && hasMismatch(marks, item.name);
      if (onlyConflicts ? !conflict : visibility === 'hide' && collected && !conflict) continue;
      const mark = marks.pending.has(item.name) ? undefined : marks.marks.get(item.name);
      out.push({
        item, collected, conflict,
        label: itemLabel(item, t, index.ds.biomes, locale),
        typeLabel: t(typeById(item.type).labelKey),
        biome: index.ds.biomes[item.biome]?.name[locale] ?? '',
        by: mark ? (mark.updatedBy === null ? null : members.get(mark.updatedBy) ?? null) : undefined,
      });
    }
    return out;
  }, [marks, index, typeFilter, biomeScope, visibility, onlyConflicts, members, t, locale]);

  if (!marks) return null;
  return (
    <div className="h-full overflow-auto @container">
      <div className="p-2 @2xl:p-4">
        <table className="w-full border-collapse text-left text-sm @2xl:min-w-[720px]">
          <caption className="sr-only">{t('list.caption')}</caption>
          <thead className="sticky top-0 z-10 bg-raised font-display text-xs tracking-wider text-muted uppercase">
            <tr>
              {(['type', 'item', 'biome', 'status', 'changedBy'] as const).map(c => (
                <th key={c} scope="col" className={`px-2 py-2 font-semibold @2xl:px-3 ${c === 'type' || c === 'biome' || c === 'changedBy' ? 'hidden @2xl:table-cell' : ''}`}>{t(`list.${c}`)}</th>
              ))}
              <th scope="col" className="px-2 py-2 @2xl:px-3"><span className="sr-only">{t('list.showOnMap')}</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => <Row key={r.item.name} {...r} someone={someone} texts={texts} setMark={setMark} show={show} />)}
          </tbody>
        </table>
        {rows.length === 0 && <p className="p-4 text-muted">{t('list.empty')}</p>}
      </div>
    </div>
  );
}
