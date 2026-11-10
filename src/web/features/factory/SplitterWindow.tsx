import type { ReactNode, Ref } from 'react';
import { useTranslation } from 'react-i18next';
import type { SplitterSide } from '../../../shared/factory/splitter.js';
import { Window } from '../../components/Window.js';
import { GameIcon } from '../machineWiki/icons.js';
import type { FactoryLabels } from './data.js';
import type { FactoryFormat } from './format.js';
import { isFilterItem } from './map/splitterView.js';

export interface SplitterWindowOutput {
  side: SplitterSide;
  /** Item classes of its rules (filters included); empty when no rule names this output. */
  items: string[];
  /** Name of the next building its belt reaches; undefined when nothing is connected. */
  target?: string;
}

export interface SplitterWindowProps {
  name: string;
  picture: string;
  /** Per output in the game's order; null when the snapshot was extracted before sort rules were read. */
  outputs: SplitterWindowOutput[] | null;
  labels: FactoryLabels;
  fmt: FactoryFormat;
  onClose(): void;
  titleRef?: Ref<HTMLHeadingElement>;
  top?: ReactNode;
}

/** The side's colour (the map draws its belt in the same one). */
const SIDE_BG: Record<SplitterSide, string> = { left: 'bg-out-left', center: 'bg-out-center', right: 'bg-out-right', top: 'bg-out-top' };

/**
 * A smart or programmable splitter as the game's window: per output (left, centre or top, right) the items its rules
 * send there and where its belt leads. Read-only.
 */
export function SplitterWindow({ name, picture, outputs, labels, fmt, onClose, titleRef, top }: SplitterWindowProps) {
  const { t } = useTranslation();
  return (
    <Window
      as="div"
      level={3}
      title={name}
      titleRef={titleRef}
      icon={<GameIcon cls={picture} px={40} placeholder />}
      onClose={onClose}
      closeLabel={t('factory.machineWindow.close', { name })}
      className="min-h-0"
      bodyClassName="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain p-3"
    >
      {top}
      {!outputs ? (
        <p className="text-sm text-muted" data-testid="splitter-unknown">{t('factory.splitter.unknown')}</p>
      ) : (
        <ul className="flex flex-col gap-2" data-testid="splitter-rules">
          {outputs.map(o => (
            <li key={o.side} className="flex flex-col gap-1.5 border border-line p-2" data-testid={`splitter-${o.side}`}>
              <div className="flex items-center gap-2 text-sm">
                <span aria-hidden="true" className={`h-3 w-3 shrink-0 rounded-full ${SIDE_BG[o.side]}`} />
                <span className="font-semibold">{t(`factory.splitter.side.${o.side}`)}</span>
                <span className="min-w-0 truncate text-muted">→ {o.target ?? t('factory.splitter.notConnected')}</span>
              </div>
              {o.items.length === 0 ? (
                <p className="text-sm text-muted">{t('factory.splitter.noRule')}</p>
              ) : (
                <ul className="flex flex-wrap gap-1.5">
                  {o.items.map((item, i) => (
                    <li key={`${item}-${i}`} className="flex items-center gap-1.5 bg-raised px-1.5 py-0.5 text-sm">
                      {isFilterItem(item)
                        ? <span>{t(`factory.splitter.filter.${item}`)}</span>
                        : <><GameIcon cls={item} px={20} placeholder /><span>{labels.item(item, fmt.lang)}</span></>}
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
    </Window>
  );
}
