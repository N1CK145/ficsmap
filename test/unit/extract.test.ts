import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { Parser } from '@etothepii/satisfactory-file-parser';
import { indexDataset, type Dataset } from '../../src/shared/dataset.js';
import { extractCollected, readBool, saveTimeFromTicks, shortName, type SaveLike } from '../../src/shared/extract.js';

const ds: Dataset = {
  version: '1', build: 1, bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 }, mapId: 'm', podRequirementsKnown: true,
  biomes: [{ id: 'a', name: { en: 'A', de: 'A' } }],
  items: [
    ['BP_Crystal_C_1', 'slug_blue', 0, 0, 0, 0, 1],
    ['BP_DropPod_C_A', 'hard_drive', 0, 0, 0, 0, 2],
    ['BP_DropPod_C_B', 'hard_drive', 0, 0, 0, 0, 3],
    ['BP_DropPod_C_C', 'hard_drive', 0, 0, 0, 0, 4],
    ['BP_DropPod_C_D', 'hard_drive', 0, 0, 0, 0, 5],
    ['BP_WAT2_C_1', 'mercer_sphere', 0, 0, 0, 0, 6],
  ],
  aliases: { BP_MercerShrine_C_1: 'BP_WAT2_C_1' },
};
const index = indexDataset(ds);
const P = 'Persistent_Level:PersistentLevel.';
const pod = (name: string, looted: { value?: unknown; flags?: number } | undefined, opened?: { value?: unknown; flags?: number }) => ({
  typePath: '/Game/FactoryGame/Resource/BP_DropPod.BP_DropPod_C',
  instanceName: P + name,
  properties: { ...(looted ? { mHasBeenLooted: looted } : {}), ...(opened ? { mHasBeenOpened: opened } : {}) },
});

function makeSave(): SaveLike {
  return {
    header: { sessionName: 'Sess', saveDateTime: '1793654650577', buildVersion: 123456 },
    levels: {
      Persistent_Level: {
        objects: [
          pod('BP_DropPod_C_B', { value: false, flags: 0x10 }),
          pod('BP_DropPod_C_C', { value: false, flags: 0 }, { value: false, flags: 0x10 }),
          pod('BP_DropPod_C_D', { value: true }),
          { instanceName: P + 'BP_Crystal_C_1', typePath: '/x.BP_Crystal_C', properties: { mHasBeenLooted: { value: true } } },
        ],
        collectables: [{ pathName: P + 'BP_Crystal_C_1' }, { pathName: P + 'BP_MercerShrine_C_1' }, { pathName: P + 'BP_Berry_C_9' }],
        destroyedActorsMap: { x: [{ pathName: P + 'BP_DropPod_C_A' }, { pathName: P + 'BP_Crystal_C_1' }] },
      },
      Other: { objects: [], collectables: [{ pathName: P + 'BP_Crystal_C_1' }] },
    },
  };
}

describe('helpers', () => {
  it('shortName cuts after the last dot', () => {
    expect(shortName('Persistent_Level:PersistentLevel.BP_X_C_1')).toBe('BP_X_C_1');
    expect(shortName('plain')).toBe('plain');
  });
  it('readBool honours the BoolTrue tag flag', () => {
    expect(readBool(undefined)).toBe(false);
    expect(readBool({ value: true })).toBe(true);
    expect(readBool({ value: false, flags: 0x10 })).toBe(true);
    expect(readBool({ value: false, flags: 0 })).toBe(false);
  });
  it('saveTimeFromTicks converts .NET ticks to unix ms', () => {
    const ms = Date.UTC(2026, 10, 2, 22, 24, 10);
    expect(saveTimeFromTicks(String((ms + 62135596800000) * 10000))).toBe(ms);
  });
});

describe('extractCollected', () => {
  const r = extractCollected(makeSave(), index);
  it('collects from collectables, destroyedActorsMap and looted pods, aliases resolved, deduped, sorted', () => {
    expect(r.collected).toEqual(['BP_Crystal_C_1', 'BP_DropPod_C_A', 'BP_DropPod_C_B', 'BP_DropPod_C_D', 'BP_WAT2_C_1']);
    expect(r.recognised).toBe(5);
  });
  it('does not count a pod with flags 0', () => {
    expect(r.collected).not.toContain('BP_DropPod_C_C');
  });
  it('ignores unknown names (berry)', () => {
    expect(r.collected.some(n => n.includes('Berry'))).toBe(false);
  });
  it('lists opened-not-looted pods', () => {
    expect(r.openedNotLooted).toEqual(['BP_DropPod_C_C']);
  });
  it('passes meta through', () => {
    expect(r.meta).toEqual({ sessionName: 'Sess', saveTime: 1793654650577, build: 123456 });
  });
});

// Needs a save file and the built dataset (git-ignored, data/1.2.4.1); skipped without either.
const fixture = existsSync('data/1.2.4.1/collectibles.min.json') ? process.env.FICSMAP_SAVE_FIXTURE : undefined;
describe('real save', () => {
  it.skipIf(!fixture)('extracts 10 hard drives and a plausible save time', () => {
    const buf = readFileSync(fixture!);
    const save = Parser.ParseSave('fixture', buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer);
    const real = indexDataset(JSON.parse(readFileSync('data/1.2.4.1/collectibles.min.json', 'utf8')) as Dataset);
    const r = extractCollected(save as unknown as SaveLike, real);
    const drives = r.collected.filter(n => real.byName.get(n)?.type === 'hard_drive');
    expect(drives).toHaveLength(10);
    expect(Math.abs(r.meta.saveTime - Date.UTC(2026, 10, 2, 22, 24, 10))).toBeLessThan(24 * 3600e3);
  }, 30_000);
});
