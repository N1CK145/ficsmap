import { useTranslation } from 'react-i18next';
import type { WorldCtx } from '../../app/feature.js';
import { Dialog } from '../../components/Dialog.js';
import { IconsContext, useItemIcons } from './icons.js';
import { MachineWiki } from './MachineWiki.js';
import { useMachineData, useMachineWiki } from './useMachineWiki.js';

/** The wiki in a dialog, bound to `useMachineWiki`. Fetches the data and the picture index only once opened. */
export function MachineWikiDialog({ version }: { version: string }) {
  const { t } = useTranslation();
  const { open, hide, selected, select, query, setQuery, tiers, setTiers } = useMachineWiki();
  const { data, failed } = useMachineData(version, open);
  const icons = useItemIcons(version, open);
  return (
    <Dialog open={open} onClose={hide} title={t('machineWiki.title')} wide="xl">
      {failed ? <p role="alert">{t('machineWiki.failed')}</p>
        : data === undefined ? <p>{t('common.loading')}</p>
          : data === null ? <p>{t('machineWiki.unavailable')}</p>
            : (
              <IconsContext.Provider value={icons}>
                <MachineWiki data={data} selected={selected} query={query} tiers={tiers}
                  onSelect={select} onQuery={setQuery} onTiers={setTiers} />
              </IconsContext.Provider>
            )}
    </Dialog>
  );
}

/** The dialog for the world's dataset version, as a header item (it renders in the top layer). */
export function MachineWikiHost({ ctx }: { ctx: WorldCtx }) {
  return <MachineWikiDialog version={ctx.me.datasetVersion} />;
}
