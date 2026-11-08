import type { FeatureModule } from '../../app/feature.js';
import { DangerZone } from './DangerZone.js';
import { ImportSection } from './ImportSection.js';
import { InviteSection } from './InviteSection.js';
import { MembersSection } from './MembersSection.js';
import { NameSection } from './NameSection.js';
import { SettingsLinks } from './SettingsLinks.js';

export { SettingsPage } from './SettingsPage.js';

/** The world settings page (spec §10.8): name, members, invite links, import and the danger zone. */
export const sharingFeature: FeatureModule = {
  id: 'sharing',
  headerItems: [{ id: 'settings-link', order: 40, Component: SettingsLinks }],
  settingsSections: [
    { id: 'name', order: 10, minRole: 'admin', Component: NameSection },
    { id: 'members', order: 20, minRole: 'member', Component: MembersSection },
    { id: 'invite', order: 30, minRole: 'admin', Component: InviteSection },
    { id: 'import', order: 40, minRole: 'admin', Component: ImportSection },
    { id: 'danger', order: 50, minRole: 'owner', Component: DangerZone },
  ],
};
