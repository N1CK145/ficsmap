import { createContext, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { BANDS, type Band, type MachineHint, type MachineState, type Reason } from '../../../shared/factory/analysis.js';
import type { LineHint } from '../../../shared/factory/lines.js';
import { worldPath } from '../../app/pages.js';
import { badgeClass, type BadgeTone } from '../../components/Badge.js';
import { buttonClass } from '../../components/Button.js';
import type { FactoryLabels } from './data.js';
import type { FactoryFormat } from './format.js';
import { LocateIcon, ReasonIcon } from './icons.js';
import { useFactoryView } from './view.js';

/** Fill colour per productivity band (the % or the legend next to it always says the value too). */
export const BAND_FILL: Record<Band, string> = { idle: 'bg-conflict', throttled: 'bg-accent', high: 'bg-power', full: 'bg-free' };
export const BAND_TEXT: Record<Band, string> = { idle: 'text-conflict', throttled: 'text-accent', high: 'text-power', full: 'text-free' };
/** Fill and text colour per machine state: the bands, and paused in neutral grey. */
export const STATE_FILL: Record<MachineState, string> = { paused: 'bg-edge', ...BAND_FILL };
export const STATE_TEXT: Record<MachineState, string> = { paused: 'text-muted', ...BAND_TEXT };

/** A state's label: the band's ("Part load (1–90 %)") or "Paused". */
export function stateKey(state: MachineState): string {
  return state === 'paused' ? 'factory.state.paused' : `factory.band.${state}`;
}

/**
 * Badge tone per reason: missing power or fuel stand out; a shortage is what to fix first, a backed-up output next;
 * surplus, pauses and intermittent running are neutral.
 */
const REASON_TONE: Record<Reason, BadgeTone> = {
  paused: 'neutral', noPower: 'danger', noRecipe: 'danger', noFuel: 'danger', starved: 'danger', blocked: 'accent', surplus: 'neutral', unknown: 'neutral',
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

/**
 * "Engpass" as a chip led by a short hazard strip: the one mark for a line's bottleneck on the Fabrik page (line list,
 * diagram, group) and the factory map (panel list, line card). `label` replaces the word (a screen reader name stays).
 */
export function BottleneckChip({ className = '', label }: { className?: string; label?: string }) {
  const { t } = useTranslation();
  return (
    <span className={badgeClass('accent', `overflow-hidden pl-0 ${className}`)}>
      <span aria-hidden="true" className="w-2 self-stretch hazard" />
      {label ?? t('factory.lines.bottleneck.badge')}
    </span>
  );
}

/** Productivity as a thin bar with the percentage beside it; a paused machine says so in grey. */
export function ProductivityBar({ value, band, fmt, className = '', paused = false }: { value: number; band: Band; fmt: FactoryFormat; className?: string; paused?: boolean }) {
  const { t } = useTranslation();
  const state: MachineState = paused ? 'paused' : band;
  return (
    <span className={`flex items-center gap-2 ${className}`}>
      <span aria-hidden="true" className="relative h-1.5 w-16 shrink-0 overflow-hidden bg-line">
        <span className={`absolute inset-y-0 left-0 ${STATE_FILL[state]}`} style={{ width: `${Math.round(value * 100)}%` }} />
      </span>
      <span className={`font-display font-semibold tabular-nums ${STATE_TEXT[state]}`}>{paused ? t('factory.state.paused') : fmt.pct(value)}</span>
    </span>
  );
}

/** A loss as a bar relative to the largest one shown, with its value; `muted` (surplus, no real loss) in grey. */
export function LossBar({ share, label, muted = false }: { share: number; label: string; muted?: boolean }) {
  return (
    <span className="flex items-center justify-end gap-2">
      <span className={`font-display font-semibold tabular-nums ${muted ? 'text-muted' : 'text-conflict'}`}>{label}</span>
      <span aria-hidden="true" className="relative h-1.5 w-20 shrink-0 overflow-hidden bg-line max-sm:w-14">
        <span className={`absolute inset-y-0 right-0 ${muted ? 'bg-muted' : 'bg-conflict'}`} style={{ width: `${Math.max(2, Math.round(share * 100))}%` }} />
      </span>
    </span>
  );
}

/** Machines per band (and paused) as one stacked bar, with a text legend ("12 stopped · 30 part load · 60 full"). */
export function BandBar({ bands, paused = 0, className = '' }: { bands: Record<Band, number>; paused?: number; className?: string }) {
  const { t } = useTranslation();
  const counts: [MachineState, number][] = [...BANDS.map(b => [b, bands[b]] as [MachineState, number]), ['paused', paused]];
  const total = counts.reduce((s, [, n]) => s + n, 0);
  return (
    <div className={className}>
      <div aria-hidden="true" className="flex h-2 w-full overflow-hidden bg-line">
        {counts.map(([b, n]) => n > 0 && <span key={b} className={STATE_FILL[b]} style={{ width: `${(n / Math.max(1, total)) * 100}%` }} />)}
      </div>
      <p className="mt-1 flex flex-wrap gap-x-2 text-xs text-muted tabular-nums max-[899px]:text-sm">
        {counts.filter(([, n]) => n > 0).map(([b, n]) => (
          <span key={b} className="inline-flex items-center gap-1">
            <span aria-hidden="true" className={`inline-block size-2 ${STATE_FILL[b]}`} />
            {t(`factory.bandCount.${b}`, { count: n })}
          </span>
        ))}
      </p>
    </div>
  );
}

/** A hint's tone: a limit to fix in the accent, a guess or "just enough" muted (no warning), shards in their colour. */
export const HINT_TONE: Record<(MachineHint | LineHint)['kind'], string> = {
  beltLimits: 'text-accent', noBelt: 'text-accent', beltBehind: 'text-muted', overclockUseless: 'text-shard', sharedBeltFull: 'text-accent', beltExact: 'text-muted',
};

/** A hint about a machine's output, in words ("Conveyor Belt Mk.1 limits it to 60.0/min"); pipes in m³. */
export function hintText(h: MachineHint | LineHint, labels: FactoryLabels, fmt: FactoryFormat, t: (k: string, o?: Record<string, unknown>) => string): string {
  const belt = (cls: string, rate: number) => ({ belt: labels.building(cls, fmt.lang), rate: fmt.rate(rate, /Pipeline/.test(cls)) });
  switch (h.kind) {
    case 'beltLimits': return t('factory.machine.hint.beltLimits', belt(h.belt, h.rate));
    case 'beltBehind': return t('factory.machine.hint.beltBehind', belt(h.belt, h.rate));
    case 'noBelt': return t('factory.machine.hint.noBelt');
    case 'overclockUseless': return t('factory.machine.hint.overclockUseless', { shards: h.shards });
    case 'sharedBeltFull': return t('factory.machine.hint.sharedBeltFull', belt(h.belt, h.rate));
    case 'beltExact': return t('factory.machine.hint.beltExact', belt(h.belt, h.rate));
  }
}

// --- Tables that turn into stacked rows on a phone ----------------------------------------------------

/**
 * Table classes that turn into stacked rows on a phone (below 640 px): the header is only for screen readers, every
 * cell is a line with its column name in front (`Cell` with `label`). Because `display: block` drops the native table
 * semantics, the elements carry explicit roles (`role="table"` etc.).
 */
export const TABLE = 'w-full border-collapse text-sm max-sm:block';
export const THEAD = 'max-sm:sr-only';
export const TH = 'px-2 py-1.5 text-left font-display text-xs font-semibold tracking-wider text-muted uppercase whitespace-nowrap';
export const TR = 'border-t border-line max-sm:grid max-sm:grid-cols-2 max-sm:gap-x-4 max-sm:gap-y-1 max-sm:px-3 max-sm:py-2';
export const TD = 'px-2 py-1.5 align-middle tabular-nums max-sm:flex max-sm:min-w-0 max-sm:items-baseline max-sm:justify-between max-sm:gap-2 max-sm:p-0';
/** The first cell of a stacked row: the whole width on a phone. */
export const TD_FIRST = 'px-2 py-1 max-sm:col-span-2 max-sm:p-0';

/**
 * A table cell; on a phone its column name stands in front of it. The name is a visible element hidden from screen
 * readers (they get the column header through the table roles), so it is never read twice.
 */
export function Cell({ label, className = TD, children, colSpan }: { label?: string; className?: string; children?: ReactNode; colSpan?: number }) {
  return (
    <td role="cell" className={className} colSpan={colSpan}>
      {label !== undefined && <span aria-hidden="true" className="shrink-0 text-xs text-muted sm:hidden">{label}</span>}
      {label !== undefined ? <span className="min-w-0">{children}</span> : children}
    </td>
  );
}

/** The one character for "nothing" on the factory page. */
export const NONE = '–';

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
