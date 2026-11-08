import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { buttonClass } from '../../components/Button.js';

/** Where a member lands when the owner removes them while they look at the world (spec §10.9). */
export function RemovedPage() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-dvh flex-col">
      <main className="flex flex-1 flex-col items-center justify-center gap-4 p-4 text-center">
        <h1 className="font-display text-3xl font-bold">{t('world.removed')}</h1>
        <Link to="/?list=1" className={buttonClass({ variant: 'primary' })}>{t('world.goToWorlds')}</Link>
      </main>
    </div>
  );
}
