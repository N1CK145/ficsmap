import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { filledSlots, LITRES_PER_M3, summarize, usedSlots } from '../../../shared/factory/inventory.js';
import type { SnapshotInventory } from '../../../shared/factory/snapshot.js';
import { GameIcon } from '../machineWiki/icons.js';
import { SLOT_LABEL } from '../planner/machineParts.js';
import type { FactoryLabels } from './data.js';
import type { FactoryFormat } from './format.js';

/*
 * What lies in an inventory, as the game's container window shows it: a grid of slots (picture with the count on it,
 * free slots empty), how full it is ("23 of 48 slots") and a list per item. Shared by the storage popup, the station
 * and vehicle info and the machine window's slots.
 */

/** An amount as the game shows it on a slot: pieces as they are, fluids (litres in the save) in m³. */
export function slotAmount(item: string, count: number, labels: FactoryLabels, fmt: FactoryFormat): string {
  if (!labels.isFluid(item)) return fmt.int(count);
  const m3 = count / LITRES_PER_M3;
  return `${m3 < 10 && m3 % 1 !== 0 ? fmt.num1(m3) : fmt.int(Math.round(m3))} m³`;
}

/** The count on a slot's picture, at its lower right corner (as in the game). */
export function SlotCount({ children }: { children: string }) {
  return (
    <span aria-hidden="true" className="pointer-events-none absolute right-0.5 bottom-0 bg-bg/85 px-0.5 font-display text-xs leading-tight font-semibold text-fg tabular-nums">
      {children}
    </span>
  );
}

/**
 * The slots of an inventory as a grid of squares: each filled one with its item's picture and the count on it (its
 * name and count as tooltip and for screen readers), the free ones empty with a dashed edge (hidden from screen
 * readers: the fill line says how many there are). Filled slots come first (the snapshot keeps no gaps).
 */
export function SlotGrid({ inv, labels, fmt, label, px = 32 }: {
  inv: SnapshotInventory; labels: FactoryLabels; fmt: FactoryFormat; label: string; px?: number;
}) {
  const slots = filledSlots(inv);
  const free = Math.max(0, inv.slots - slots.length);
  const size = px + 12;
  return (
    <ul aria-label={label} data-testid="slot-grid" className="grid gap-1" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${size}px, 1fr))` }}>
      {slots.map((s, i) => {
        const name = labels.item(s.item, fmt.lang);
        const amount = slotAmount(s.item, s.count, labels, fmt);
        return (
          <li key={i} data-slot-item={s.item} title={`${name}: ${amount}`}
            className="relative flex aspect-square items-center justify-center chamfer border border-line bg-bg" style={{ minHeight: size }}>
            <GameIcon cls={s.item} px={px} placeholder />
            <SlotCount>{amount}</SlotCount>
            <span className="sr-only">{name}: {amount}</span>
          </li>
        );
      })}
      {Array.from({ length: free }, (_, i) => (
        <li key={`free-${i}`} aria-hidden="true" data-slot-free="" className="aspect-square chamfer border border-dashed border-line/70" style={{ minHeight: size }} />
      ))}
    </ul>
  );
}

/** How full it is: "23 of 48 slots" (a fluid buffer "400 of 400 m³") with a bar. */
export function FillLine({ used, total, text }: { used: number; total: number; text: string }) {
  const share = total > 0 ? Math.min(1, used / total) : 0;
  return (
    <div className="flex items-center gap-3" data-testid="inventory-fill">
      <span className="shrink-0 text-sm tabular-nums">{text}</span>
      <span aria-hidden="true" className="relative block h-1.5 min-w-0 flex-1 overflow-hidden bg-line">
        <span className={`absolute inset-y-0 left-0 ${share >= 1 ? 'bg-accent' : 'bg-free'}`} style={{ width: `${Math.round(share * 100)}%` }} />
      </span>
    </div>
  );
}

/** Per item what it holds: picture, name, the total and in how many slots. */
export function InventorySummary({ inv, labels, fmt }: { inv: SnapshotInventory; labels: FactoryLabels; fmt: FactoryFormat }) {
  const { t } = useTranslation();
  const lines = summarize(inv);
  return (
    <ul className="flex flex-col gap-0.5 text-sm" data-testid="inventory-summary">
      {lines.map(l => {
        const name = labels.item(l.item, fmt.lang);
        return (
          <li key={l.item} className="flex min-w-0 items-center gap-2">
            <GameIcon cls={l.item} px={20} placeholder />
            <span className="min-w-0 flex-1 truncate" title={name}>{name}</span>
            <span className="shrink-0 font-display font-semibold whitespace-nowrap tabular-nums">{slotAmount(l.item, l.total, labels, fmt)}</span>
            <span className="w-20 shrink-0 text-right text-xs whitespace-nowrap text-muted tabular-nums max-[899px]:text-sm">{t('factory.inventory.stacks', { count: l.stacks })}</span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * An inventory as a whole: the fill line, the slot grid and (when it holds anything) the list per item.
 * `capacityM3` makes it a fluid buffer: the fill is its fluid against that capacity.
 */
export function InventoryView({ inv, labels, fmt, capacityM3, summary = true, px, level = 4 }: {
  inv: SnapshotInventory; labels: FactoryLabels; fmt: FactoryFormat; capacityM3?: number; summary?: boolean;
  /** The pictures' size in the grid (32 px by default). */
  px?: number;
  /** The heading's level: under the window's title (h3 in the popups, so h4 by default; h3 under an h2). */
  level?: 3 | 4;
}) {
  const { t } = useTranslation();
  const id = useId();
  const used = usedSlots(inv);
  const Heading = level === 3 ? 'h3' : 'h4';
  let fill: { used: number; total: number; text: string };
  if (capacityM3 !== undefined) {
    // The game fills a buffer a little over its capacity; it shows it full (the slot too).
    const cap = capacityM3 * LITRES_PER_M3;
    inv = { ...inv, items: inv.items.map(([item, c, times]) => (times === undefined ? [item, Math.min(c, cap)] : [item, Math.min(c, cap), times])) };
    const m3 = Math.min(capacityM3, inv.items.reduce((n, [, c, times = 1]) => n + c * times, 0) / LITRES_PER_M3);
    fill = { used: m3, total: capacityM3, text: t('factory.inventory.fluidFill', { amount: fmt.int(Math.round(m3)), capacity: fmt.int(capacityM3) }) };
  } else {
    fill = { used, total: inv.slots, text: t('factory.inventory.fill', { used, slots: inv.slots }) };
  }
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2" data-testid="inventory">
      <Heading id={id} className={SLOT_LABEL.replace('mb-1 ', '')}>{t('factory.inventory.contents')}</Heading>
      <FillLine {...fill} />
      {inv.slots > 0 && <SlotGrid inv={inv} labels={labels} fmt={fmt} label={t('factory.inventory.slots')} px={px} />}
      {used === 0 && <p className="text-sm text-muted">{t('factory.inventory.empty')}</p>}
      {summary && used > 0 && (
        <div className="flex flex-col gap-1">
          <p className={SLOT_LABEL.replace('mb-1 ', '')}>{t('factory.inventory.byItem')}</p>
          <InventorySummary inv={inv} labels={labels} fmt={fmt} />
        </div>
      )}
    </section>
  );
}
