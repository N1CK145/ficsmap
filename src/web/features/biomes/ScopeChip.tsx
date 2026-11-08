import { useTranslation } from 'react-i18next';
import type { WorldCtx } from '../../app/feature.js';
import { useUiStore } from '../../app/store.js';
import { CloseIcon } from '../../components/icons.js';
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
    <span className="flex h-8 min-w-0 shrink items-center chamfer border border-accent/50 bg-accent/12 pl-2.5 text-accent">
      <span className="min-w-0 truncate text-sm font-medium">{t('biomes.scope', { name })}</span>
      <button
        type="button"
        aria-label={t('biomes.clearScope')}
        title={t('biomes.clearScope')}
        onClick={() => setBiomeScope(null)}
        className="flex size-8 shrink-0 items-center justify-center chamfer text-accent focus-ring hover:bg-accent/20"
      >
        <CloseIcon size={14} />
      </button>
    </span>
  );
}
