import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { bandOf } from '../../../../shared/factory/analysis.js';
import type { ProductionLine } from '../../../../shared/factory/lines.js';
import { Button } from '../../../components/Button.js';
import { Fold } from '../../../components/Fold.js';
import { IconsContext, useItemIcons } from '../../machineWiki/icons.js';
import { useImportDialog } from '../../import/ImportDialog.js';
import type { FactoryLabels } from '../data.js';
import { useFactoryFormat, type FactoryFormat } from '../format.js';
import { BottleneckChip, STATE_FILL, STATE_TEXT } from '../parts.js';
import { useFactoryView } from '../view.js';
import { ProductPictures } from './LineCard.js';
import { lineHasIssue, lineName, sortLines } from './lineView.js';
import type { MapData } from './mapData.js';
import { useFactoryMap } from './useFactoryMap.js';

/** Rows shown before "Show all". */
export const LINES_SHOWN = 10;

/**
 * "Produktionsstränge" in the Fabrikplan panel: the shown save's production lines, those with a problem first, then
 * the bigger ones; each row the products' pictures, the name, machines and the mean productivity as a bar. Pointing at
 * or focusing a row lights the line up on the map; a click (Enter) chooses it, opens its card and fits the map to it.
 * The keyboard way to the lines. Without `links` in the snapshot (imported before connections were read) it says so,
 * with the import button for the owner.
 */
export function LinesSection({ data, owner, version }: { data: MapData; owner: boolean; version: string }) {
  const { t } = useTranslation();
  const fmt = useFactoryFormat();
  const icons = useItemIcons(version);
  const lines = data.lines;
  const sorted = useMemo(() => (lines ? sortLines(lines.lines) : []), [lines]);
  const issues = useMemo(() => sorted.filter(lineHasIssue).length, [sorted]);
  const snapshot = data.snapshot;

  let summary: string | undefined;
  if (snapshot && !data.hasLinks) summary = t('factoryMap.lines.missingShort');
  else if (lines) summary = t('factoryMap.lines.summary', { count: sorted.length, issues });

  return (
    <IconsContext.Provider value={icons}>
      <Fold title={t('factoryMap.lines.title')} summary={summary} defaultOpen className="border-t border-line">
        <div className="flex flex-col gap-2 pb-2" data-testid="factory-lines">
          {snapshot && !data.hasLinks ? <MissingLinks owner={owner} />
            : lines === undefined || !data.labels ? <p className="text-sm text-muted">{t('common.loading')}</p>
            : sorted.length === 0 ? <p className="text-sm text-muted">{t('factoryMap.lines.none')}</p>
            : <LineList lines={sorted} labels={data.labels} fmt={fmt} />}
        </div>
      </Fold>
    </IconsContext.Provider>
  );
}

/** The empty state of a snapshot without connections: import the save again. */
export function MissingLinks({ owner }: { owner: boolean }) {
  const { t } = useTranslation();
  const show = useImportDialog(s => s.show);
  return (
    <div role="note" className="flex flex-col gap-2 text-sm" data-testid="factory-lines-missing">
      <p>{t('factoryMap.lines.missing')}</p>
      <p className="text-muted">{t(owner ? 'factoryMap.lines.missingOwner' : 'factoryMap.lines.missingMember')}</p>
      {owner && <Button size="sm" variant="primary" className="self-start" onClick={() => show('save')}>{t('factoryMap.empty.import')}</Button>}
    </div>
  );
}

function LineList({ lines, labels, fmt }: { lines: readonly ProductionLine[]; labels: FactoryLabels; fmt: FactoryFormat }) {
  const { t } = useTranslation();
  const [all, setAll] = useState(false);
  const chosen = useFactoryView(s => s.lineId);
  const hovered = useFactoryMap(s => s.hoverLineId);
  // The chosen line is always in the list, also when it is further down.
  const shown = all ? lines : lines.filter((l, i) => i < LINES_SHOWN || l.id === chosen);
  const { hoverLine, openLine } = useFactoryMap.getState();
  return (
    <>
      <ul aria-label={t('factoryMap.lines.title')} className="flex flex-col">
        {shown.map(l => {
          const name = lineName(l, labels, fmt.lang);
          const issue = lineHasIssue(l);
          const band = bandOf(l.productivity);
          const isChosen = l.id === chosen;
          return (
            <li key={l.id}>
              <button
                type="button"
                aria-current={isChosen ? 'true' : undefined}
                onMouseEnter={() => hoverLine(l.id)}
                onMouseLeave={() => hoverLine(null)}
                onFocus={() => hoverLine(l.id)}
                onBlur={() => hoverLine(null)}
                onClick={e => openLine(l.id, { focus: true, opener: e.currentTarget, reveal: true })}
                className={`flex min-h-11 w-full items-center gap-2 chamfer border-l-2 px-2 py-1 text-left text-sm select-none focus-ring hover:bg-raised ${isChosen ? 'border-l-accent bg-raised' : hovered === l.id ? 'border-l-fg bg-raised' : 'border-l-transparent'}`}
              >
                <ProductPictures line={l} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">{name}</span>
                  <span className="flex items-center gap-1 text-xs text-muted max-[899px]:text-sm">
                    {issue && <><BottleneckChip /><span className="sr-only">: </span></>}
                    {t('factoryMap.lines.machinesCount', { count: l.machines.length })}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <span aria-hidden="true" className="relative h-1.5 w-10 overflow-hidden bg-line">
                    <span className={`absolute inset-y-0 left-0 ${STATE_FILL[band]}`} style={{ width: `${Math.round(l.productivity * 100)}%` }} />
                  </span>
                  <span className={`w-9 text-right font-display font-semibold tabular-nums ${STATE_TEXT[band]}`}>{fmt.pct(l.productivity)}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {!all && lines.length > shown.length && (
        <Button size="sm" variant="ghost" className="self-start" onClick={() => setAll(true)}>
          {t('factoryMap.lines.showAll', { count: lines.length })}
        </Button>
      )}
    </>
  );
}
