import { useId, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { collect, type WorldCtx } from '../../app/feature.js';
import { useFeatures } from '../../app/FeaturesContext.js';

/** A titled block of the settings page; `danger` outlines it in the conflict colour. */
export function SettingsBlock({ title, danger = false, children }: { title: string; danger?: boolean; children: ReactNode }) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={`flex flex-col gap-3 rounded border bg-panel p-4 ${danger ? 'border-conflict' : 'border-line'}`}>
      <h3 id={titleId} className="font-display text-lg font-semibold tracking-wider uppercase">{title}</h3>
      {children}
    </section>
  );
}

/**
 * The settings view (spec §10.8): the features' `settingsSections` in order, owner-only ones only for
 * the owner. Members see just what is left (the member list and [Leave world]).
 */
export function SettingsPage({ ctx }: { ctx: WorldCtx }) {
  const { t } = useTranslation();
  const features = useFeatures();
  const sections = useMemo(() => collect(features, 'settingsSections'), [features]);
  return (
    <div className="h-full overflow-y-auto">
      <main className="mx-auto flex w-full max-w-[720px] flex-col gap-4 p-4">
        <h2 className="font-display text-2xl font-bold">{t('settings.title')}</h2>
        {sections.filter(s => !s.ownerOnly || ctx.world.isOwner).map(s => <s.Component key={s.id} ctx={ctx} />)}
      </main>
    </div>
  );
}
