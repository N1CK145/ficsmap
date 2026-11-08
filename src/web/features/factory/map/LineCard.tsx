import { useTranslation } from 'react-i18next';
import { bandOf } from '../../../../shared/factory/analysis.js';
import type { LineRate, ProductionLine } from '../../../../shared/factory/lines.js';
import { Button } from '../../../components/Button.js';
import { SectionHeading } from '../../../components/SectionHeading.js';
import { StatList, StatRow } from '../../../components/StatRow.js';
import { GameIcon } from '../../machineWiki/icons.js';
import type { FactoryLabels } from '../data.js';
import type { FactoryFormat } from '../format.js';
import { ReasonIcon } from '../icons.js';
import { ProductivityBar } from '../parts.js';
import { bottleneckText, lineName } from './lineView.js';

/** At most this many product pictures in a row of the list. */
const PICTURES = 3;

/** The pictures of a line's products, most first, then "+2" when it makes more. */
export function ProductPictures({ line, px = 20 }: { line: ProductionLine; px?: number }) {
  const shown = line.products.slice(0, PICTURES);
  return (
    <span aria-hidden="true" className="flex shrink-0 items-center gap-0.5">
      {shown.map(p => <GameIcon key={p.item} cls={p.item} px={px} placeholder />)}
      {line.products.length > PICTURES && <span className="text-xs text-muted tabular-nums">+{line.products.length - PICTURES}</span>}
    </span>
  );
}

/** The line's machines by class, most first: the class and the ids of its machines in the line. */
export function machineClasses(line: ProductionLine): { cls: string; ids: string[] }[] {
  const byCls = new Map<string, string[]>();
  for (const g of line.groups) if (!g.logistics) (byCls.get(g.cls) ?? byCls.set(g.cls, []).get(g.cls)!).push(...g.members);
  return [...byCls].map(([cls, ids]) => ({ cls, ids })).sort((a, b) => b.ids.length - a.ids.length || (a.cls < b.cls ? -1 : 1));
}

/** What the line's machines are, by class: "6 × Schmelzofen, 4 × Konstruktor", most first. */
export function machineMix(line: ProductionLine, labels: FactoryLabels, lang: FactoryFormat['lang']): string {
  return machineClasses(line).map(({ cls, ids }) => `${ids.length}\u00a0×\u00a0${labels.building(cls, lang)}`).join(', ');
}

/** A row button of the card's lists: at least 44 px high (a touch target). */
const ROW = 'flex min-h-11 w-full items-center gap-2 chamfer px-1 py-1 text-left text-sm focus-ring hover:bg-raised';

/** Whether the line's output is all fluid (its rates then read m³/min). */
const allFluid = (rates: readonly LineRate[]) => rates.length > 0 && rates.every(r => r.fluid);

/**
 * A production line's card in the info window: what it makes (pictures and rates), its machines, the mean
 * productivity, nominal against actual output, the bottleneck in words, what comes in from outside, and the ways on:
 * "Als Diagramm" (the Fabrik page's line diagram on this line) and "Zum Strang" (fit the map to it). Its machines are
 * a list of buttons, one per class, each outlining those machines of the line on the map (`onShowMachines`), the
 * keyboard's way to them. `compact` (the phone's peek): only the mean productivity, the bottleneck, "Als Diagramm"
 * and the way to the rest (`onExpand`).
 */
export function LineCard({ line, labels, fmt, onDiagram, onFit, onShowMachines, compact = false, onExpand }: {
  line: ProductionLine; labels: FactoryLabels; fmt: FactoryFormat; onDiagram: () => void; onFit: () => void;
  onShowMachines: (ids: readonly string[]) => void; compact?: boolean; onExpand?: () => void;
}) {
  const { t } = useTranslation();
  const neck = bottleneckText(line, labels, fmt.lang, t);
  const reason = line.bottleneck?.kind === 'group' && line.bottleneck.why !== 'demand' ? line.bottleneck.why : null;
  return (
    <div className="flex flex-col gap-3" data-testid="factory-line-card">
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="text-muted">{t('factoryMap.lines.productivity')}</span>
        <ProductivityBar value={line.productivity} band={bandOf(line.productivity)} fmt={fmt} />
      </div>
      {neck && (
        <p className="flex items-start gap-2 border-l-2 border-l-conflict bg-bg/50 px-2 py-1.5 text-sm" data-testid="factory-line-bottleneck">
          {reason ? <span className="mt-0.5 text-conflict"><ReasonIcon reason={reason} /></span> : <span aria-hidden="true" className="font-display font-bold text-conflict">!</span>}
          <span><span className="font-semibold">{t('factoryMap.lines.bottleneck')}</span> {neck}</span>
        </p>
      )}
      {compact ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="primary" onClick={onDiagram}>{t('factoryMap.lines.asDiagram')}</Button>
          {onExpand && <Button size="sm" onClick={onExpand} data-testid="factory-line-more">{t('factoryMap.lines.more')}</Button>}
        </div>
      ) : <LineDetails line={line} labels={labels} fmt={fmt} onDiagram={onDiagram} onFit={onFit} onShowMachines={onShowMachines} />}
    </div>
  );
}

function LineDetails({ line, labels, fmt, onDiagram, onFit, onShowMachines }: {
  line: ProductionLine; labels: FactoryLabels; fmt: FactoryFormat; onDiagram: () => void; onFit: () => void;
  onShowMachines: (ids: readonly string[]) => void;
}) {
  const { t } = useTranslation();
  const fluid = allFluid(line.products);
  const lost = line.nominal - line.actual;
  return (
    <>
      <StatList>
        <StatRow
          label={t('factoryMap.lines.output')}
          value={t('factoryMap.info.actualOfTarget', { actual: fmt.rate(line.actual, fluid), at: fmt.rate(line.nominal, fluid) })}
          hint={lost > 0.05 ? <span className="text-conflict">{t('factoryMap.info.lost', { rate: fmt.rate(lost, fluid) })}</span> : undefined}
          tone={lost > 0.05 ? 'danger' : 'default'}
        />
        <StatRow label={t('factoryMap.lines.machines')} value={fmt.int(line.machines.length)} />
      </StatList>
      {/* The machines by class, each a way to see them on the map (the keyboard's way to a part of the line). */}
      <ul aria-label={t('factoryMap.lines.machines')} className="-mt-2 flex flex-col" data-testid="factory-line-machines">
        {machineClasses(line).map(({ cls, ids }) => (
          <li key={cls}>
            <button type="button" className={ROW} onClick={() => onShowMachines(ids)} title={t('factoryMap.showOnMapHint')}>
              <span className="w-8 shrink-0 text-right font-display font-semibold tabular-nums">{fmt.int(ids.length)}&nbsp;×</span>
              <span className="min-w-0 flex-1 truncate">{labels.building(cls, fmt.lang)}</span>
              <span className="shrink-0 text-xs text-muted max-[899px]:text-sm">{t('factoryMap.lines.onMap')}</span>
            </button>
          </li>
        ))}
      </ul>
      {line.products.length > 0 && (
        <div>
          <SectionHeading as="h3">{t('factoryMap.lines.products')}</SectionHeading>
          <RateList rates={line.products} labels={labels} fmt={fmt} />
        </div>
      )}
      {line.inputs.length > 0 && (
        <div>
          <SectionHeading as="h3">{t('factoryMap.lines.inputs')}</SectionHeading>
          <RateList rates={line.inputs} labels={labels} fmt={fmt} />
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="primary" onClick={onDiagram}>{t('factoryMap.lines.asDiagram')}</Button>
        <Button size="sm" onClick={onFit}>{t('factoryMap.lines.fit')}</Button>
      </div>
    </>
  );
}

function RateList({ rates, labels, fmt }: { rates: readonly LineRate[]; labels: FactoryLabels; fmt: FactoryFormat }) {
  return (
    <StatList>
      {rates.map(r => (
        <StatRow
          key={r.item}
          icon={<GameIcon cls={r.item} px={20} placeholder />}
          label={labels.item(r.item, fmt.lang)}
          value={fmt.rate(r.perMin, r.fluid ?? labels.isFluid(r.item))}
        />
      ))}
    </StatList>
  );
}

/** What a screen reader hears when a line is chosen: its name, machines, mean productivity and bottleneck. */
export function lineAnnouncement(line: ProductionLine, labels: FactoryLabels, fmt: FactoryFormat, t: (k: string, o?: Record<string, unknown>) => string): string {
  const neck = bottleneckText(line, labels, fmt.lang, t);
  const base = t('factoryMap.lines.announce', { name: lineName(line, labels, fmt.lang), count: line.machines.length, pct: fmt.pct(line.productivity) });
  return neck ? `${base} ${t('factoryMap.lines.bottleneck')} ${neck}` : base;
}
