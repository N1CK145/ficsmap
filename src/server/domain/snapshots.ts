import { promisify } from 'node:util';
import { gunzip, gzip } from 'node:zlib';
import { z } from 'zod';
import type { Db } from '../db/db.js';
import { FACTORY_SNAPSHOT_VERSION, type FactorySnapshot, type SnapshotSummary } from '../../shared/factory/snapshot.js';
import {
  MAX_SNAPSHOT_JSON_BYTES, MAX_SNAPSHOTS_PER_WORLD, snapshotFigures, type SnapshotFigures,
} from '../../shared/factory/storage.js';
import { HttpError } from '../errors.js';
import { bumpRev } from './worlds.js';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

// --- Validation ----------------------------------------------------------------------------------
//
// Mirrors `src/shared/factory/snapshot.ts`. Unknown keys are stripped, so the server stores exactly the format the
// map reads; a field added to the format must be added here too. Bounds are generous (a large 1.2 save has ~30,000
// objects); the 32 MB limit on the decompressed body is the real cap. Numbers are finite (zod 4 rejects Infinity).

const Str = (max: number) => z.string().max(max);
const Cls = z.string().min(1).max(128);
const Id = z.string().min(1).max(256);
const Num = z.number();
const Count = z.number().int().min(0);
const Flat = (max: number) => z.array(Num).max(max);
/** Items per class in an inventory (stations, vehicles). */
const Cargo = z.array(z.object({ item: Cls, count: Count })).max(64);

const Production = z.object({
  recipe: Cls.optional(),
  clock: z.number().min(0).max(10),
  productivity: z.number().min(0).max(10).optional(),
  windowSec: z.number().min(0).optional(),
  producing: z.boolean().optional(),
  paused: z.boolean().optional(),
  powerShards: Count.max(100).optional(),
  somersloops: Count.max(100).optional(),
  issues: z.array(z.enum(['starved', 'blocked', 'noFuel', 'noPower', 'noRecipe'])).max(5).optional(),
});

const Building = z.object({
  id: Id,
  cls: Cls,
  x: Num, y: Num, z: Num,
  yaw: Num,
  swatch: Num.optional(),
  prod: Production.optional(),
  texts: z.array(Str(1024)).max(32).optional(),
  height: Num.optional(),
  node: Id.optional(),
});

const Station = z.object({
  id: Id,
  cls: Cls,
  name: Str(256).optional(),
  x: Num, y: Num, z: Num, yaw: Num,
  nodeGuid: Str(64).optional(),
  loading: z.boolean().optional(),
  traffic: z.array(z.object({
    vehicle: Id,
    avgSecBetweenDocks: Num.optional(),
    avgItemsPerDock: Num.optional(),
    capacityStacks: Num.optional(),
    capacityFluid: Num.optional(),
  })).max(1000),
  cargo: Cargo.optional(),
});

const Vehicle = z.object({
  id: Id,
  cls: Cls,
  name: Str(256).optional(),
  x: Num, y: Num, z: Num, yaw: Num,
  autopilot: z.boolean(),
  fuel: z.object({ item: Cls, amount: Num.optional() }).optional(),
  route: z.array(Id).max(1000),
  cargo: Cargo.optional(),
  slots: Count.max(10_000).optional(),
});

const Marker = z.object({
  name: Str(256),
  x: Num, y: Num, z: Num,
  kind: Str(64),
  iconId: Num,
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  scale: Num,
});

/** A factory snapshot as `POST /api/worlds/:id/snapshots` accepts it (after the version check). */
export const SnapshotSchema = z.object({
  v: z.literal(FACTORY_SNAPSHOT_VERSION),
  meta: z.object({
    sessionName: Str(255),
    saveTime: z.number().min(0),
    build: z.number().min(0),
    playTimeSec: z.number().min(0).optional(),
    gamePhase: Str(128).optional(),
    schematics: Count.optional(),
  }),
  buildings: z.array(Building).max(200_000),
  lightweight: z.array(z.object({ cls: Cls, xyzYaw: Flat(4 * 500_000) })).max(5_000),
  splines: z.array(z.object({ id: Id, cls: Cls, pts: Flat(3 * 20_000) })).max(200_000),
  powerLines: Flat(6 * 200_000),
  pathNetworks: z.array(z.object({ id: Num, nodes: Count, segments: z.array(Id).max(100_000) })).max(1_000),
  stations: z.array(Station).max(10_000),
  vehicles: z.array(Vehicle).max(10_000),
  markers: z.array(Marker).max(10_000),
  crates: z.array(z.object({ x: Num, y: Num, z: Num, kind: Str(128) })).max(10_000),
  fog: z.string().max(8 * 2 ** 20).regex(/^[A-Za-z0-9+/]*={0,2}$/).optional(),
});

// Compile-time check that what the schema lets through is a FactorySnapshot.
const _schemaFitsFormat: (s: z.infer<typeof SnapshotSchema>) => FactorySnapshot = s => s;
void _schemaFitsFormat;

/**
 * The snapshot in a request body, or a 400: a newer `v` than this server knows is refused with its own message (the
 * client is newer than the server), anything else that does not fit the format is `invalid_body`.
 */
export function parseSnapshot(body: unknown): FactorySnapshot {
  const v = (body as { v?: unknown } | null)?.v;
  if (typeof v === 'number' && v > FACTORY_SNAPSHOT_VERSION) {
    throw new HttpError(400, 'invalid_body', `Snapshot version ${v} is newer than this server supports (${FACTORY_SNAPSHOT_VERSION})`);
  }
  return SnapshotSchema.parse(body);
}

/** Decompresses an upload with the output capped (gzip bombs): 413 when larger, 400 when not gzip or not JSON. */
export async function decodeUpload(gz: Buffer): Promise<unknown> {
  let raw: Buffer;
  try {
    raw = await gunzipAsync(gz, { maxOutputLength: MAX_SNAPSHOT_JSON_BYTES });
  } catch (err) {
    if ((err as { code?: string }).code === 'ERR_BUFFER_TOO_LARGE') throw new HttpError(413, 'invalid_body', 'Snapshot too large');
    throw new HttpError(400, 'invalid_body', 'Body is not gzip');
  }
  try {
    return JSON.parse(raw.toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid_body', 'Body is not JSON');
  }
}

/** The stored form: the validated snapshot as JSON, gzip-compressed. */
export async function encodeSnapshot(s: FactorySnapshot): Promise<Buffer> {
  return gzipAsync(Buffer.from(JSON.stringify(s), 'utf8'));
}

/** A stored snapshot as JSON (for clients that do not accept gzip). */
export async function decodeStored(gz: Buffer): Promise<Buffer> {
  return gunzipAsync(gz);
}

// --- Storage -------------------------------------------------------------------------------------

interface SnapshotRow {
  id: number;
  session_name: string;
  save_time: number;
  imported_at: number;
  imported_by_name: string | null;
  summary: string;
  bytes: number;
}

function toSummary(r: SnapshotRow): SnapshotSummary {
  const f = JSON.parse(r.summary) as SnapshotFigures;
  return {
    id: r.id,
    saveTime: r.save_time,
    sessionName: r.session_name,
    importedAt: r.imported_at,
    importedBy: r.imported_by_name ?? '',
    buildings: f.buildings,
    machines: f.machines,
    avgProductivity: f.avgProductivity,
    idle: f.idle,
    bytes: r.bytes,
  };
}

const SELECT = `SELECT s.id, s.session_name, s.save_time, s.imported_at, u.display_name AS imported_by_name, s.summary, s.bytes
  FROM factory_snapshots s LEFT JOIN users u ON u.id = s.imported_by`;

/**
 * Stores a snapshot (`gz`: its encoded form). The same save (session name and save time) replaces the stored row
 * under a new id, since ids are cached as immutable. 409 `limit_reached` when the world already holds
 * MAX_SNAPSHOTS_PER_WORLD other snapshots. Bumps the world's rev.
 */
export function storeSnapshot(
  db: Db, worldId: string, s: FactorySnapshot, gz: Buffer, userId: number, now: number,
): { summary: SnapshotSummary; replaced: boolean; rev: number } {
  const saveTime = Math.trunc(s.meta.saveTime);
  const figures = snapshotFigures(s);
  return db.transaction(() => {
    const removed = db.prepare('DELETE FROM factory_snapshots WHERE world_id = ? AND session_name = ? AND save_time = ?')
      .run(worldId, s.meta.sessionName, saveTime).changes;
    const { n } = db.prepare('SELECT count(*) AS n FROM factory_snapshots WHERE world_id = ?').get(worldId) as { n: number };
    if (n >= MAX_SNAPSHOTS_PER_WORLD) {
      throw new HttpError(409, 'limit_reached', `A world holds at most ${MAX_SNAPSHOTS_PER_WORLD} factory snapshots`);
    }
    const id = Number(db.prepare(
      `INSERT INTO factory_snapshots(world_id, session_name, save_time, imported_at, imported_by, data, summary, bytes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(worldId, s.meta.sessionName, saveTime, now, userId, gz, JSON.stringify(figures), gz.length).lastInsertRowid);
    const rev = bumpRev(db, worldId);
    const row = db.prepare(`${SELECT} WHERE s.id = ?`).get(id) as SnapshotRow;
    return { summary: toSummary(row), replaced: removed > 0, rev };
  })();
}

/** The world's snapshots for the timeline, newest save first. */
export function listSnapshots(db: Db, worldId: string): SnapshotSummary[] {
  const rows = db.prepare(`${SELECT} WHERE s.world_id = ? ORDER BY s.save_time DESC, s.id DESC`).all(worldId) as SnapshotRow[];
  return rows.map(toSummary);
}

/** The stored gzip of one snapshot of this world, or undefined. */
export function snapshotData(db: Db, worldId: string, id: number): Buffer | undefined {
  const r = db.prepare('SELECT data FROM factory_snapshots WHERE world_id = ? AND id = ?').get(worldId, id) as { data: Buffer } | undefined;
  return r?.data;
}

/** Deletes one snapshot of this world (404 when it has none with this id); bumps the world's rev. */
export function deleteSnapshot(db: Db, worldId: string, id: number): { rev: number } {
  return db.transaction(() => {
    const { changes } = db.prepare('DELETE FROM factory_snapshots WHERE world_id = ? AND id = ?').run(worldId, id);
    if (changes === 0) throw new HttpError(404, 'not_found', 'Not found');
    return { rev: bumpRev(db, worldId) };
  })();
}
