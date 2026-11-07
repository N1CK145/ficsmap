import { useTranslation } from 'react-i18next';
import type { WorldCtx } from '../../app/feature.js';
import { Button } from '../../components/Button.js';
import { Dialog } from '../../components/Dialog.js';
import { Planner } from './Planner.js';
import { usePlanner } from './usePlanner.js';

/** The header button that opens and closes the planner. */
export function PlannerButton(_props: { ctx: WorldCtx }) {
  const { t } = useTranslation();
  const visible = usePlanner(s => s.visible);
  const toggle = usePlanner(s => s.toggle);
  return (
    <Button variant={visible ? 'primary' : 'secondary'} size="sm" aria-pressed={visible} title={t('planner.hint')} onClick={toggle}>
      {t('planner.button')}
    </Button>
  );
}

/** The planner itself, in a wide dialog; for the world's dataset version. */
export function PlannerDialog({ ctx }: { ctx: WorldCtx }) {
  const { t } = useTranslation();
  const visible = usePlanner(s => s.visible);
  const close = usePlanner(s => s.close);
  return (
    <Dialog open={visible} onClose={close} title={t('planner.title')} wide>
      <Planner version={ctx.world.datasetVersion} />
    </Dialog>
  );
}
