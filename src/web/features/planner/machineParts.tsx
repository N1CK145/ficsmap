import { useContext, useId, type CSSProperties, type ReactNode } from 'react';
import { SectionHeading } from '../../components/SectionHeading.js';
import { GameIcon, IconsContext } from '../machineWiki/icons.js';
import { Picture, SHARD_CLASS } from './pictures.js';

/*
 * The building blocks of the game's machine window, shared by the planner's step panel (`StepPanel`) and the factory's
 * machine window (`factory/MachineWindow`): titled sections, item slots, the production cycle between inputs and
 * outputs, and the rows of Power Shard and Somersloop slots. Presentational only: the callers bring the figures.
 */

/** The Somersloop, by descriptor class (dataset part `icons`). */
export const SOMERSLOOP_CLASS = 'Desc_WAT1_C';

/** The small capitals over a column of slots ("Input", "Output", "Power Shards"). */
export const SLOT_LABEL = 'mb-1 font-display text-xs font-semibold tracking-wider text-muted uppercase';

/** A titled part of the window: a section heading over its content, named by it. */
export function MachineSection({ title, children, className = '' }: { title: string; children: ReactNode; className?: string }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={`flex flex-col gap-2 ${className}`}>
      <SectionHeading as="h4" id={id}>{title}</SectionHeading>
      {children}
    </section>
  );
}

/** The grid of the production section: inputs (or the node), the cycle, the outputs; without a left column two. */
export function productionGrid(left: boolean): string {
  return `grid items-start gap-3 ${left ? 'sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]' : 'sm:grid-cols-[auto_minmax(0,1fr)]'}`;
}

/** A column of slots under its label. */
export function SlotColumn({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className={SLOT_LABEL}>{label}</p>
      {children}
    </div>
  );
}

/**
 * An item slot: picture, name, the main figure and a line under it. `tone` marks a slot that is the problem (an input
 * that ran short) with the conflict colour on its edge; `note` follows the name (a short word, a badge). `count` is what
 * lies in the slot, shown on the picture as in the game ("47"); `countLabel` says it to screen readers.
 */
export function ItemSlot({ item, name, value, sub, tone = 'default', note, count, countLabel }: {
  item: string; name: string; value: ReactNode; sub?: ReactNode; tone?: 'default' | 'danger'; note?: ReactNode; count?: string; countLabel?: string;
}) {
  return (
    <li data-slot={item} className={`flex min-w-0 items-center gap-2 chamfer border bg-bg p-1.5 ${tone === 'danger' ? 'border-conflict' : 'border-line'}`}>
      <span className="relative shrink-0">
        <Picture cls={item} px={32} />
        {count !== undefined && (
          <span aria-hidden="true" data-slot-count={count} className="pointer-events-none absolute right-0 bottom-0 bg-bg/85 px-0.5 font-display text-xs leading-tight font-semibold text-fg tabular-nums">
            {count}
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1 leading-5">
        <span className="block text-sm break-words">{name}{note}</span>
        <span className="block font-display text-base font-semibold tabular-nums">{value}</span>
        {sub !== undefined && <span className="block text-xs text-muted tabular-nums">{sub}</span>}
        {countLabel !== undefined && <span className="sr-only">{countLabel}</span>}
      </span>
    </li>
  );
}

/**
 * The arrow between inputs and outputs with one production cycle filling up under it (`seconds` per cycle; only while
 * `running`, and only where motion is allowed) and its caption; without `seconds` only the arrow and the caption.
 */
export function CycleBar({ seconds, caption, running = true }: { seconds?: number; caption?: ReactNode; running?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-1 self-center px-1 text-center text-xs text-muted">
      <span aria-hidden="true" className="inline-block rotate-90 text-2xl leading-none text-accent sm:rotate-0">→</span>
      {seconds !== undefined && (
        <span aria-hidden="true" data-cycle={running ? 'running' : 'still'} className="block h-1.5 w-14 overflow-hidden bg-bg">
          <span
            className={`block h-full w-full origin-left bg-accent ${running ? 'motion-safe:animate-[planner-cycle_var(--cycle)_linear_infinite]' : 'scale-x-0'}`}
            style={{ '--cycle': `${seconds}s` } as CSSProperties}
          />
        </span>
      )}
      {caption !== undefined && caption !== false && <span>{caption}</span>}
    </div>
  );
}

const SLOT = 'flex size-10 items-center justify-center chamfer border bg-bg';

/** The three Power Shard slots; the first `used` are filled. */
export function ShardSlots({ used, total, label }: { used: number; total: number; label: string }) {
  return <SlotRow cls={SHARD_CLASS} used={used} total={total} label={label} filled="border-shard" glyph={<span aria-hidden="true" className="text-lg text-shard">◆</span>} />;
}

/** A machine's Somersloop slots; the first `used` are filled. */
export function SomersloopSlots({ used, total, label }: { used: number; total: number; label: string }) {
  return <SlotRow cls={SOMERSLOOP_CLASS} used={used} total={total} label={label} filled="border-sloop" glyph={<span aria-hidden="true" className="text-lg text-sloop">●</span>} />;
}

/** A row of `total` slots, the first `used` filled with the item's picture (a glyph without one); one image to screen readers. */
function SlotRow({ cls, used, total, label, filled, glyph }: { cls: string; used: number; total: number; label: string; filled: string; glyph: ReactNode }) {
  const icons = useContext(IconsContext);
  return (
    <span role="img" aria-label={label} className="flex gap-1.5">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} data-filled={i < used} className={`${SLOT} ${i < used ? filled : 'border-dashed border-edge'}`}>
          {i < used && (icons?.has(cls) ? <GameIcon cls={cls} px={28} /> : glyph)}
        </span>
      ))}
    </span>
  );
}
