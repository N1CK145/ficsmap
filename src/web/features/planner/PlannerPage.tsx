import type { WorldCtx } from '../../app/feature.js';
import { Planner } from './Planner.js';

/** The planner page (`/w/:id/planner`) for the dataset the server serves (like the map and the other tools). */
export function PlannerPage({ ctx }: { ctx: WorldCtx }) {
  return <Planner version={ctx.me.datasetVersion} toast={ctx.toast} />;
}
