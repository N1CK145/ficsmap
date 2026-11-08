import { Fragment, useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { descriptorClass } from '../../../shared/machines.js';
import type { PlanStep } from '../../../shared/planner.js';
import { badgeClass } from '../../components/Badge.js';
import { GameIcon, IconsContext } from '../machineWiki/icons.js';
import type { StepText } from './stepText.js';

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
  const icons = useContext(IconsContext);
  const picture = stepPicture(step);
  const pinned = picture.cls !== step.item && icons?.has(step.item);
  return (
    <span className="relative shrink-0">
      <Picture cls={picture.cls} px={px} dashed={picture.dashed} />
      {pinned && (
        <span data-pin={step.item} className="absolute -right-1.5 -bottom-1.5 flex chamfer border border-line bg-panel p-px">
          <GameIcon cls={step.item} px={pin} />
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
