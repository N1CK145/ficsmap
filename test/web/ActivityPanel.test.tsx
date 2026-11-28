import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, within } from '@testing-library/react';
import type { ActivityDto, MeDto, WorldDto } from '../../src/shared/api.js';
import type { WorldCtx } from '../../src/web/app/feature.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { queryKeys } from '../../src/web/app/queryKeys.js';
import { activityFeature } from '../../src/web/features/activity/index.js';
import { ActivityPanel } from '../../src/web/features/activity/ActivityPanel.js';
import { usePresence } from '../../src/web/features/live/presence.js';
import { stubFetch } from './fetchStub.js';

const W = '11111111-1111-4111-8111-111111111111';
const NOW = Date.UTC(2026, 10, 28, 12, 0);
const WORLD: WorldDto = {
  id: W, name: 'Alpha', role: 'owner', rev: 1, datasetVersion: 'v1', owner: { id: 1, displayName: 'Nick' },
  members: ['Nick', 'Anna', 'Ben'].map((displayName, i) => ({ userId: i + 1, displayName, avatarUrl: null, joinedVia: 'invite', joinedAt: 0, role: i === 0 ? 'owner' : 'member' })),
  lastImport: null,
};
const ME = { id: 1, displayName: 'Nick' } as MeDto;
const nick = { id: 1, name: 'Nick' }, anna = { id: 2, name: 'Anna' }, ben = { id: 3, name: 'Ben' };
const entry = (e: Partial<ActivityDto> & Pick<ActivityDto, 'kind'>, i: number): ActivityDto =>
  ({ id: 100 - i, by: anna, target: null, detail: null, count: 1, at: NOW - 5 * 60_000, ...e });
const FEED: ActivityDto[] = ([
  { kind: 'marks', count: 12 },
  { kind: 'import', by: nick, count: 1, at: NOW - 3 * 3_600_000 },
  { kind: 'snapshots', by: nick, count: 3 },
  { kind: 'routes', by: ben },
  { kind: 'rename', by: nick, detail: 'Beta' },
  { kind: 'join', by: ben },
  { kind: 'leave', by: ben },
  { kind: 'remove', by: nick, target: ben },
  { kind: 'role', by: nick, target: anna, detail: 'admin' },
  { kind: 'role', by: nick, target: anna, detail: 'member' },
  { kind: 'role', by: anna, target: anna, detail: 'member' },
  { kind: 'owner', by: nick, target: anna },
  { kind: 'join', by: null },
] as (Partial<ActivityDto> & Pick<ActivityDto, 'kind'>)[]).map(entry);

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.world(W), WORLD);
  client.setQueryData(queryKeys.me(), ME);
  render(<QueryClientProvider client={client}><ActivityPanel worldId={W} /></QueryClientProvider>);
  return client;
}

describe('ActivityPanel', () => {
  beforeAll(() => { initI18n(['en']); });
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); act(() => usePresence.getState().clear()); });

  it('lists what happened, newest first, with how long ago', async () => {
    stubFetch({ [`GET /api/worlds/${W}/activity`]: { body: FEED } });
    renderPanel();
    const list = await screen.findByRole('list', { name: 'Recent changes' });
    expect(within(list).getAllByRole('listitem').map(li => li.querySelector('p')!.textContent)).toEqual([
      'Anna changed 12 checks',
      'Nick imported a save',
      'Nick added 3 saves to the factory plan',
      'Ben edited routes',
      'Nick renamed the world to Beta',
      'Ben joined',
      'Ben left',
      'Nick removed Ben',
      'Nick made Anna an admin',
      'Nick took admin rights from Anna',
      'Anna gave up admin rights',
      'Nick handed the world to Anna',
      'Someone joined',
    ]);
    expect(within(list).getAllByText('5 minutes ago')[0]!.closest('time')).toHaveAttribute('datetime', new Date(NOW - 5 * 60_000).toISOString());
    expect(within(list).getByText('3 hours ago')).toBeInTheDocument();
  });

  it('says who else is here right now', async () => {
    stubFetch({ [`GET /api/worlds/${W}/activity`]: { body: [] } });
    renderPanel();
    expect(await screen.findByText('Nothing has happened yet.')).toBeInTheDocument();
    expect(screen.getByText('Nobody else is here right now.')).toBeInTheDocument();
    act(() => usePresence.getState().set(W, [1, 2, 3]));
    expect(screen.getByText('Here now: Anna, Ben')).toBeInTheDocument();
  });

  it('refetches the feed on the live events that change it', () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const ctx = { worldId: W, queryClient: client } as unknown as WorldCtx;
    for (const type of ['mark', 'marks-bulk', 'import', 'world', 'members', 'routes', 'snapshots'] as const) {
      activityFeature.sseHandlers![type]!({ type } as never, ctx);
    }
    expect(invalidate).toHaveBeenCalledTimes(7);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.activity(W) });
  });
});
