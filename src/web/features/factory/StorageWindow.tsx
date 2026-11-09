import type { ReactNode, Ref } from 'react';
import { useTranslation } from 'react-i18next';
import type { SnapshotInventory } from '../../../shared/factory/snapshot.js';
import { Window } from '../../components/Window.js';
import { GameIcon } from '../machineWiki/icons.js';
import type { FactoryLabels } from './data.js';
import type { FactoryFormat } from './format.js';
import { InventoryView } from './Inventory.js';

/** The i18n key of a crate's name by its kind: a death crate, else a crate. */
export function crateKey(kind: string): string {
  return kind === 'CT_DeathCrate' ? 'factory.inventory.crate.death' : 'factory.inventory.crate.other';
}

/** A crate has no picture in the game data: a box with a cross, as the map draws it. */
export function CrateGlyph({ px = 40 }: { px?: number }) {
  return (
    <svg width={px} height={px} viewBox="0 0 40 40" aria-hidden="true" className="shrink-0 text-fg">
      <rect x="8" y="8" width="24" height="24" fill="var(--color-bg)" stroke="currentColor" strokeWidth="2.5" />
      <path d="M8 8 32 32M32 8 8 32" stroke="currentColor" strokeWidth="2.5" />
    </svg>
  );
}

export interface StorageWindowProps {
  /** The title: the building's name, or the crate's kind. */
  name: string;
  /** The building's picture class (`FactoryLabels.buildingPicture`); without one the crate glyph. */
  picture?: string;
  /** What lies in it; undefined when the snapshot was extracted before inventories were read. */
  inv: SnapshotInventory | undefined;
  /** A fluid buffer's capacity in m³. */
  capacityM3?: number;
  labels: FactoryLabels;
  fmt: FactoryFormat;
  onClose(): void;
  titleRef?: Ref<HTMLHeadingElement>;
  /** First in the body (the map's "New since"). */
  top?: ReactNode;
  className?: string;
}

/**
 * A storage container, storage box, fluid buffer, Dimensional Depot uploader or crate as the game's container window:
 * its picture and name in the title bar, then how full it is, its slots as a grid (picture and count per slot, the free
 * ones empty) and what it holds per item. Read-only.
 */
export function StorageWindow({ name, picture, inv, capacityM3, labels, fmt, onClose, titleRef, top, className = '' }: StorageWindowProps) {
  const { t } = useTranslation();
  return (
    <Window
      as="div"
      level={3}
      title={name}
      titleRef={titleRef}
      icon={picture ? <GameIcon cls={picture} px={40} placeholder /> : <CrateGlyph />}
      onClose={onClose}
      closeLabel={t('factory.machineWindow.close', { name })}
      className={`min-h-0 ${className}`}
      bodyClassName="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain p-3"
    >
      {top}
      {inv ? <InventoryView inv={inv} labels={labels} fmt={fmt} capacityM3={capacityM3} />
        : <p className="text-sm text-muted" data-testid="inventory-unknown">{t('factory.inventory.unknown')}</p>}
    </Window>
  );
}
