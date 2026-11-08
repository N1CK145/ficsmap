import type { FeatureModule } from '../../app/feature.js';
import { setCreateFromSaveContent } from '../worlds/CreateWorldDialog.js';
import { CreateFromSave } from './CreateFromSave.js';
import { ImportButton } from './ImportDialog.js';

export { ImportBanner, useImportBanner } from './ImportBanner.js';
export { ImportDialog, ImportDialogHost, useImportDialog } from './ImportDialog.js';

// The create dialog's "From save file" tab runs this feature's parse flow.
setCreateFromSaveContent(CreateFromSave);

/** Save import (spec §7): header [Import] for owners, the import dialog and banner, and "From save file". */
export const importFeature: FeatureModule = {
  id: 'import',
  headerItems: [{ id: 'import', order: 30, mapOnly: true, Component: ImportButton }],
};
