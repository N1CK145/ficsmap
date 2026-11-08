import { descriptorClass } from '../../../shared/machines.js';
import type { PlanStep } from '../../../shared/planner.js';
import { GameIcon } from '../machineWiki/icons.js';

/** The Power Shard and the Somersloop, by descriptor class (dataset part `icons`). */
export const SHARD_CLASS = 'Desc_CrystalShard_C';
export const SOMERSLOOP_CLASS = 'Desc_WAT1_C';

/**
 * What a step's picture shows: its building (`Build_X_C` -> `Desc_X_C`), or the item itself for an item supplied from
 * outside (in a dashed frame) or covered by by-products of other steps (no buildings).
 */
export function stepPicture(step: PlanStep): { cls: string; dashed: boolean } {
  if (step.choice.kind === 'external') return { cls: step.item, dashed: true };
  if (step.machines < 1e-9 || !step.building) return { cls: step.item, dashed: false };
  return { cls: descriptorClass(step.building), dashed: false };
}

/**
 * A game picture on a neutral tile 8 px larger than the picture. Without a picture the empty tile stays, so every node
 * and slot keeps its shape. Decorative: the text next to it names the thing.
 */
export function Picture({ cls, px, dashed = false, className = '' }: { cls: string; px: number; dashed?: boolean; className?: string }) {
  return (
    <span
      data-picture={cls}
      className={`flex shrink-0 items-center justify-center chamfer bg-bg ${dashed ? 'border border-dashed border-muted' : ''} ${className}`}
      style={{ width: px + 8, height: px + 8 }}
    >
      <GameIcon cls={cls} px={px} placeholder />
    </span>
  );
}
