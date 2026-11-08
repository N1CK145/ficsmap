import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

export interface Config {
  publicUrl: string;
  port: number;
  discordClientId: string;
  discordClientSecret: string;
  ownerDiscordIds: Set<string>;
  sessionSecret: string;
  inviteJwtSecret: string;
  trustProxy: string | false;
  dbPath: string;
  datasetDir: string;
  datasetVersion: string;
  webDir: string;
  logLevel: string;
  cookieSecure: boolean;
}

const schema = z.object({
  PUBLIC_URL: z.url(),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_CLIENT_SECRET: z.string().min(1),
  OWNER_DISCORD_IDS: z.string().default(''),
  SESSION_SECRET: z.string().min(32),
  INVITE_JWT_SECRET: z.string().min(32),
  TRUST_PROXY: z.string().optional(),
  DB_PATH: z.string().min(1).default('./data-local/app.db'),
  DATASET_DIR: z.string().min(1).default('./data'),
  DATASET_VERSION: z.string().min(1).optional(),
  WEB_DIR: z.string().min(1).default('./dist/web'),
  LOG_LEVEL: z.string().min(1).default('info'),
  COOKIE_SECURE: z.string().optional(),
});

/** Folder names that look like game versions (`1.2.5.0`, `1.2.4.1`): dot-separated numbers. */
const GAME_VERSION = /^\d+(\.\d+)*$/;

/** Compares two game version folder names number by number (`1.2.10.0` > `1.2.9.1`; missing parts count as 0). */
export function compareGameVersions(a: string, b: string): number {
  const x = a.split('.').map(Number);
  const y = b.split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

/** The dataset folders in `dir`: subfolders that hold a `collectibles.min.json`. */
function datasetFolders(dir: string): string[] {
  return existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter(e => e.isDirectory() && existsSync(join(dir, e.name, 'collectibles.min.json')))
        .map(e => e.name)
    : [];
}

/**
 * The dataset version to serve when `DATASET_VERSION` is unset or `latest`: the only folder in `dir`, or, with
 * several, the newest of those named like a game version. Fails when there is none, or several without a version
 * name to choose by.
 */
export function latestDatasetVersion(dir: string): string {
  const found = datasetFolders(dir);
  if (found.length === 1) return found[0]!;
  const versions = found.filter(f => GAME_VERSION.test(f)).sort(compareGameVersions);
  if (versions.length === 0) {
    throw new Error(
      found.length === 0
        ? `No dataset in ${dir}: it needs a folder with collectibles.min.json (set DATASET_DIR or build one)`
        : `DATASET_VERSION=latest cannot choose among ${found.join(', ')} in ${dir}: name the folders like the game version or set DATASET_VERSION`,
    );
  }
  return versions[versions.length - 1]!;
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const e = schema.parse(env);
  return {
    publicUrl: e.PUBLIC_URL,
    port: e.PORT,
    discordClientId: e.DISCORD_CLIENT_ID,
    discordClientSecret: e.DISCORD_CLIENT_SECRET,
    ownerDiscordIds: new Set(e.OWNER_DISCORD_IDS.split(',').map(s => s.trim()).filter(Boolean)),
    sessionSecret: e.SESSION_SECRET,
    inviteJwtSecret: e.INVITE_JWT_SECRET,
    trustProxy: e.TRUST_PROXY ? e.TRUST_PROXY : false,
    dbPath: e.DB_PATH,
    datasetDir: e.DATASET_DIR,
    datasetVersion: !e.DATASET_VERSION || e.DATASET_VERSION === 'latest' ? latestDatasetVersion(e.DATASET_DIR) : e.DATASET_VERSION,
    webDir: e.WEB_DIR,
    logLevel: e.LOG_LEVEL,
    cookieSecure: e.COOKIE_SECURE?.toLowerCase() !== 'false',
  };
}

/** Valid but suspicious settings, logged as warnings at startup. */
export function configWarnings(c: Config): string[] {
  const out: string[] = [];
  if (c.ownerDiscordIds.size === 0) {
    out.push('OWNER_DISCORD_IDS is empty: only existing accounts and invited users can log in');
  }
  return out;
}
