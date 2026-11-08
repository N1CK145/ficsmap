import { useQuery, type QueryClient } from '@tanstack/react-query';
import type { ExtractResult } from '../../../shared/extract.js';
import { FACTORY_SNAPSHOT_VERSION, type FactorySnapshot, type SnapshotSummary } from '../../../shared/factory/snapshot.js';
import { MAX_SNAPSHOT_GZIP_BYTES, MAX_SNAPSHOT_JSON_BYTES } from '../../../shared/factory/storage.js';
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

/** Fetches one snapshot; one with a newer format version than this client knows is an error (not drawn). */
export async function fetchSnapshot(worldId: string, id: number): Promise<FactorySnapshot> {
  const s = await api<FactorySnapshot>('GET', `${snapshotsPath(worldId)}/${id}`);
  if (s.v > FACTORY_SNAPSHOT_VERSION) throw new ApiClientError(200, 'invalid_body', `Snapshot version ${s.v} is newer than this app knows`);
  return s;
}

/** One snapshot (`id` null: none). Snapshots never change under their id, so they are never refetched. */
export function useSnapshot(worldId: string, id: number | null) {
  return useQuery({
    queryKey: queryKeys.snapshot(worldId, id ?? 0),
    queryFn: () => fetchSnapshot(worldId, id!),
    enabled: id !== null,
    staleTime: Infinity,
  });
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
 * it in the cached list too. Throws ApiClientError (413 when too large, 403 for non-owners, 409 `limit_reached`).
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

/** Deletes a snapshot (owner). */
export async function deleteSnapshot(worldId: string, id: number, queryClient?: QueryClient): Promise<void> {
  await api<void>('DELETE', `${snapshotsPath(worldId)}/${id}`);
  if (queryClient) {
    queryClient.setQueryData<SnapshotSummary[]>(queryKeys.snapshots(worldId), list => list?.filter(s => s.id !== id));
    queryClient.removeQueries({ queryKey: queryKeys.snapshot(worldId, id) });
    void queryClient.invalidateQueries({ queryKey: queryKeys.snapshots(worldId) });
  }
}
