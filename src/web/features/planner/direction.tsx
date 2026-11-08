import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { loadDiagramDirection, saveDiagramDirection, type DiagramKind } from '../../app/persist.js';
import { useMediaQuery } from '../../app/useMediaQuery.js';
import { SegmentedControl } from '../../components/SegmentedControl.js';
import type { DiagramDirection } from './diagramLayout.js';

/** Narrower than this (a phone upright) a diagram always runs top to bottom and the switch is left out: no room for it. */
const NARROW_QUERY = '(max-width: 479px)';

/**
 * Which way a flow diagram runs, remembered on the device for each kind of diagram; top to bottom on a narrow screen
 * (where `DirectionSwitch` shows nothing).
 */
export function useDiagramDirection(kind: DiagramKind): [DiagramDirection, (d: DiagramDirection) => void] {
  const [direction, setDirection] = useState<DiagramDirection>(() => loadDiagramDirection(kind));
  const narrow = useMediaQuery(NARROW_QUERY);
  const choose = (d: DiagramDirection) => {
    setDirection(d);
    saveDiagramDirection(kind, d);
  };
  return [narrow ? 'down' : direction, choose];
}

/**
 * "↓ Top to bottom | → Left to right" for a diagram's title bar; below 640 px only the arrows show (the words stay the
 * names), below 480 px nothing.
 */
export function DirectionSwitch({ value, onChange }: { value: DiagramDirection; onChange(d: DiagramDirection): void }) {
  const { t } = useTranslation();
  const narrow = useMediaQuery(NARROW_QUERY);
  if (narrow) return null;
  const option = (arrow: string, text: string) => (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className="font-display text-base leading-none">{arrow}</span>
      <span className="max-sm:sr-only">{text}</span>
    </span>
  );
  return (
    <SegmentedControl<DiagramDirection>
      label={t('planner.diagram.direction.label')}
      options={[
        { value: 'down', label: option('↓', t('planner.diagram.direction.down')) },
        { value: 'right', label: option('→', t('planner.diagram.direction.right')) },
      ]}
      value={value}
      onChange={onChange}
    />
  );
}
