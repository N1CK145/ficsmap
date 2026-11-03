import { getI18n } from 'react-i18next';
import { typeById } from '../../../shared/collectibleTypes.js';
import type { Item } from '../../../shared/dataset.js';
import type { FeatureModule, WorldCtx } from '../../app/feature.js';
import { queryKeys } from '../../app/queryKeys.js';
import { useUiStore } from '../../app/store.js';
import { DOT_ZOOM } from '../map/markerStyle.js';
import { useUndoStack } from '../marks/undo.js';
import { createSetMark, hasMismatch, isCollected, type MarksCache } from '../marks/useMarks.js';
import { runUndo } from '../marks/useUndoShortcut.js';
import { QuickCheckBanner } from './QuickCheckBanner.js';
import { QuickCheckControl } from './QuickCheckControl.js';
import { quickClick } from './quickClick.js';

let cursor: string | null = null;

/**
 * A check-mark cursor in the theme colours. Cursor images cannot read CSS variables, so the token
 * values are put into the SVG once they are known.
 */
function checkCursor(): string {
  if (cursor) return cursor;
  const style = getComputedStyle(document.documentElement);
  const fill = style.getPropertyValue('--color-accent').trim();
  const outline = style.getPropertyValue('--color-bg').trim();
  if (!fill || !outline) return 'pointer';
  const path = (stroke: string, width: number) =>
    `<path d="M4 12.5l5 5L20 6.5" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">${path(outline, 6)}${path(fill, 3)}</svg>`;
  cursor = `url("data:image/svg+xml,${encodeURIComponent(svg)}") 9 17, pointer`;
  return cursor;
}

/**
 * A marker click in Quick Check (spec §10.3): flips the mark at once and toasts "<Type> checked ·
 * Undo" (unless a newer click on the same marker overtook it); a conflict opens the panel instead. MapView zooms in on dots before any mode sees a click.
 */
async function onQuickClick(item: Item, ctx: WorldCtx): Promise<void> {
  const marks = ctx.queryClient.getQueryData<MarksCache>(queryKeys.marks(ctx.worldId));
  const collected = marks ? isCollected(marks, item.name) : false;
  const action = quickClick({ zoom: DOT_ZOOM, collected, mismatch: marks ? hasMismatch(marks, item.name) : false });
  if (action.kind === 'openPanel') {
    useUiStore.getState().select(item.name);
    return;
  }
  if (action.kind !== 'toggle') return;
  const { t } = getI18n();
  const deps = { worldId: ctx.worldId, queryClient: ctx.queryClient, toast: ctx.toast, t };
  const setMark = createSetMark(deps);
  const entry = await setMark(item.name, action.collected);
  if (!entry) return;
  ctx.toast.show({
    message: t(action.collected ? 'quickCheck.checked' : 'quickCheck.unchecked', { type: t(typeById(item.type).labelKey) }),
    action: {
      label: t('marks.undo'),
      run: () => {
        if (useUndoStack.getState().remove(entry)) void runUndo(entry, { ...deps, setMark });
      },
    },
  });
}

/** Quick Check (spec §10.3): the `quick` map mode, its banner and cursor, and the map control. Q/Esc: useQuickCheckKeys (world layout). */
export const quickCheckFeature: FeatureModule = {
  id: 'quickCheck',
  mapModes: [{
    id: 'quick',
    onMarkerClick: (item, ctx) => void onQuickClick(item, ctx),
    get cursor() { return checkCursor(); },
    Banner: QuickCheckBanner,
  }],
  mapControls: [{ id: 'quick-check', order: 10, Component: QuickCheckControl }],
};
