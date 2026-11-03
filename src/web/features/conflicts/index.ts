import type { FeatureModule } from '../../app/feature.js';
import { queryKeys } from '../../app/queryKeys.js';
import type { MarksCache } from '../marks/useMarks.js';
import { conflictActors } from './conflictActors.js';
import { ConflictsHost, ConflictsPanel } from './ConflictsPanel.js';

export { conflictActors } from './conflictActors.js';
export { useBulkTrust } from './useBulkTrust.js';

/** Conflict resolution (spec §7, §10.7): sidebar panel with bulk trust, the review stepper, and the import banner's [Review conflicts]. */
export const conflictsFeature: FeatureModule = {
  id: 'conflicts',
  sidebarPanels: [{
    id: 'conflicts', order: 5, titleKey: 'conflicts.title', Component: ConflictsPanel,
    visible: ctx => {
      const marks = ctx.queryClient.getQueryData<MarksCache>(queryKeys.marks(ctx.worldId));
      return marks !== undefined && conflictActors(marks, ctx.index).length > 0;
    },
  }],
  headerItems: [{ id: 'conflicts-host', order: 100, Component: ConflictsHost }],
};
