import { useTranslation } from 'react-i18next';
import type { WorldCtx } from '../../app/feature.js';
import { useIsMobile } from '../../app/useMediaQuery.js';
import { Button } from '../../components/Button.js';
import { useHeightLayer, useHeightSource } from './useHeights.js';

/** "Heights" under the zoom buttons: switches the height layer on and off. Hidden for a dataset without heights. */
export function HeightControl({ ctx }: { ctx: WorldCtx }) {
  const { t } = useTranslation();
  const mobile = useIsMobile();
  const visible = useHeightLayer(s => s.visible);
  const toggle = useHeightLayer(s => s.toggle);
  const source = useHeightSource(ctx.me.datasetVersion);
  if (!source) return null;
  return (
    <Button
      variant={visible ? 'primary' : 'secondary'}
      size={mobile ? 'touch' : 'sm'}
      aria-pressed={visible}
      title={t('heights.hint')}
      onClick={toggle}
    >
      {t('heights.control')}
    </Button>
  );
}
