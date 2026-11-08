import { useTranslation } from 'react-i18next';
import type { WorldCtx } from '../../app/feature.js';
import { ItemDetails, useSelectedItem } from '../itemPanel/ItemPanel.js';
import { NextStopButton, useNextStop } from '../routes/NextStopButton.js';

/** The item sheet's share of the screen's height (its `h-[50dvh]`); `SelectionPan` keeps a selected marker above it. */
export const ITEM_SHEET_SHARE = 0.5;

/**
 * The item panel on mobile (spec §10.11): the same details in a half-height sheet over the bottom
 * sheet, marked `data-item-sheet` so the map can measure where it begins. Its Check is the 56 px touch button (CheckAction); Esc and × close it. It covers the
 * panels sheet's sticky [Next stop ›], so while the open route has an open stop it repeats that
 * button at its bottom: Check, then Next stop, without closing the sheet.
 */
export function ItemSheet({ ctx }: { ctx: WorldCtx }) {
  const { t } = useTranslation();
  const item = useSelectedItem(ctx);
  const nextStop = useNextStop(ctx.worldId);
  if (!item) return null;
  return (
    <aside
      aria-label={t('item.panel')}
      data-item-sheet=""
      className="fixed inset-x-0 bottom-0 z-[1200] flex h-[50dvh] flex-col bg-panel shadow-[0_-8px_24px_rgb(0_0_0/0.45)]"
    >
      <ItemDetails item={item} ctx={ctx} />
      {nextStop && <div className="shrink-0 border-t border-line bg-bg/50 p-2"><NextStopButton worldId={ctx.worldId} /></div>}
    </aside>
  );
}
