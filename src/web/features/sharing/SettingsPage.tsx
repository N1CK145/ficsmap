import { useId, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { collect, type WorldCtx } from '../../app/feature.js';
import { useFeatures } from '../../app/FeaturesContext.js';
import { SectionMarker } from '../../components/SectionHeading.js';
import { WindowTitleBar } from '../../components/Window.js';
import { hasRole } from '../../../shared/roles.js';

/** A titled block of the settings page, a window of its own; `danger` gives it the conflict colour and hazard stripes. */
export function SettingsBlock({ title, danger = false, children }: { title: string; danger?: boolean; children: ReactNode }) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className={`flex flex-col overflow-hidden chamfer-window border bg-panel ${danger ? 'border-conflict/60' : 'border-line'}`}>
      <WindowTitleBar title={title} titleId={titleId} level={3} tone={danger ? 'danger' : 'accent'} />
      {danger && <div aria-hidden="true" className="h-1 shrink-0 hazard-danger" />}
      <div className="flex flex-col gap-3 p-4">{children}</div>
    </section>
  );
}

/**
 * The settings view (spec §10.8): the features' `settingsSections` in order, each for its `minRole` and up.
 * Admins see everything but the danger zone; members just the member list and [Leave world].
 */
export function SettingsPage({ ctx }: { ctx: WorldCtx }) {
  const { t } = useTranslation();
  const features = useFeatures();
  const sections = useMemo(() => collect(features, 'settingsSections'), [features]);
  return (
    <div className="h-full overflow-y-auto">
      <main className="mx-auto flex w-full max-w-[720px] flex-col gap-4 p-4">
        <h2 className="flex items-center gap-2 font-display text-2xl font-bold tracking-wider uppercase"><SectionMarker size="lg" />{t('settings.title')}</h2>
        {sections.filter(s => hasRole(ctx.world.role, s.minRole)).map(s => <s.Component key={s.id} ctx={ctx} />)}
      </main>
    </div>
  );
}
