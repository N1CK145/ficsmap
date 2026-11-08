import { createContext, useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import type { AnalysisData, MachineFlow, MachineHint } from '../../../shared/factory/analysis.js';
import type { LineHint } from '../../../shared/factory/lines.js';
import type { FactorySnapshot, SnapshotBuilding } from '../../../shared/factory/snapshot.js';
import { useIsMobile } from '../../app/useMediaQuery.js';
import type { FactoryLabels } from './data.js';
import type { FactoryFormat } from './format.js';
import { MachinePopup, type Box } from './MachinePopup.js';
import { MachineWindow } from './MachineWindow.js';

/** The machine whose window is open on the Fabrik page, and the row button that opened it. */
export interface OpenMachine {
  m: MachineFlow;
  hints: readonly (MachineHint | LineHint)[];
  opener: HTMLElement;
  /** Opened from the keyboard: the focus moves into the window. */
  keyboard: boolean;
}

/** One popup on the page at a time; a store, so a click outside can tell whether it opened another machine. */
export const usePageMachine = create<{ open: OpenMachine | null }>()(() => ({ open: null }));

/**
 * Opens a machine's window from a list row (`MachineLine`); null where the page has no popup host, then the rows stay
 * plain text.
 */
export const OpenMachineContext = createContext<((open: OpenMachine) => void) | null>(null);

const openMachine = (open: OpenMachine) => usePageMachine.setState({ open });
const close = () => usePageMachine.setState({ open: null });

/**
 * The Fabrik page's machine window: a list row (the line diagram's machines, the inefficient items' machines) opens
 * `MachineWindow` as a popup under the row (above when there is no room), kept inside the window and moving with the
 * row when the page scrolls; on phones a sheet at the bottom. It closes on a click outside, Esc or ×, moves to another
 * machine when another row is clicked, and closes when the shown save changes (its figures would be the old save's).
 * Opened from the keyboard the focus moves into it and goes back to the row on close.
 */
export function PageMachinePopup({ data, labels, fmt, snapshot, children }: {
  data: AnalysisData | null; labels: FactoryLabels; fmt: FactoryFormat;
  /** The shown save (what lies in the machines' slots); another one closes the popup. */
  snapshot: FactorySnapshot;
  children: ReactNode;
}) {
  const open = usePageMachine(s => s.open);
  useEffect(() => close, [snapshot]);
  const byId = useMemo(() => new Map(snapshot.buildings.map(b => [b.id, b])), [snapshot]);
  const building = open ? byId.get(open.m.id) : undefined;
  return (
    <OpenMachineContext.Provider value={data ? openMachine : null}>
      {children}
      {open && data && createPortal(
        <Popup open={open} data={data} labels={labels} fmt={fmt} building={building} inventories={snapshot.meta.inventories === true} />, document.body,
      )}
    </OpenMachineContext.Provider>
  );
}

const subscribe = (update: () => void) => {
  window.addEventListener('scroll', update, true);
  window.addEventListener('resize', update);
  return () => {
    window.removeEventListener('scroll', update, true);
    window.removeEventListener('resize', update);
  };
};

function Popup({ open, data, labels, fmt, building, inventories }: {
  open: OpenMachine; data: AnalysisData; labels: FactoryLabels; fmt: FactoryFormat; building?: SnapshotBuilding; inventories: boolean;
}) {
  const mobile = useIsMobile();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const { m, opener, keyboard } = open;
  useEffect(() => {
    if (keyboard) titleRef.current?.focus();
  }, [open, keyboard]);
  const anchor = useCallback((): Box | null => {
    if (!opener.isConnected) return null;
    const r = opener.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  }, [opener]);
  return (
    <MachinePopup
      label={labels.building(m.cls, fmt.lang)}
      anchor={anchor}
      area={() => ({ left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight })}
      subscribe={subscribe}
      prefer="below"
      sheet={mobile}
      sheetClassName="inset-x-2 bottom-2 max-h-[min(80dvh,calc(100dvh-1rem))]"
      openKey={() => usePageMachine.getState().open}
      onClose={close}
      escape="document"
      returnFocus={() => opener}
      strategy="fixed"
      className={mobile ? 'z-[1250]' : 'z-[1250] w-[min(440px,calc(100vw-16px))]'}
    >
      <MachineWindow m={m} data={data} labels={labels} fmt={fmt} hints={open.hints} onClose={close} titleRef={titleRef} building={building} inventories={inventories} />
    </MachinePopup>
  );
}
