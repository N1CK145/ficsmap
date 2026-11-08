import { gunzipSync } from 'node:zlib';
import { QueryClient } from '@tanstack/react-query';
import type { SnapshotSummary } from '../../src/shared/factory/snapshot.js';
import { MAX_SNAPSHOT_JSON_BYTES } from '../../src/shared/factory/storage.js';
import { ApiClientError } from '../../src/web/app/api.js';
import type { WorldCtx } from '../../src/web/app/feature.js';
import { queryKeys } from '../../src/web/app/queryKeys.js';
import { deleteSnapshot, fetchSnapshot, gzipJson, uploadSnapshot } from '../../src/web/features/factory/api.js';
import { factoryFeature } from '../../src/web/features/factory/index.js';
import { makeSnapshot, makeSummary } from './factoryFixtures.js';
import { stubFetch } from './fetchStub.js';

const W = '6f1c2b0e-8a43-4f5e-9d1b-2c3d4e5f6a7b';

describe('factory snapshot api', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('gzipJson compresses JSON the server can decompress', async () => {
    const gz = await gzipJson(makeSnapshot());
    expect(JSON.parse(gunzipSync(gz).toString('utf8'))).toEqual(makeSnapshot());
  });

  it('gzipJson refuses JSON over the decompressed limit before sending anything (413)', async () => {
    await expect(gzipJson('x'.repeat(MAX_SNAPSHOT_JSON_BYTES))).rejects.toMatchObject({ status: 413, code: 'invalid_body' });
  });

  it('uploadSnapshot posts gzip JSON with the CSRF content type and puts the answer into the cached list', async () => {
    const reply = makeSummary(7, 2_000);
    const { fn } = stubFetch({ [`POST /api/worlds/${W}/snapshots`]: { status: 201, body: reply } });
    const client = new QueryClient();
    client.setQueryData(queryKeys.snapshots(W), [makeSummary(3, 1_000), makeSummary(5, 2_000)]);
    const out = await uploadSnapshot(W, makeSnapshot('Letz Fetz', 2_000), client);
    expect(out).toEqual(reply);
    const [, init] = fn.mock.calls[0]!;
    expect(init?.method).toBe('POST');
    expect(init?.headers).toMatchObject({ 'content-type': 'application/json', 'content-encoding': 'gzip' });
    expect(JSON.parse(gunzipSync(init?.body as Uint8Array).toString('utf8'))).toEqual(makeSnapshot('Letz Fetz', 2_000));
    // The re-imported save (id 5) is replaced by the answer, newest first.
    expect(client.getQueryData<SnapshotSummary[]>(queryKeys.snapshots(W))?.map(s => s.id)).toEqual([7, 3]);
  });

  it('uploadSnapshot passes server errors on', async () => {
    stubFetch({ [`POST /api/worlds/${W}/snapshots`]: { status: 409, body: { error: 'limit_reached', message: 'full' } } });
    const err = await uploadSnapshot(W, makeSnapshot()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiClientError);
    expect(err).toMatchObject({ status: 409, code: 'limit_reached' });
  });

  it('fetchSnapshot refuses a snapshot of a newer format version', async () => {
    stubFetch({
      [`GET /api/worlds/${W}/snapshots/1`]: { body: makeSnapshot() },
      [`GET /api/worlds/${W}/snapshots/2`]: { body: { ...makeSnapshot(), v: 2 } },
    });
    await expect(fetchSnapshot(W, 1)).resolves.toEqual(makeSnapshot());
    await expect(fetchSnapshot(W, 2)).rejects.toThrow(/newer/);
  });

  it('deleteSnapshot removes it from the cache', async () => {
    stubFetch({ [`DELETE /api/worlds/${W}/snapshots/3`]: { status: 204 } });
    const client = new QueryClient();
    client.setQueryData(queryKeys.snapshots(W), [makeSummary(3, 1_000), makeSummary(5, 2_000)]);
    await deleteSnapshot(W, 3, client);
    expect(client.getQueryData<SnapshotSummary[]>(queryKeys.snapshots(W))?.map(s => s.id)).toEqual([5]);
  });

  it('the snapshots event invalidates the list', () => {
    const client = new QueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    factoryFeature.sseHandlers!.snapshots!({ type: 'snapshots', rev: 4 }, { worldId: W, queryClient: client } as WorldCtx);
    expect(spy).toHaveBeenCalledWith({ queryKey: queryKeys.snapshots(W) });
  });
});
