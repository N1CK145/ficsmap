import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { SnapshotSummary } from '../../../shared/factory/snapshot.js';
import { sameSave } from '../../../shared/factory/storage.js';
import { api, ApiClientError } from '../../app/api.js';
import type { WorldCtx } from '../../app/feature.js';
import { queryKeys } from '../../app/queryKeys.js';
import { Badge, type BadgeTone } from '../../components/Badge.js';
import { Button } from '../../components/Button.js';
import type { SaveWorkerStage } from '../../save.worker.js';
import { factoryOf, snapshotsPath, uploadSnapshot } from '../factory/api.js';
import { formatSaveDate } from './SaveSource.js';
import { datasetUrlFor, parseSaveFile, SaveParseFailure } from './useSaveParser.js';

export type OlderSaveStatus =
  | 'queued' | 'parsing' | 'uploading' | 'added'
  | 'duplicate' | 'otherSession' | 'noFactory' | 'notASave' | 'tooLarge' | 'limit' | 'rateLimited' | 'failed' | 'cancelled';

export interface OlderSaveRow {
  key: number;
  file: File;
  status: OlderSaveStatus;
  /** From the parsed save. */
  session?: string;
  saveTime?: number;
  /** Added although its session differs from the world's ("Add anyway"). */
  force?: boolean;
}

const TONES: Record<OlderSaveStatus, BadgeTone> = {
  queued: 'neutral', parsing: 'accent', uploading: 'accent', added: 'success',
  duplicate: 'neutral', otherSession: 'power', noFactory: 'neutral', notASave: 'danger', tooLarge: 'danger',
  limit: 'danger', rateLimited: 'danger', failed: 'danger', cancelled: 'neutral',
};
const SKIPPED: ReadonlySet<OlderSaveStatus> = new Set(['duplicate', 'otherSession', 'noFactory', 'notASave', 'tooLarge', 'limit', 'rateLimited', 'failed', 'cancelled']);

/** The session older saves should belong to: the world's last import, else its newest snapshot, else none yet. */
export function expectedSession(lastImport: { sessionName: string } | null, snapshots: readonly SnapshotSummary[]): string | undefined {
  return lastImport?.sessionName ?? snapshots[0]?.sessionName;
}

function uploadStatus(err: unknown): OlderSaveStatus {
  if (!(err instanceof ApiClientError)) return 'failed';
  if (err.status === 413) return 'tooLarge';
  if (err.code === 'limit_reached') return 'limit';
  if (err.code === 'rate_limited') return 'rateLimited';
  return 'failed';
}

/**
 * "Add older saves": several saves are parsed one after another with the save worker, and only their factory
 * snapshots are uploaded (for the factory map's timeline); checks and resource nodes stay as the last import set
 * them. Skipped: saves of another session than the world's (with "Add anyway"), saves the world already has, and
 * files that are no save. Runs in order of the files' dates, oldest first.
 */
export function OlderSavesFlow({ ctx, onClose, onBack }: { ctx: WorldCtx; onClose(): void; onBack(): void }) {
  const { t, i18n } = useTranslation();
  const inputId = useId();
  const [rows, setRows] = useState<OlderSaveRow[]>([]);
  const [current, setCurrent] = useState<{ n: number; total: number; stage: SaveWorkerStage; percent: number } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const nextKey = useRef(0);
  const expected = useRef<string | undefined>(undefined);

  useEffect(() => () => abort.current?.abort(), []);

  const update = (key: number, patch: Partial<OlderSaveRow>) =>
    setRows(list => list.map(r => (r.key === key ? { ...r, ...patch } : r)));

  async function run(queue: OlderSaveRow[]) {
    const ac = new AbortController();
    abort.current = ac;
    const datasetUrl = datasetUrlFor(ctx.me.datasetVersion);
    let known: SnapshotSummary[];
    try {
      known = await ctx.queryClient.fetchQuery({
        queryKey: queryKeys.snapshots(ctx.worldId),
        queryFn: () => api<SnapshotSummary[]>('GET', snapshotsPath(ctx.worldId)),
      });
    } catch {
      for (const row of queue) update(row.key, { status: 'failed' });
      return;
    }
    expected.current = expectedSession(ctx.world.lastImport, known);
    for (const [i, row] of queue.entries()) {
      if (ac.signal.aborted) break;
      update(row.key, { status: 'parsing' });
      setCurrent({ n: i + 1, total: queue.length, stage: 'reading', percent: 0 });
      let snapshot;
      try {
        const result = await parseSaveFile(row.file, datasetUrl, (stage, percent) => {
          if (!ac.signal.aborted) setCurrent({ n: i + 1, total: queue.length, stage, percent });
        }, ac.signal);
        snapshot = factoryOf(result);
        update(row.key, { session: result.meta.sessionName, saveTime: result.meta.saveTime });
      } catch (err) {
        const code = err instanceof SaveParseFailure ? err.code : 'failed';
        if (code === 'cancelled') break;
        update(row.key, { status: code === 'not_a_save' ? 'notASave' : 'failed' });
        continue;
      }
      if (!snapshot) {
        update(row.key, { status: 'noFactory' });
        continue;
      }
      const { meta } = snapshot;
      if (!row.force && expected.current !== undefined && meta.sessionName !== expected.current) {
        update(row.key, { status: 'otherSession' });
        continue;
      }
      if (known.some(s => sameSave(s, meta))) {
        update(row.key, { status: 'duplicate' });
        continue;
      }
      update(row.key, { status: 'uploading' });
      try {
        const summary = await uploadSnapshot(ctx.worldId, snapshot, ctx.queryClient);
        known = [...known, summary];
        expected.current ??= meta.sessionName;
        update(row.key, { status: 'added' });
      } catch (err) {
        const status = uploadStatus(err);
        update(row.key, { status });
        if (status === 'limit' || status === 'rateLimited') break;
      }
    }
    const left = new Set(queue.map(r => r.key));
    setRows(list => list.map(r => (left.has(r.key) && (r.status === 'queued' || r.status === 'parsing') ? { ...r, status: 'cancelled' } : r)));
    if (abort.current === ac) abort.current = null;
    setCurrent(null);
  }

  function pick(files: FileList | null) {
    if (!files || files.length === 0) return;
    const queue = [...files]
      .sort((a, b) => a.lastModified - b.lastModified || a.name.localeCompare(b.name))
      .map((file): OlderSaveRow => ({ key: nextKey.current++, file, status: 'queued' }));
    setRows(queue);
    void run(queue);
  }

  function addAnyway(row: OlderSaveRow) {
    const again: OlderSaveRow = { ...row, status: 'queued', force: true };
    update(row.key, again);
    void run([again]);
  }

  const running = current !== null;
  const added = rows.filter(r => r.status === 'added').length;
  const skipped = rows.filter(r => SKIPPED.has(r.status)).length;

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">{t('import.older.intro')}</p>
      {rows.length === 0 && (
        <div className="flex flex-col gap-2">
          <label htmlFor={inputId} className="text-sm font-medium">{t('import.older.filesLabel')}</label>
          <input
            id={inputId}
            type="file"
            accept=".sav"
            multiple
            onChange={e => pick(e.target.files)}
            className="rounded text-sm focus-ring file:mr-3 file:h-10 file:cursor-pointer file:border file:border-line file:bg-raised file:px-4 file:font-medium file:text-fg hover:file:bg-line"
          />
          <p className="text-sm text-muted">{t('import.older.multiHint')}</p>
        </div>
      )}
      {running && (
        <div className="flex flex-col gap-2">
          <div className="flex justify-between text-sm">
            <span>{t('import.older.progress', { current: current.n, total: current.total })} · {t(`import.stage.${current.stage}`)}</span>
            <span className="font-display tabular-nums">{t('import.percent', { percent: current.percent })}</span>
          </div>
          <div
            role="progressbar"
            aria-label={t('import.older.progressLabel')}
            aria-valuetext={t('import.older.progress', { current: current.n, total: current.total })}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={current.percent}
            className="h-2 overflow-hidden rounded bg-line"
          >
            <div className="h-full bg-accent transition-[width]" style={{ width: `${current.percent}%` }} />
          </div>
        </div>
      )}
      {rows.length > 0 && (
        <ul aria-label={t('import.older.listLabel')} className="flex max-h-72 flex-col overflow-y-auto chamfer border border-line">
          {rows.map(r => (
            <li key={r.key} className="flex flex-col gap-1 border-b border-line px-3 py-2 last:border-b-0">
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-medium" title={r.file.name}>{r.file.name}</span>
                <Badge tone={TONES[r.status]}>{t(`import.older.status.${r.status}`)}</Badge>
              </div>
              {r.session !== undefined && r.saveTime !== undefined && (
                <span className="text-sm text-muted">{r.session} · {formatSaveDate(r.saveTime, i18n.language)}</span>
              )}
              <RowNote row={r} expected={expected.current} running={running} onAddAnyway={() => addAnyway(r)} />
            </li>
          ))}
        </ul>
      )}
      {rows.length > 0 && !running && (
        <p role="status" className="font-display text-lg font-semibold">{t('import.older.summary', { added, skipped })}</p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        {running ? (
          <Button onClick={() => abort.current?.abort()}>{t('common.cancel')}</Button>
        ) : (
          <>
            {rows.length === 0 && <Button onClick={onBack}>{t('import.older.back')}</Button>}
            {rows.length > 0 && <Button onClick={() => setRows([])}>{t('import.older.more')}</Button>}
            {rows.length > 0 && <Button variant="primary" onClick={onClose}>{t('import.older.finish')}</Button>}
          </>
        )}
      </div>
    </div>
  );
}

/** Why a file was skipped, where the badge alone does not say it; "Add anyway" for another session. */
function RowNote({ row, expected, running, onAddAnyway }: { row: OlderSaveRow; expected: string | undefined; running: boolean; onAddAnyway(): void }) {
  const { t } = useTranslation();
  if (row.status === 'otherSession') {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm text-muted">{t('import.older.otherSessionNote', { session: row.session ?? '', expected: expected ?? '' })}</span>
        <Button size="sm" disabled={running} onClick={onAddAnyway}>{t('import.older.addAnyway')}</Button>
      </div>
    );
  }
  const note = ({
    noFactory: 'import.older.noFactoryNote',
    limit: 'import.older.limitNote',
    rateLimited: 'import.older.rateLimitedNote',
    tooLarge: 'import.older.tooLargeNote',
  } as Partial<Record<OlderSaveStatus, string>>)[row.status];
  return note ? <span className="text-sm text-muted">{t(note)}</span> : null;
}
