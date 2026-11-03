import { useTranslation } from 'react-i18next';
import type { WorldCtx } from '../../app/feature.js';
import { ItemDetails, useSelectedItem } from '../itemPanel/ItemPanel.js';
import { NextStopButton, useNextStop } from '../routes/NextStopButton.js';

/**
 * The item panel on mobile (spec §10.11): the same details in a half-height sheet over the bottom
 * sheet. Its Check is the 56 px touch button (CheckAction); Esc and × close it. It covers the
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
      className="fixed inset-x-0 bottom-0 z-[1200] flex h-[50dvh] flex-col rounded-t border-t border-line bg-panel shadow-lg"
    >
      <ItemDetails item={item} ctx={ctx} />
      {nextStop && <div className="shrink-0 border-t border-line p-2"><NextStopButton worldId={ctx.worldId} /></div>}
    </aside>
  );
}
