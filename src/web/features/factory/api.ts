import { useQuery, type QueryClient } from '@tanstack/react-query';
import type { ExtractResult } from '../../../shared/extract.js';
import { FACTORY_SNAPSHOT_VERSION, type FactorySnapshot, type SnapshotSummary } from '../../../shared/factory/snapshot.js';
import { MAX_SNAPSHOT_GZIP_BYTES, MAX_SNAPSHOT_JSON_BYTES } from '../../../shared/factory/storage.js';
import { applyDelta, isSnapshotDelta } from '../../../shared/factory/delta.js';
import { api, ApiClientError, apiSend } from '../../app/api.js';
import { queryKeys } from '../../app/queryKeys.js';

/** The factory snapshots of a world on the server (`src/server/http/snapshots.ts`). */
export const snapshotsPath = (worldId: string) => `/api/worlds/${encodeURIComponent(worldId)}/snapshots`;

/** The world's snapshots for the timeline, newest save first. */
export function useSnapshotList(worldId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.snapshots(worldId),
    queryFn: () => api<SnapshotSummary[]>('GET', snapshotsPath(worldId)),
    enabled,
  });
}

function checkVersion(s: FactorySnapshot): FactorySnapshot {
  if (s.v > FACTORY_SNAPSHOT_VERSION) throw new ApiClientError(200, 'invalid_body', `Snapshot version ${s.v} is newer than this app knows`);
  return s;
}

/** The snapshot downloads under way per `world:id`, with the base each builds on (null: downloaded whole). */
const building = new Map<string, number | null>();

/**
 * The snapshot to build `id` on: of those this browser holds or is downloading, the one nearest to it on the timeline
 * (on a tie the older one), never one whose own download waits for `id`. Null without one.
 */
export function deltaBase(qc: QueryClient, worldId: string, id: number): number | null {
  const list = qc.getQueryData<SnapshotSummary[]>(queryKeys.snapshots(worldId));
  if (!list) return null;
  const pos = new Map([...list].sort((a, b) => a.saveTime - b.saveTime || a.id - b.id).map((s, i) => [s.id, i]));
  const at = pos.get(id);
  if (at === undefined) return null;
  /** Whether the download of `b` waits, through its bases, for `id`. */
  const waitsFor = (b: number) => {
    for (let x: number | null | undefined = b, n = 0; x != null && n <= list.length; x = building.get(`${worldId}:${x}`), n++) if (x === id) return true;
    return false;
  };
  let best: number | null = null, bestD = Infinity;
  for (const q of qc.getQueryCache().findAll({ queryKey: ['snapshot', worldId] })) {
    const qid = q.queryKey[2];
    if (typeof qid !== 'number' || qid === id) continue;
    const held = q.state.data !== undefined;
    if (!held && !(q.state.fetchStatus === 'fetching' && building.has(`${worldId}:${qid}`) && !waitsFor(qid))) continue;
    const i = pos.get(qid);
    if (i === undefined) continue;
    const d = Math.abs(i - at) + (i > at ? 0.5 : 0);
    if (d < bestD) { best = qid; bestD = d; }
  }
  return best;
}

/**
 * Fetches one snapshot; one with a newer format version than this client knows is an error (not drawn). With the
 * query client: when the browser holds (or is downloading) a snapshot near it on the timeline, only the difference is
 * downloaded and applied to that one (`src/shared/factory/delta.ts`), so both share what did not change; when that
 * fails for any reason, the whole snapshot is fetched.
 */
export async function fetchSnapshot(worldId: string, id: number, qc?: QueryClient): Promise<FactorySnapshot> {
  const key = `${worldId}:${id}`;
  const base = qc ? deltaBase(qc, worldId, id) : null;
  building.set(key, base);
  try {
    if (qc && base !== null) {
      try {
        const b = await qc.fetchQuery(snapshotQuery(worldId, base));
        const d = await api<unknown>('GET', `${snapshotsPath(worldId)}/${id}/delta/${base}`);
        if (isSnapshotDelta(d) && d.base === base && d.id === id) return checkVersion(applyDelta(b, d));
      } catch {
        // Base gone, an older server without deltas, a delta that does not fit: the whole snapshot instead.
      }
    }
    return checkVersion(await api<FactorySnapshot>('GET', `${snapshotsPath(worldId)}/${id}`));
  } finally {
    building.delete(key);
  }
}

/**
 * How long downloaded snapshots stay cached after the timeline was last used (a step, the slider, playing), in ms.
 * Then the ones nothing shows are dropped (`evictSnapshots`); while the timeline is in use none is.
 */
export const SNAPSHOT_KEEP_MS = 15_000;

/**
 * The query of one snapshot. Snapshots never change under their id, so they are never refetched; React Query never
 * drops them by itself either (`gcTime`), `useSnapshotRetention` does once the timeline rests.
 */
export function snapshotQuery(worldId: string, id: number) {
  return {
    queryKey: queryKeys.snapshot(worldId, id),
    queryFn: ({ client }: { client: QueryClient }) => fetchSnapshot(worldId, id, client),
    staleTime: Infinity,
    gcTime: Infinity,
  };
}

/** One snapshot (`id` null: none). */
export function useSnapshot(worldId: string, id: number | null) {
  return useQuery({ ...snapshotQuery(worldId, id ?? 0), enabled: id !== null });
}

/** Drops the world's cached snapshots that nothing shows (no observer), except the ids in `keep`. */
export function evictSnapshots(qc: QueryClient, worldId: string, keep: ReadonlySet<number>): void {
  for (const q of qc.getQueryCache().findAll({ queryKey: ['snapshot', worldId], type: 'inactive' })) {
    const id = q.queryKey[2];
    if (typeof id === 'number' && !keep.has(id)) qc.removeQueries({ queryKey: q.queryKey, exact: true });
  }
}

/** The factory snapshot of a parse result; missing from parsers without factory extraction. */
export function factoryOf(r: ExtractResult): FactorySnapshot | undefined {
  return (r as ExtractResult & { factory?: FactorySnapshot }).factory;
}

/** The value as JSON, gzip-compressed with the browser's CompressionStream. 413 when it is over the server's limits. */
export async function gzipJson(value: unknown): Promise<Uint8Array<ArrayBuffer>> {
  const raw = new TextEncoder().encode(JSON.stringify(value));
  if (raw.byteLength > MAX_SNAPSHOT_JSON_BYTES) throw tooLarge();
  const stream = new Response(raw).body!.pipeThrough(new CompressionStream('gzip'));
  const gz = new Uint8Array(await new Response(stream).arrayBuffer());
  if (gz.byteLength > MAX_SNAPSHOT_GZIP_BYTES) throw tooLarge();
  return gz;
}

function tooLarge(): ApiClientError {
  return new ApiClientError(413, 'invalid_body', 'Snapshot too large');
}

/** Keeps the cached list in the server's order (newest save first, then newest id). */
function byNewest(a: SnapshotSummary, b: SnapshotSummary): number {
  return b.saveTime - a.saveTime || b.id - a.id;
}

/**
 * Uploads a snapshot (gzip-compressed). The server replaces a stored snapshot of the same save; the answer replaces
 * it in the cached list too. Throws ApiClientError (413 when too large, 403 for members, 409 `limit_reached`).
 */
export async function uploadSnapshot(worldId: string, snapshot: FactorySnapshot, queryClient?: QueryClient): Promise<SnapshotSummary> {
  const body = await gzipJson(snapshot);
  const summary = await apiSend<SnapshotSummary>('POST', snapshotsPath(worldId), body, {
    'content-type': 'application/json',
    'content-encoding': 'gzip',
  });
  if (queryClient) {
    queryClient.setQueryData<SnapshotSummary[]>(queryKeys.snapshots(worldId), list => list && [
      summary,
      ...list.filter(s => s.id !== summary.id && !(s.sessionName === summary.sessionName && s.saveTime === summary.saveTime)),
    ].sort(byNewest));
    void queryClient.invalidateQueries({ queryKey: queryKeys.snapshots(worldId) });
  }
  return summary;
}

/** Deletes a snapshot (owner and admins). */
export async function deleteSnapshot(worldId: string, id: number, queryClient?: QueryClient): Promise<void> {
  await api<void>('DELETE', `${snapshotsPath(worldId)}/${id}`);
  if (queryClient) {
    queryClient.setQueryData<SnapshotSummary[]>(queryKeys.snapshots(worldId), list => list?.filter(s => s.id !== id));
    queryClient.removeQueries({ queryKey: queryKeys.snapshot(worldId, id) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.snapshots(worldId) });
  }
}
