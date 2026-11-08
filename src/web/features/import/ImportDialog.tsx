import type { QueryClient } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { create } from 'zustand';
import type { ImportRequest, ImportResultDto } from '../../../shared/api.js';
import type { DatasetIndex } from '../../../shared/dataset.js';
import type { ExtractResult } from '../../../shared/extract.js';
import { isRandomized } from '../../../shared/resourceNodes.js';
import { api, ApiClientError } from '../../app/api.js';
import type { WorldCtx } from '../../app/feature.js';
import { queryKeys } from '../../app/queryKeys.js';
import { Button } from '../../components/Button.js';
import { UploadIcon } from '../../components/icons.js';
import { Dialog } from '../../components/Dialog.js';
import { factoryOf, uploadSnapshot } from '../factory/api.js';
import { useMarks, type MarksCache } from '../marks/useMarks.js';
import { useNodeSettingsText } from '../resourceNodes/nodeSettings.js';
import { useImportBanner } from './ImportBanner.js';
import { OlderSavesFlow } from './OlderSaves.js';
import { computePreview, countByType, type ImportPreview } from './preview.js';
import { formatSaveDate, SaveSource } from './SaveSource.js';
import { datasetUrlFor, useSaveParser } from './useSaveParser.js';

/** What the import dialog shows: the import of one save, or adding older saves to the factory timeline. */
export type ImportDialogMode = 'save' | 'older';

/** Opens the import dialog from anywhere (header [Import], settings "Import save" and "Add older saves"). */
export const useImportDialog = create<{ open: boolean; mode: ImportDialogMode; show(mode?: ImportDialogMode): void; hide(): void }>()(set => ({
  open: false,
  mode: 'save',
  show: (mode = 'save') => set({ open: true, mode }),
  hide: () => set({ open: false }),
}));

/** The marks of a world without any: the preview of a world created from the save. */
export const EMPTY_MARKS: MarksCache = { rev: 0, baseRev: 0, marks: new Map(), revs: new Map(), pending: new Map() };

/** Server limits on the import body (src/server/http/import.ts). */
const MAX_NAME = 255;
const MAX_NODE_OVERRIDES = 2000;
const MAX_EXTRACTORS = 2000;

/** The import body, clamped to what the server accepts. */
export function importRequest(fileName: string, r: ExtractResult): ImportRequest {
  const t = Math.trunc(r.meta.saveTime);
  return {
    fileName: fileName.slice(0, MAX_NAME),
    sessionName: r.meta.sessionName.slice(0, MAX_NAME),
    saveTime: Number.isFinite(t) && t > 0 ? t : 0,
    build: r.meta.build,
    collected: r.collected,
    ...(r.resourceNodes
      ? {
        resourceNodes: {
          overrides: r.resourceNodes.overrides.slice(0, MAX_NODE_OVERRIDES),
          settings: r.resourceNodes.settings,
          extractors: (r.resourceNodes.extractors ?? []).slice(0, MAX_EXTRACTORS),
        },
      }
      : {}),
  };
}

/** Header [Import] (owner only): opens the dialog the world layout hosts (ImportDialogHost). */
export function ImportButton({ ctx }: { ctx: WorldCtx }) {
  const { t } = useTranslation();
  const show = useImportDialog(s => s.show);
  if (!ctx.world.isOwner) return null;
  // Below 1280 px only the icon shows (the bar keeps room for the world name); the word stays the button's name.
  return (
    <Button size="sm" title={t('import.button')} onClick={() => show()}>
      <UploadIcon />
      <span className="max-[1279px]:sr-only">{t('import.button')}</span>
    </Button>
  );
}

/** The import dialog bound to `useImportDialog`; owner only. Mounted once by the world layout. */
export function ImportDialogHost({ ctx }: { ctx: WorldCtx }) {
  const open = useImportDialog(s => s.open);
  const mode = useImportDialog(s => s.mode);
  const hide = useImportDialog(s => s.hide);
  if (!ctx.world.isOwner) return null;
  return <ImportDialog ctx={ctx} open={open} mode={mode} onClose={hide} />;
}

/**
 * Spec §7: pick, parse, preview, import into the current world. `mode` is what it shows when it opens; the import
 * leads to "Add older saves" (only their factory snapshots) and back.
 */
export function ImportDialog({ ctx, open, onClose, mode = 'save' }: { ctx: WorldCtx; open: boolean; onClose(): void; mode?: ImportDialogMode }) {
  const { t } = useTranslation();
  const [view, setView] = useState(mode);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setView(mode);
  }
  return (
    <Dialog open={open} onClose={onClose} title={t(view === 'older' ? 'import.older.title' : 'import.title')}>
      {view === 'older'
        ? <OlderSavesFlow ctx={ctx} onClose={onClose} onBack={() => setView('save')} />
        : <ImportFlow ctx={ctx} onClose={onClose} onOlder={() => setView('older')} />}
    </Dialog>
  );
}

/**
 * After a save import: uploads the save's factory snapshot in the background, so the factory map gets it. Its
 * failure does not undo the import; `onFailed` tells the user. Parsers without factory extraction send nothing.
 */
export function uploadFactoryAfterImport(worldId: string, r: ExtractResult, queryClient: QueryClient, onFailed: () => void): void {
  const snapshot = factoryOf(r);
  if (!snapshot) return;
  uploadSnapshot(worldId, snapshot, queryClient).catch(onFailed);
}

/** What went wrong, for the error box: HTTP status and the server's message, or the network error. */
function failureDetail(err: unknown): string {
  if (err instanceof ApiClientError) return err.status === 0 ? err.message : `HTTP ${err.status} · ${err.code}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

function ImportFlow({ ctx, onClose, onOlder }: { ctx: WorldCtx; onClose(): void; onOlder(): void }) {
  const { t } = useTranslation();
  const parser = useSaveParser(datasetUrlFor(ctx.me.datasetVersion));
  const marks = useMarks(ctx.worldId);
  const [fileName, setFileName] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<{ message: string; detail: string } | null>(null);
  const result = parser.state.status === 'done' ? parser.state.result : undefined;

  function pick(file: File) {
    setFileName(file.name);
    setConfirming(false);
    setFailed(null);
    parser.start(file);
  }

  function again() {
    setConfirming(false);
    setFailed(null);
    parser.cancel();
  }

  async function submit(r: ExtractResult) {
    setBusy(true);
    setFailed(null);
    try {
      const out = await api<ImportResultDto>('POST', `/api/worlds/${encodeURIComponent(ctx.worldId)}/import`, importRequest(fileName, r));
      void ctx.queryClient.invalidateQueries({ queryKey: queryKeys.marks(ctx.worldId) });
      void ctx.queryClient.invalidateQueries({ queryKey: queryKeys.world(ctx.worldId) });
      void ctx.queryClient.invalidateQueries({ queryKey: queryKeys.worlds() });
      useImportBanner.getState().show(ctx.worldId, { added: out.newlyChecked, conflicts: out.conflicts });
      uploadFactoryAfterImport(ctx.worldId, r, ctx.queryClient, () => ctx.toast.show({ message: t('import.factoryFailed') }));
      onClose();
    } catch (err) {
      const rateLimited = err instanceof ApiClientError && err.code === 'rate_limited';
      setFailed({ message: t(rateLimited ? 'import.rateLimited' : 'import.failed'), detail: failureDetail(err) });
      setBusy(false);
    }
  }

  if (!result) {
    return (
      <div className="flex flex-col gap-3">
        <SaveSource parser={parser} onPick={pick} />
        {parser.state.status === 'idle' && (
          <div className="flex flex-col gap-1 border-t border-line pt-3">
            <p className="text-sm text-muted">{t('import.older.teaser')}</p>
            <Button className="self-start" onClick={onOlder}>{t('import.older.open')}</Button>
          </div>
        )}
      </div>
    );
  }
  const preview = computePreview(result, marks ?? EMPTY_MARKS, ctx.index);
  return (
    <div className="flex flex-col gap-3">
      <SaveSummary result={result} index={ctx.index} preview={preview} confirming={confirming} />
      {failed && (
        <div role="alert" className="chamfer border border-conflict px-3 py-2 text-sm">
          <p className="font-medium">{failed.message}</p>
          {failed.detail && <p className="mt-1 font-mono text-xs break-words text-muted">{failed.detail}</p>}
        </div>
      )}
      <div className="flex justify-end gap-2">
        {confirming ? (
          <>
            <Button onClick={() => setConfirming(false)}>{t('common.cancel')}</Button>
            <Button variant="danger" disabled={busy} onClick={() => void submit(result)}>{t('import.importAnyway')}</Button>
          </>
        ) : (
          <>
            <Button onClick={again}>{t('import.chooseAnother')}</Button>
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => (preview.needsSecondConfirm ? setConfirming(true) : void submit(result))}
            >
              {t('import.submit')}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The preview (spec §7 step 4): "<session> · <date> · build N", what was recognised per type, and with
 * `counts` (import into an existing world) "+N will be checked · M conflicts". Warnings: newer build,
 * nothing recognised, and while `confirming` the second confirmation's text (Review Focus 1).
 */
export function SaveSummary({ result, index, preview, counts = true, confirming = false }: {
  result: ExtractResult; index: DatasetIndex; preview: ImportPreview; counts?: boolean; confirming?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const { meta } = result;
  const byType = countByType(result.collected, index);
  return (
    <div className="flex flex-col gap-3">
      <p className="font-medium">{t('import.meta', { session: meta.sessionName, date: formatSaveDate(meta.saveTime, i18n.language), build: String(meta.build) })}</p>
      <div className="flex flex-col gap-1">
        <p className="text-sm">{t('import.recognised', { count: result.recognised })}</p>
        {byType.length > 0 && (
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 text-sm text-muted">
            {byType.map(([type, n]) => (
              <div key={type} className="contents">
                <dt>{t(`progress.types.${type}`)}</dt>
                <dd className="text-right font-display tabular-nums">{n}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      <NodeSummary result={result} />
      {counts && <p className="font-display text-lg font-semibold">{t('import.counts', { willCheck: preview.willCheck, conflicts: preview.conflicts })}</p>}
      {preview.buildNewer && (
        <p role="note" className="chamfer border border-line bg-bg px-3 py-2 text-sm">
          {t('import.buildNewer', { save: String(meta.build), data: String(index.ds.build) })}
        </p>
      )}
      {result.recognised === 0 && (
        <p role="alert" className="chamfer border border-conflict px-3 py-2 text-sm">
          {confirming ? t('import.confirmNoMatch', { count: preview.conflicts }) : t('import.noMatch')}
        </p>
      )}
    </div>
  );
}

/**
 * What the save says about resource nodes (shown on the map after the import): nodes that differ from the default
 * map, and the extractors standing on nodes.
 */
function NodeSummary({ result }: { result: ExtractResult }) {
  const { t } = useTranslation();
  const settingsText = useNodeSettingsText();
  const nodes = result.resourceNodes;
  if (!nodes) return null;
  const extractors = nodes.extractors ?? [];
  const shards = extractors.reduce((sum, e) => sum + (e[3] ?? 0), 0);
  const placed = extractors.length > 0 && (
    <p className="text-sm">{t('resourceNodes.importExtractors', { count: extractors.length, shards })}</p>
  );
  let differs: ReactNode = null;
  if (nodes.overrides.length > 0) differs = <p className="text-sm">{t('resourceNodes.importChanged', { count: nodes.overrides.length })}</p>;
  else if (isRandomized(nodes.settings)) {
    differs = <p role="note" className="chamfer border border-line bg-bg px-3 py-2 text-sm">{t('resourceNodes.importRandomized', { mode: settingsText(nodes.settings) })}</p>;
  }
  return <>{differs}{placed}</>;
}
