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
