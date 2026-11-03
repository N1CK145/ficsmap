import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { create } from 'zustand';
import { Button } from '../../components/Button.js';
import { IconButton } from '../../components/IconButton.js';

export const IMPORT_BANNER_MS = 20_000;

export interface ImportBannerState {
  /** The last import's result while its banner shows; `id` restarts the auto-hide timer. */
  shown: { id: number; worldId: string; added: number; conflicts: number } | null;
  /** [Review conflicts]: set by the conflicts feature. */
  onReview?: () => void;
  show(worldId: string, r: { added: number; conflicts: number }): void;
  dismiss(): void;
}

let nextId = 0;

export const useImportBanner = create<ImportBannerState>()(set => ({
  shown: null,
  show: (worldId, r) => set({ shown: { id: ++nextId, worldId, ...r } }),
  dismiss: () => set({ shown: null }),
}));

/**
 * "Import done · +N · M conflicts (!) · [Review conflicts]" over the map of the world that was
 * imported into (spec §7 step 7, §10.7). Dismissible; hides itself after 20 s.
 */
export function ImportBanner({ worldId }: { worldId: string }) {
  const { t } = useTranslation();
  const shown = useImportBanner(s => (s.shown?.worldId === worldId ? s.shown : null));
  const dismiss = useImportBanner(s => s.dismiss);
  const id = shown?.id;

  useEffect(() => {
    if (id === undefined) return;
    const timer = setTimeout(() => {
      if (useImportBanner.getState().shown?.id === id) dismiss();
    }, IMPORT_BANNER_MS);
    return () => clearTimeout(timer);
  }, [id, dismiss]);

  if (!shown) return null;
  return (
    <div
      role="status"
      className="absolute top-12 left-1/2 z-[1001] flex max-w-[calc(100%-2rem)] -translate-x-1/2 items-center gap-2 rounded border border-line bg-panel py-1 pr-1 pl-3 text-sm shadow-lg"
    >
      <span>{t('import.banner', { added: shown.added, conflicts: shown.conflicts })}</span>
      {shown.conflicts > 0 && (
        <Button variant="link-accent" size="sm" onClick={() => useImportBanner.getState().onReview?.()}>
          {t('import.review')}
        </Button>
      )}
      <IconButton aria-label={t('import.dismiss')} size="sm" onClick={dismiss}>
        <span aria-hidden="true">×</span>
      </IconButton>
    </div>
  );
}
