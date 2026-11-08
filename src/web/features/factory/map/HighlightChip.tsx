import { useTranslation } from 'react-i18next';
import type { WorldCtx } from '../../../app/feature.js';
import { CloseIcon } from '../../../components/icons.js';
import { IconButton } from '../../../components/IconButton.js';
import { WINDOW_FRAME } from '../../../components/Window.js';
import { useFactoryView } from '../view.js';
import { useFactoryMap } from './useFactoryMap.js';

/**
 * Feedback for "On the map" (the Fabrik page, the panel's legend): a chip at the top of the map, "6 buildings marked",
 * with a 44 px button that clears the marking. Announced politely when it appears or its count changes.
 */
export function HighlightChip(_: { ctx: WorldCtx }) {
  const { t, i18n } = useTranslation();
  const visible = useFactoryMap(s => s.visible);
  const count = useFactoryView(s => s.highlight.length);
  const shown = visible && count > 0;
  return (
    <div aria-live="polite" className="pointer-events-none absolute top-3 left-1/2 z-[900] -translate-x-1/2 max-[899px]:top-2">
      {shown && (
        <div className={`${WINDOW_FRAME} pointer-events-auto flex items-center gap-1 border-l-2 border-l-fg py-0 pr-0 pl-3`} data-testid="factory-highlight-chip">
          <span className="text-sm font-semibold whitespace-nowrap tabular-nums">
            {t('factoryMap.highlight.count', { count, n: new Intl.NumberFormat(i18n.language).format(count) })}
          </span>
          <IconButton size="touch" aria-label={t('factoryMap.highlight.clear')} title={t('factoryMap.highlight.clear')} onClick={() => useFactoryView.getState().clearHighlight()}>
            <CloseIcon />
          </IconButton>
        </div>
      )}
    </div>
  );
}
