import { useTranslation } from 'react-i18next';
import type { WorldCtx } from '../../app/feature.js';
import { Dialog } from '../../components/Dialog.js';
import { Planner } from './Planner.js';
import { usePlanner } from './usePlanner.js';

/** The planner itself, in a wide dialog, for the dataset the server serves (like the map and the other tools). */
export function PlannerDialog({ ctx }: { ctx: WorldCtx }) {
  const { t } = useTranslation();
  const visible = usePlanner(s => s.visible);
  const close = usePlanner(s => s.close);
  return (
    <Dialog open={visible} onClose={close} title={t('planner.title')} wide>
      <Planner version={ctx.me.datasetVersion} />
    </Dialog>
  );
}
