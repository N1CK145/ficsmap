import { useTranslation } from 'react-i18next';
import type { WorldCtx } from '../../app/feature.js';
import { useIsMobile } from '../../app/useMediaQuery.js';
import { Button } from '../../components/Button.js';
import { hasCaves, useCaveLayer } from './useCaves.js';

/** "Caves" under the zoom buttons: switches the cave layer on and off. Hidden for a dataset built without caves. */
export function CaveControl({ ctx }: { ctx: WorldCtx }) {
  const { t } = useTranslation();
  const mobile = useIsMobile();
  const visible = useCaveLayer(s => s.visible);
  const toggle = useCaveLayer(s => s.toggle);
  if (!hasCaves(ctx.index)) return null;
  return (
    <Button
      variant={visible ? 'primary' : 'secondary'}
      size={mobile ? 'touch' : 'sm'}
      aria-pressed={visible}
      title={t('caves.hint')}
      onClick={toggle}
    >
      {t('caves.control')}
    </Button>
  );
}
