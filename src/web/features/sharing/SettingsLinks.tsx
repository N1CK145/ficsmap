import { useTranslation } from 'react-i18next';
import { Link, useMatch } from 'react-router';
import type { WorldCtx } from '../../app/feature.js';
import { buttonClass } from '../../components/Button.js';

/** Header: [⚙] opens the settings view of the world, [← Map] goes back from it. */
export function SettingsLinks({ ctx }: { ctx: WorldCtx }) {
  const { t } = useTranslation();
  const inSettings = useMatch('/w/:id/settings') !== null;
  const base = `/w/${encodeURIComponent(ctx.worldId)}`;
  return inSettings
    ? <Link to={base} className={buttonClass({ size: 'sm' })}>{t('settings.backToMap')}</Link>
    : <Link to={`${base}/settings`} aria-label={t('settings.open')} title={t('settings.open')} className={buttonClass({ size: 'sm', shape: 'square' })}><span aria-hidden="true">⚙</span></Link>;
}
