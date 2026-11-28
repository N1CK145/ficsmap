import type { FeatureModule } from '../../app/feature.js';
import { LiveDot } from './LiveDot.js';
import { PresenceAvatars } from './PresenceAvatars.js';
import { usePresence } from './presence.js';

/** The world event stream (mounted by the world layout), its header dot and who else is in the world. */
export const liveFeature: FeatureModule = {
  id: 'live',
  headerItems: [
    { id: 'live-dot', order: 10, Component: LiveDot },
    { id: 'presence', order: 11, Component: PresenceAvatars },
  ],
  sseHandlers: {
    presence: (e, ctx) => usePresence.getState().set(ctx.worldId, e.userIds),
  },
};
