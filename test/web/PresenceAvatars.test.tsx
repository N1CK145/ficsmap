import { act, render, screen } from '@testing-library/react';
import type { MeDto, WorldDto } from '../../src/shared/api.js';
import type { WorldCtx } from '../../src/web/app/feature.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { liveFeature } from '../../src/web/features/live/index.js';
import { PresenceAvatars } from '../../src/web/features/live/PresenceAvatars.js';
import { usePresence } from '../../src/web/features/live/presence.js';

const W = '11111111-1111-4111-8111-111111111111';
const names = ['Nick', 'Anna', 'Ben', 'Cleo', 'Dana', 'Emil'];
const WORLD: WorldDto = {
  id: W, name: 'Alpha', role: 'owner', rev: 1, datasetVersion: 'v1', owner: { id: 1, displayName: 'Nick' },
  members: names.map((displayName, i) => ({
    userId: i + 1, displayName, avatarUrl: i === 1 ? 'https://cdn.test/a.png' : null, joinedVia: 'invite', joinedAt: i, role: i === 0 ? 'owner' : 'member',
  })),
  lastImport: null,
};
const ctx = { worldId: W, world: WORLD, me: { id: 1 } as MeDto } as unknown as WorldCtx;

describe('PresenceAvatars', () => {
  beforeAll(() => { initI18n(['en']); });
  afterEach(() => { act(() => usePresence.getState().clear()); });

  it('takes `presence` events into the store for the world', () => {
    liveFeature.sseHandlers!.presence!({ type: 'presence', userIds: [1, 2] }, ctx);
    expect(usePresence.getState()).toMatchObject({ worldId: W, userIds: [1, 2] });
  });

  it('shows nothing while the user is alone or presence is unknown', () => {
    const { container } = render(<PresenceAvatars ctx={ctx} />);
    expect(container).toBeEmptyDOMElement();
    act(() => usePresence.getState().set(W, [1]));
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the other members who are here, up to three faces and a count of the rest, and names them all', () => {
    render(<PresenceAvatars ctx={ctx} />);
    act(() => usePresence.getState().set(W, [1, 2, 3]));
    expect(screen.getByText('Also here: Anna, Ben')).toBeInTheDocument();
    act(() => usePresence.getState().set(W, [1, 2, 3, 4, 5, 6, 99]));
    // 99 is not (yet) in the member list: left out until the world is refetched.
    const label = 'Also here: Anna, Ben, Cleo, Dana, Emil';
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByTitle(label)).toBeInTheDocument();
    expect(screen.getByText('+2')).toBeInTheDocument();
    expect(document.querySelectorAll('img')).toHaveLength(1);
  });

  it('ignores presence of another world', () => {
    const { container } = render(<PresenceAvatars ctx={ctx} />);
    act(() => usePresence.getState().set('other', [1, 2]));
    expect(container).toBeEmptyDOMElement();
  });
});
