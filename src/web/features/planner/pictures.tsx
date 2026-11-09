import { Fragment, useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { descriptorClass } from '../../../shared/machines.js';
import type { PlanStep } from '../../../shared/planner.js';
import { badgeClass } from '../../components/Badge.js';
import { BAND_TEXT } from '../factory/parts.js';
import { GameIcon, IconsContext } from '../machineWiki/icons.js';
import type { StepText, StepUse } from './stepText.js';

/** The Power Shard, by descriptor class (dataset part `icons`). */
export const SHARD_CLASS = 'Desc_CrystalShard_C';

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

/**
 * A step's picture (`stepPicture`); where that is the building, the item it makes is pinned to the bottom right
 * corner (`pin` px), as the game shows a machine's recipe.
 */
export function StepPicture({ step, px, pin }: { step: PlanStep; px: number; pin: number }) {
  const picture = stepPicture(step);
  return <PinnedPicture cls={picture.cls} item={picture.cls !== step.item ? step.item : undefined} px={px} pin={pin} dashed={picture.dashed} />;
}

/**
 * A building's picture with the item it makes pinned to its bottom right corner (`pin` px), as the game shows a
 * machine's recipe; without `item`, or without a picture of it, only the building. The planner's steps and the
 * factory's production lines use it.
 */
export function PinnedPicture({ cls, item, px, pin, dashed = false }: { cls: string; item?: string; px: number; pin: number; dashed?: boolean }) {
  const icons = useContext(IconsContext);
  const pinned = item !== undefined && icons?.has(item);
  return (
    <span className="relative shrink-0">
      <Picture cls={cls} px={px} dashed={dashed} />
      {pinned && (
        <span data-pin={item} className="absolute -right-1.5 -bottom-1.5 flex chamfer border border-line bg-panel p-px">
          <GameIcon cls={item} px={pin} />
        </span>
      )}
    </span>
  );
}

/**
 * A step's badges (`stepText`): wanted, loop, alternate, purity, clock speed with one diamond per Power Shard,
 * by-products. For a flex container; the spaces between them only keep their words apart for screen readers.
 */
export function StepBadges({ text }: { text: StepText }) {
  const { t } = useTranslation();
  return (
    <>
      {text.wanted && <span className={badgeClass('accent')} title={t('planner.diagram.wanted', { value: text.wanted })}>{t('planner.diagram.wantedBadge')}</span>}
      {' '}
      {text.loop && <span className={badgeClass('accent')} title={text.loop.long}>{text.loop.text}</span>}
      {text.badges.map(b => (
        <Fragment key={b.long}>
          {' '}
          <span className={badgeClass(b.tone)} title={b.long}>
            <span>{b.text}</span>
            {b.shards ? <span aria-hidden="true" className="text-shard">{'◆'.repeat(b.shards)}</span> : null}
          </span>
        </Fragment>
      ))}
    </>
  );
}

/**
 * A step's building use as a strip, in the factory's band colours and never by colour alone: full (100 %) solid green,
 * nearly full (≥ 90 %) dashed yellow, part load dotted orange; the "100 %" next to it says the value.
 */
export const USE_STRIP: Record<StepUse['band'], string> = {
  full: 'bg-free',
  high: 'bg-[repeating-linear-gradient(to_bottom,var(--color-power)_0_6px,transparent_6px_9px)]',
  throttled: 'bg-[repeating-linear-gradient(to_bottom,var(--color-accent)_0_3px,transparent_3px_6px)]',
};

/** The use strip along a node's left edge (the node is its containing block). */
export function UseStrip({ use }: { use: StepUse }) {
  return <span aria-hidden="true" data-use={use.band} className={`pointer-events-none absolute inset-y-0 left-0 w-1 ${USE_STRIP[use.band]}`} />;
}

/** "▍ 99.1 %": a short strip and the value in the band's colour (its title the sentence). */
export function UseMark({ use, className = '' }: { use: StepUse; className?: string }) {
  return (
    <span data-use={use.band} title={use.long} className={`inline-flex items-center gap-1 font-display font-semibold whitespace-nowrap tabular-nums ${BAND_TEXT[use.band]} ${className}`}>
      <span aria-hidden="true" className={`inline-block h-3.5 w-1 shrink-0 ${USE_STRIP[use.band]}`} />
      {use.text}
    </span>
  );
}
