import { useCallback, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MOBILE_QUERY } from '../../app/useMediaQuery.js';
import { Button } from '../../components/Button.js';
import { useToast } from '../../components/Toast.js';
import {
  chooseSaveFolder, grantSaveFolderAccess, listSavesFromStoredFolder, SAVE_FOLDER_HINT, supportsFolderPicker, type SaveFileEntry,
} from './pickSave.js';
import type { SaveParser } from './useSaveParser.js';

export function formatSaveDate(at: number, locale: string): string {
  if (!Number.isFinite(at)) return '—';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(at);
}

function isMobile(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(MOBILE_QUERY).matches;
}

/**
 * The save-picking part shared by the import dialog and "From save file" (spec §7 steps 1–2): the
 * folder list (Chromium) and a file input with [Copy path], then the worker's progress with [Cancel],
 * or the error with [Choose another file]. Renders nothing once the parse is done; the caller shows
 * its preview then.
 */
export function SaveSource({ parser, onPick }: { parser: SaveParser; onPick(file: File): void }) {
  const { t } = useTranslation();
  const [mobile] = useState(isMobile);
  const { state } = parser;
  if (state.status === 'done') return null;
  return (
    <div className="flex flex-col gap-3">
      {state.status === 'idle' && <Pick onPick={onPick} />}
      {state.status === 'running' && (
        <div className="flex flex-col gap-2">
          <div className="flex justify-between text-sm">
            <span>{t(`import.stage.${state.stage ?? 'reading'}`)}</span>
            <span className="font-display tabular-nums">{t('import.percent', { percent: state.percent ?? 0 })}</span>
          </div>
          <div
            role="progressbar"
            aria-label={t('import.progressLabel')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={state.percent ?? 0}
            className="h-2 overflow-hidden rounded bg-line"
          >
            <div className="h-full bg-accent transition-[width]" style={{ width: `${state.percent ?? 0}%` }} />
          </div>
          <div className="flex justify-end">
            <Button onClick={parser.cancel}>{t('common.cancel')}</Button>
          </div>
        </div>
      )}
      {state.status === 'error' && (
        <div role="alert" className="flex flex-col gap-2">
          <p className="font-medium">{t(state.error === 'dataset_unavailable' ? 'import.datasetUnavailable' : 'import.notASave')}</p>
          {state.error === 'failed' && <p className="text-sm text-muted">{t('import.failedHint')}</p>}
          <div className="flex justify-end">
            <Button variant="primary" onClick={parser.cancel}>{t('import.chooseAnother')}</Button>
          </div>
        </div>
      )}
      {mobile && <p className="text-sm text-muted">{t('import.mobileHint')}</p>}
    </div>
  );
}

function Pick({ onPick }: { onPick(file: File): void }) {
  const { t } = useTranslation();
  const toast = useToast();
  const inputId = useId();
  const folder = supportsFolderPicker();

  async function copyPath() {
    try {
      await navigator.clipboard.writeText(SAVE_FOLDER_HINT);
    } catch {
      return; // No clipboard access: the path stays readable next to the button.
    }
    toast.show({ message: t('import.pathCopied') });
  }

  return (
    <>
      {folder && <FolderList onPick={onPick} />}
      <div className="flex flex-col gap-2">
        {folder && <p className="text-sm text-muted">{t('import.orFile')}</p>}
        <label htmlFor={inputId} className="text-sm font-medium">{t('import.fileLabel')}</label>
        <input
          id={inputId}
          type="file"
          accept=".sav"
          onChange={e => {
            const file = e.target.files?.[0];
            if (file) onPick(file);
          }}
          className="rounded text-sm focus-ring file:mr-3 file:h-10 file:rounded file:border file:border-line file:bg-panel file:px-4 file:text-fg"
        />
      </div>
      <p className="text-sm text-muted">{t('import.privacy')}</p>
      <div className="flex flex-col gap-1 text-sm">
        <span className="text-muted">{t('import.folderHint')}</span>
        <div className="flex items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded border border-line bg-bg px-2 py-1 font-mono">{SAVE_FOLDER_HINT}</code>
          <Button size="sm" onClick={() => void copyPath()}>{t('import.copyPath')}</Button>
        </div>
      </div>
    </>
  );
}

type Listing = 'loading' | 'no-folder' | 'needs-permission' | 'failed' | SaveFileEntry[];

/** Chromium: the saves of the stored folder, newest first; or the buttons to choose it or allow access again. */
function FolderList({ onPick }: { onPick(file: File): void }) {
  const { t, i18n } = useTranslation();
  const [listing, setListing] = useState<Listing>('loading');

  const load = useCallback(async () => {
    try {
      setListing(await listSavesFromStoredFolder());
    } catch {
      setListing('failed');
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function choose() {
    await chooseSaveFolder();
    await load();
  }
  async function grant() {
    if (await grantSaveFolderAccess()) await load();
  }

  if (listing === 'loading') return <p className="text-sm text-muted">{t('common.loading')}</p>;
  if (listing === 'needs-permission') {
    return (
      <div className="flex flex-col gap-2">
        <p className="text-sm">{t('import.needsPermission')}</p>
        <div className="flex gap-2">
          <Button variant="primary" onClick={() => void grant()}>{t('import.grantAccess')}</Button>
          <Button onClick={() => void choose()}>{t('import.changeFolder')}</Button>
        </div>
      </div>
    );
  }
  if (listing === 'no-folder' || listing === 'failed') {
    return (
      <div className="flex flex-col gap-2">
        {listing === 'failed' && <p role="alert" className="text-sm">{t('import.folderFailed')}</p>}
        <Button variant="primary" className="self-start" onClick={() => void choose()}>{t('import.chooseFolder')}</Button>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{t('import.savesLabel')}</h3>
        <Button size="sm" variant="ghost" onClick={() => void choose()}>{t('import.changeFolder')}</Button>
      </div>
      {listing.length === 0 && <p className="text-sm text-muted">{t('import.noSaves')}</p>}
      {listing.length > 0 && (
        <ul className="flex max-h-60 flex-col overflow-y-auto rounded border border-line">
          {listing.map(s => (
            <li key={`${s.name}/${s.modified}`} className="border-b border-line last:border-b-0">
              <button
                type="button"
                onClick={() => onPick(s.file)}
                className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-line focus-ring"
              >
                <span className="font-medium">{s.session}</span>
                <span className="text-sm text-muted">{s.name} · {formatSaveDate(s.modified, i18n.language)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
