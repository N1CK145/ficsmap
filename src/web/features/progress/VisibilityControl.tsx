import { useTranslation } from 'react-i18next';
import { useUiStore, type CollectedVisibility } from '../../app/store.js';
import { SegmentedControl } from '../../components/SegmentedControl.js';

const OPTIONS: readonly CollectedVisibility[] = ['show', 'dim', 'hide'];

/** "Collected [Show | Dim | Hide]" (spec §10). Conflicts ignore Hide (markerStyle.ts). */
export function VisibilityControl() {
  const { t } = useTranslation();
  const visibility = useUiStore(s => s.visibility);
  const setVisibility = useUiStore(s => s.setVisibility);
  const label = t('progress.visibility');
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-sm text-muted">{label}</span>
      <SegmentedControl
        label={label}
        options={OPTIONS.map(v => ({ value: v, label: t(`progress.${v}`) }))}
        value={visibility}
        onChange={setVisibility}
      />
    </div>
  );
}
