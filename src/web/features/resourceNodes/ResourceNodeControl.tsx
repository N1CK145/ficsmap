import { useTranslation } from 'react-i18next';
import type { WorldCtx } from '../../app/feature.js';
import { useIsMobile } from '../../app/useMediaQuery.js';
import { Button } from '../../components/Button.js';
import { useNodeLayer, useResourceNodeFile } from './useResourceNodes.js';

/** "Resources": switches the resource node layer on and off. Hidden for a dataset built without resource nodes. */
export function ResourceNodeControl({ ctx }: { ctx: WorldCtx }) {
  const { t } = useTranslation();
  const mobile = useIsMobile();
  const visible = useNodeLayer(s => s.visible);
  const toggle = useNodeLayer(s => s.toggle);
  const file = useResourceNodeFile(ctx.me.datasetVersion);
  if (!file) return null;
  return (
    <Button
      variant={visible ? 'primary' : 'secondary'}
      size={mobile ? 'touch' : 'sm'}
      aria-pressed={visible}
      title={t('resourceNodes.hint')}
      onClick={toggle}
    >
      {t('resourceNodes.control')}
    </Button>
  );
}
