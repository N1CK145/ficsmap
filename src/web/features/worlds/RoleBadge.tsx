import { useTranslation } from 'react-i18next';
import type { WorldRole } from '../../../shared/roles.js';
import { Badge } from '../../components/Badge.js';

/** The user's role in a world as a badge (Owner / Admin / Member); the roles with rights stand out. */
export function RoleBadge({ role }: { role: WorldRole }) {
  const { t } = useTranslation();
  return <Badge tone={role === 'member' ? 'neutral' : 'accent'}>{t(`worlds.role.${role}`)}</Badge>;
}
