import { createContext, useContext, type ReactNode } from 'react';
import type { FeatureModule } from './feature.js';

const FeaturesContext = createContext<readonly FeatureModule[] | null>(null);

/**
 * The registered features for code inside features (layouts, the event stream). Passing them down
 * keeps `features/index.ts` out of the features' own imports, so there is no import cycle.
 */
export function FeaturesProvider({ features, children }: { features: readonly FeatureModule[]; children: ReactNode }) {
  return <FeaturesContext value={features}>{children}</FeaturesContext>;
}

export function useFeatures(): readonly FeatureModule[] {
  const features = useContext(FeaturesContext);
  if (!features) throw new Error('useFeatures must be used inside <FeaturesProvider>');
  return features;
}
