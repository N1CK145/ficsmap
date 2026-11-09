import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { buildApp, type AppDeps } from '../../src/server/app.js';
import { openDb, type Db } from '../../src/server/db/db.js';
import type { Config } from '../../src/server/config.js';
import type { DiscordClient } from '../../src/server/auth/discord.js';
import { buildDataset, loadExtractorDir } from '../../scripts/build-dataset.js';
import { indexDataset, type DatasetIndex } from '../../src/shared/dataset.js';

let cached: DatasetIndex | undefined;
function miniDataset(): DatasetIndex {
  cached ??= indexDataset(
    buildDataset(loadExtractorDir(fileURLToPath(new URL('../fixtures/extractor-mini', import.meta.url)))),
  );
  return cached;
}

export const testConfig: Config = {
  publicUrl: 'https://ficsmap.test',
  port: 0,
  discordClientId: 'client-id',
  discordClientSecret: 'client-secret',
  ownerDiscordIds: new Set(['owner-1']),
  sessionSecret: 's'.repeat(32),
  trustProxy: false,
  dbPath: ':memory:',
  datasetDir: './data',
  datasetVersion: 'test',
  webDir: './dist/web',
  logLevel: 'silent',
  cookieSecure: false,
};

export const fakeDiscord: DiscordClient = {
  authorizeUrl: (state, challenge) =>
    `https://discord.test/authorize?state=${encodeURIComponent(state)}&code_challenge=${encodeURIComponent(challenge)}`,
  exchangeCode: async code => ({
    id: code,
    username: `user-${code}`,
    globalName: null,
    avatar: null,
    email: `${code}@example.test`,
    verified: true,
  }),
};

export async function makeTestApp(over: Partial<AppDeps> = {}): Promise<{
  app: FastifyInstance;
  deps: AppDeps;
  /** Runs the real login + callback flow; returns `sid=<value>` for a `cookie` header. */
  login(discordId: string): Promise<string>;
  /** Creates a user + discord identity directly (for non-owners); returns the user id. */
  createUser(discordId: string): number;
}> {
  const deps: AppDeps = {
    config: testConfig,
    db: openDb(':memory:'),
    dataset: miniDataset(),
    discord: fakeDiscord,
    ...over,
  };
  const app = await buildApp(deps);
  return {
    app,
    deps,
    createUser: discordId => createUserForTest(deps.db, discordId),
    async login(discordId) {
      const start = await app.inject('/auth/login');
      const state = new URL(start.headers.location as string).searchParams.get('state')!;
      const tx = rawCookie(start, 'oauth_tx');
      const res = await app.inject({
        url: `/auth/discord/callback?code=${encodeURIComponent(discordId)}&state=${encodeURIComponent(state)}`,
        headers: { cookie: `oauth_tx=${tx}` },
      });
      const sid = res.cookies.find(c => c.name === 'sid');
      if (!sid) throw new Error(`login(${discordId}) failed: ${res.headers.location}`);
      return `sid=${sid.value}`;
    },
  };
}

/** Raw (still percent-encoded) value of a Set-Cookie header, as a browser would send it back. */
export function rawCookie(res: { headers: Record<string, unknown> }, name: string): string {
  const raw = ([] as string[]).concat(res.headers['set-cookie'] as string | string[] ?? []);
  const line = raw.find(l => l.startsWith(`${name}=`));
  if (!line) throw new Error(`no ${name} cookie`);
  return line.slice(name.length + 1).split(';')[0]!;
}

export function createUserForTest(db: Db, discordId: string): number {
  const id = Number(db.prepare(
    "INSERT INTO users(display_name, email, email_verified, created_at, last_login_at) VALUES (?, ?, 1, 0, 0)",
  ).run(`user-${discordId}`, `${discordId}@example.test`).lastInsertRowid);
  db.prepare(
    "INSERT INTO identities(user_id, provider, subject, username, created_at, last_login_at) VALUES (?, 'discord', ?, ?, 0, 0)",
  ).run(id, discordId, `user-${discordId}`);
  return id;
}

export function addMember(db: Db, worldId: string, userId: number, joinedVia = 'invite'): void {
  db.prepare('INSERT INTO world_members(world_id, user_id, joined_at, joined_via) VALUES (?, ?, 0, ?)')
    .run(worldId, userId, joinedVia);
}
