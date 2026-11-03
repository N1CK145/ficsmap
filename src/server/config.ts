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

function findDatasetVersion(dir: string): string {
  const found = existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter(e => e.isDirectory() && existsSync(join(dir, e.name, 'collectibles.min.json')))
        .map(e => e.name)
    : [];
  if (found.length !== 1) {
    throw new Error(
      `DATASET_VERSION is not set and ${dir} contains ${found.length} dataset directories (need exactly 1)`,
    );
  }
  return found[0]!;
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
    datasetVersion: e.DATASET_VERSION ?? findDatasetVersion(e.DATASET_DIR),
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
