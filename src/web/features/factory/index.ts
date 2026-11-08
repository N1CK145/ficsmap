import type { FeatureModule } from '../../app/feature.js';
import { queryKeys } from '../../app/queryKeys.js';

export { deleteSnapshot, factoryOf, fetchSnapshot, uploadSnapshot, useSnapshot, useSnapshotList } from './api.js';

/**
 * The factory map: snapshots of the factory per save (stored on the server) for the 2D map and its timeline. For now
 * the data layer and live updates of the snapshot list; the map layers and the timeline build on `api.ts`.
 */
export const factoryFeature: FeatureModule = {
  id: 'factory',
  sseHandlers: {
    snapshots: (_e, ctx) => { void ctx.queryClient.invalidateQueries({ queryKey: queryKeys.snapshots(ctx.worldId) }); },
  },
};
