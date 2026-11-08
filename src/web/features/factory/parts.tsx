import { createContext } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { BANDS, type Band, type Reason } from '../../../shared/factory/analysis.js';
import { worldPath } from '../../app/pages.js';
import { badgeClass, type BadgeTone } from '../../components/Badge.js';
import { buttonClass } from '../../components/Button.js';
import type { FactoryFormat } from './format.js';
import { LocateIcon, ReasonIcon } from './icons.js';
import { useFactoryView } from './view.js';

/** Fill colour per productivity band (the % or the legend next to it always says the value too). */
export const BAND_FILL: Record<Band, string> = { idle: 'bg-conflict', throttled: 'bg-accent', high: 'bg-power', full: 'bg-free' };
export const BAND_TEXT: Record<Band, string> = { idle: 'text-conflict', throttled: 'text-accent', high: 'text-power', full: 'text-free' };

/** Badge tone per reason: missing power or fuel and pauses stand out from the everyday belt problems. */
const REASON_TONE: Record<Reason, BadgeTone> = {
  paused: 'neutral', noPower: 'danger', noRecipe: 'danger', noFuel: 'danger', starved: 'accent', blocked: 'accent', unknown: 'neutral',
};

/** A reason as icon and text ("⏸ Paused"); its hint as tooltip. */
export function ReasonBadge({ reason, count }: { reason: Reason; count?: number }) {
  const { t } = useTranslation();
  return (
    <span className={badgeClass(REASON_TONE[reason])} title={t(`factory.reasonHint.${reason}`)}>
      <ReasonIcon reason={reason} size={12} />
      {t(`factory.reason.${reason}`)}
      {count !== undefined && <span className="tabular-nums">{count}</span>}
    </span>
  );
}

/** Productivity as a thin bar with the percentage beside it. */
export function ProductivityBar({ value, band, fmt, className = '' }: { value: number; band: Band; fmt: FactoryFormat; className?: string }) {
  return (
    <span className={`flex items-center gap-2 ${className}`}>
      <span aria-hidden="true" className="relative h-1.5 w-16 shrink-0 overflow-hidden bg-line">
        <span className={`absolute inset-y-0 left-0 ${BAND_FILL[band]}`} style={{ width: `${Math.round(value * 100)}%` }} />
      </span>
      <span className={`font-display font-semibold tabular-nums ${BAND_TEXT[band]}`}>{fmt.pct(value)}</span>
    </span>
  );
}

/** A loss as a bar relative to the largest one shown, with its value. */
export function LossBar({ share, label }: { share: number; label: string }) {
  return (
    <span className="flex items-center justify-end gap-2">
      <span className="font-display font-semibold text-conflict tabular-nums">{label}</span>
      <span aria-hidden="true" className="relative h-1.5 w-20 shrink-0 overflow-hidden bg-line max-sm:w-14">
        <span className="absolute inset-y-0 right-0 bg-conflict" style={{ width: `${Math.max(2, Math.round(share * 100))}%` }} />
      </span>
    </span>
  );
}

/** Machines per band as one stacked bar, with a text legend ("12 standing · 30 throttled · 60 full"). */
export function BandBar({ bands, className = '' }: { bands: Record<Band, number>; className?: string }) {
  const { t } = useTranslation();
  const total = BANDS.reduce((s, b) => s + bands[b], 0);
  return (
    <div className={className}>
      <div aria-hidden="true" className="flex h-2 w-full overflow-hidden bg-line">
        {BANDS.map(b => bands[b] > 0 && <span key={b} className={BAND_FILL[b]} style={{ width: `${(bands[b] / Math.max(1, total)) * 100}%` }} />)}
      </div>
      <p className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted tabular-nums max-[899px]:text-sm">
        {BANDS.filter(b => bands[b] > 0).map(b => (
          <span key={b} className="inline-flex items-center gap-1">
            <span aria-hidden="true" className={`inline-block size-2 ${BAND_FILL[b]}`} />
            {t(`factory.bandCount.${b}`, { count: bands[b] })}
          </span>
        ))}
      </p>
    </div>
  );
}

/**
 * "Show on map": highlights the buildings (ids of the selected snapshot) in the shared view and goes to the map, which
 * shows and fits them. `label` names what is shown, for screen readers ("Show Iron Plate on the map").
 */
export function ShowOnMap({ worldId, ids, label, compact = false }: { worldId: string; ids: readonly string[]; label: string; compact?: boolean }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const showOnMap = useFactoryView(s => s.showOnMap);
  return (
    <button
      type="button"
      disabled={ids.length === 0}
      aria-label={t('factory.showOnMapNamed', { name: label })}
      title={t('factory.showOnMapNamed', { name: label })}
      onClick={() => {
        showOnMap(ids);
        void navigate(worldPath(worldId));
      }}
      className={buttonClass({ variant: 'link-accent', size: 'sm', shape: compact ? 'square' : 'default' })}
    >
      <LocateIcon />
      {!compact && <span className="max-sm:sr-only">{t('factory.showOnMap')}</span>}
    </button>
  );
}

/** Where a point is, in words (the biome nearby), for telling machines of one kind apart; empty without data. */
export const LocateContext = createContext<(x: number, y: number) => string | undefined>(() => undefined);
