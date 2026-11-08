import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { typeById } from '../../../shared/collectibleTypes.js';
import type { Item } from '../../../shared/dataset.js';
import { detectLocale } from '../../../shared/i18n.js';
import { collect, type WorldCtx } from '../../app/feature.js';
import { useFeatures } from '../../app/FeaturesContext.js';
import { shouldIgnoreGlobalKey } from '../../app/keyboard.js';
import { useUiStore } from '../../app/store.js';
import { Button } from '../../components/Button.js';
import { WINDOW_FRAME, WindowTitleBar } from '../../components/Window.js';
import { wholeMetres } from '../coords/metres.js';
import { TypeIcon } from '../map/TypeIcon.js';

/** The selected item, if it is on the map. */
export function useSelectedItem(ctx: WorldCtx): Item | undefined {
  const selected = useUiStore(s => s.selectedActor);
  return selected === null ? undefined : ctx.index.byName.get(selected);
}

/**
 * The selected item's details (spec §10.2): a 340 px panel floating over the right of the map
 * (on mobile the ItemSheet shows the same details). The features' `itemActions` (check, routes)
 * and `itemDetailSections` fill it. It does not take focus, so a map click keeps the keyboard where it was.
 */
export function ItemPanel({ ctx }: { ctx: WorldCtx }) {
  const { t } = useTranslation();
  const item = useSelectedItem(ctx);
  if (!item) return null;
  return (
    <aside
      aria-label={t('item.panel')}
      className={`ficsmap-item-panel absolute top-2 right-2 z-[1001] flex max-h-[calc(100%-1rem)] w-[340px] flex-col overflow-hidden ${WINDOW_FRAME}`}
    >
      <ItemDetails item={item} ctx={ctx} />
    </aside>
  );
}

/**
 * Header with ×, the actions and sections (scrolling), and the footer: pinned under them, or with `footerScrolls` (the
 * phone's half-height sheet) at the end of the scrolling part, so it does not take room from the sections. Esc closes
 * the details in the inspect mode (in other modes Esc leaves the mode first; an open dialog or menu takes Esc first),
 * and so does ×.
 */
export function ItemDetails({ item, ctx, footerScrolls = false }: { item: Item; ctx: WorldCtx; footerScrolls?: boolean }) {
  const { t, i18n } = useTranslation();
  const features = useFeatures();
  const { actions, sections } = useMemo(() => ({
    actions: collect(features, 'itemActions'),
    sections: collect(features, 'itemDetailSections'),
  }), [features]);
  const type = typeById(item.type);
  const biome = ctx.index.ds.biomes[item.biome]?.name;
  const close = () => useUiStore.getState().select(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || shouldIgnoreGlobalKey(e)) return;
      if (useUiStore.getState().interactionMode !== 'inspect') return;
      e.preventDefault();
      useUiStore.getState().select(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <>
      <header>
        <WindowTitleBar
          icon={<TypeIcon type={type} size={24} />}
          title={t(type.labelKey)}
          subtitle={biome ? `${biome[detectLocale([i18n.language])]}\u00a0${item.seq}` : item.seq}
          onClose={close}
        />
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="flex flex-col gap-2 border-b border-line p-3">
          {actions.map(a => <a.Component key={a.id} item={item} ctx={ctx} />)}
        </div>
        {sections.filter(s => s.applies(item)).map(s => <s.Component key={s.id} item={item} ctx={ctx} />)}
        {footerScrolls && <Footer item={item} ctx={ctx} />}
      </div>
      {!footerScrolls && <Footer item={item} ctx={ctx} />}
    </>
  );
}

/** X/Y/Z in whole metres and [Copy ID], which copies the actor name (its tooltip shows it). */
function Footer({ item, ctx }: { item: Item; ctx: WorldCtx }) {
  const { t, i18n } = useTranslation();
  const m = wholeMetres(i18n.language);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(item.name);
    } catch {
      return; // No clipboard access: the name stays selectable.
    }
    ctx.toast.show({ message: t('item.copied') });
  };
  return (
    <footer className="flex items-center justify-between gap-2 border-t border-line bg-bg/50 px-3 py-2 text-sm">
      <span className="font-display font-semibold tracking-wide tabular-nums">{t('item.coords', { x: m(item.x), y: m(item.y), z: m(item.z) })}</span>
      <Button variant="ghost" size="sm" title={item.name} onClick={() => void copy()}>{t('item.copyId')}</Button>
    </footer>
  );
}
