import { useTranslation } from 'react-i18next';
import type { WorldCtx } from '../../app/feature.js';
import { Button } from '../../components/Button.js';
import { Dialog } from '../../components/Dialog.js';
import { MachineWiki } from './MachineWiki.js';
import { useMachineData, useMachineWiki } from './useMachineWiki.js';

/** The wiki in a dialog, bound to `useMachineWiki`. Fetches the data only once opened. */
export function MachineWikiDialog({ version }: { version: string }) {
  const { t } = useTranslation();
  const { open, hide, selected, select, query, setQuery } = useMachineWiki();
  const { data, failed } = useMachineData(version, open);
  return (
    <Dialog open={open} onClose={hide} title={t('machineWiki.title')} wide>
      {failed ? <p role="alert">{t('machineWiki.failed')}</p>
        : data === undefined ? <p>{t('common.loading')}</p>
          : data === null ? <p>{t('machineWiki.unavailable')}</p>
            : <MachineWiki data={data} selected={selected} query={query} onSelect={select} onQuery={setQuery} />}
    </Dialog>
  );
}

/** Header button that opens the wiki, plus the dialog itself (it renders in the top layer). */
export function MachineWikiHeaderItem({ ctx }: { ctx: WorldCtx }) {
  const { t } = useTranslation();
  const show = useMachineWiki(s => s.show);
  return (
    <>
      <Button size="sm" title={t('machineWiki.openHint')} onClick={() => show()}>{t('machineWiki.open')}</Button>
      <MachineWikiDialog version={ctx.me.datasetVersion} />
    </>
  );
}
