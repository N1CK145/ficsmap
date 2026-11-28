import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import type { WorldCtx } from '../../app/feature.js';
import { worldPath } from '../../app/pages.js';
import { useUiStore } from '../../app/store.js';

/** The query parameter of a link to one item: `/w/<world>?item=<actor>`. */
export const ITEM_PARAM = 'item';

/** The full link to an item of a world on this origin: it opens the map at the item with its panel open. */
export function itemLink(worldId: string, actor: string): string {
  const url = new URL(worldPath(worldId), window.location.origin);
  url.searchParams.set(ITEM_PARAM, actor);
  return url.href;
}

/**
 * Opens a link to an item (`?item=<actor>`, old actor names through the dataset's aliases): shows the map, zooms to
 * the item and selects it, so its panel opens (`focusItem`); an actor the dataset does not have gets a toast. The
 * parameter is then removed from the URL (replaced, no history entry), so a reload or Back does not jump there again.
 * A header item that renders nothing, so it works whatever the world shows (map or list).
 */
export function ItemLinkOpener({ ctx }: { ctx: WorldCtx }) {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const actor = params.get(ITEM_PARAM);
  const { index, toast } = ctx;

  useEffect(() => {
    if (actor === null) return;
    const name = index.resolve(actor);
    if (name !== undefined) useUiStore.getState().focusItem(name);
    else toast.show({ message: t('item.linkNotFound') });
    setParams(p => {
      p.delete(ITEM_PARAM);
      return p;
    }, { replace: true });
  }, [actor, index, toast, t, setParams]);
  return null;
}
