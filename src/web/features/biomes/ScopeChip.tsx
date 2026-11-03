import { useTranslation } from 'react-i18next';
import type { WorldCtx } from '../../app/feature.js';
import { useUiStore } from '../../app/store.js';
import { IconButton } from '../../components/IconButton.js';
import { biomeName } from './useBiomes.js';

/** Header chip "Scope: <biome> ×" (spec §10.4); the × clears the scope. Only while a biome is selected. */
export function ScopeChip({ ctx }: { ctx: WorldCtx }) {
  const { t, i18n } = useTranslation();
  const biomeScope = useUiStore(s => s.biomeScope);
  const setBiomeScope = useUiStore(s => s.setBiomeScope);
  if (biomeScope === null) return null;
  const name = biomeName(ctx.index.ds, biomeScope, i18n.language);
  if (name === undefined) return null;
  return (
    <span className="flex shrink-0 items-center gap-1 rounded border border-accent pl-2 text-sm text-accent">
      <span>{t('biomes.scope', { name })}</span>
      <IconButton aria-label={t('biomes.clearScope')} size="sm" onClick={() => setBiomeScope(null)}>×</IconButton>
    </span>
  );
}
