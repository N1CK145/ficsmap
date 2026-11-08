import type { ReactNode } from 'react';
import type { Tool, WorldCtx } from './feature.js';

/** The shape of the layer stores the map switches use (`useCaveLayer`, `useHeightLayer`, ...). */
export interface ToggleStore { visible: boolean; toggle(): void }

export interface ToggleToolOptions {
  id: string; order: number; labelKey: string; hintKey?: string; icon?: ReactNode; shortcut?: string;
  /** The switch's store hook, called without a selector (a zustand store such as `useCaveLayer`). */
  useToggle: () => ToggleStore;
  /** A hook: whether the switch applies at all (e.g. the dataset has caves). Default: always. */
  useAvailable?: (ctx: WorldCtx) => boolean;
}

/**
 * A tool for an on/off switch kept in a `{ visible, toggle }` store. A map control that is such a
 * switch moves into the tool navigation by replacing its `mapControls` entry with
 * `tools: [toggleTool({ id, order, labelKey, hintKey, useToggle: useXLayer, useAvailable })]`.
 */
export function toggleTool({ useToggle, useAvailable, ...meta }: ToggleToolOptions): Tool {
  return {
    ...meta,
    useTool: ctx => {
      const { visible, toggle } = useToggle();
      const available = useAvailable ? useAvailable(ctx) : true;
      return { available, pressed: visible, run: toggle };
    },
  };
}

export interface PageToolOptions {
  id: string; order: number; labelKey: string; hintKey?: string; icon?: ReactNode;
  /** The id of the world page (`FeatureModule.pages`) the tool leads to. */
  page: string;
  /** A hook: whether the page applies at all. Default: always. */
  useAvailable?: (ctx: WorldCtx) => boolean;
}

/**
 * A tool that leads to a world page (`/w/:id/<page>`): a section of the world, a tab from 1280 px and an entry of the
 * section menu below that, marked as the current page while that page is shown.
 */
export function pageTool({ useAvailable, ...meta }: PageToolOptions): Tool {
  return {
    ...meta,
    action: true,
    useTool: ctx => ({ available: useAvailable ? useAvailable(ctx) : true }),
  };
}
