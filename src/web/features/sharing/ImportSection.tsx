import { useTranslation } from 'react-i18next';
import type { WorldCtx } from '../../app/feature.js';
import { Button } from '../../components/Button.js';
import { useImportDialog } from '../import/ImportDialog.js';
import { SettingsBlock } from './SettingsPage.js';

/** Import save and add older saves (owner and admins): open the import dialog the world layout hosts. */
export function ImportSection(_props: { ctx: WorldCtx }) {
  const { t } = useTranslation();
  const show = useImportDialog(s => s.show);
  return (
    <SettingsBlock title={t('settings.import.title')}>
      <p className="text-sm text-muted">{t('settings.import.hint')}</p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => show()}>{t('settings.import.open')}</Button>
        <Button onClick={() => show('older')}>{t('import.older.open')}</Button>
      </div>
    </SettingsBlock>
  );
}
