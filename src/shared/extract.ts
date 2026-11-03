import type { DatasetIndex } from './dataset.js';

type Prop = { value?: unknown; flags?: number };

/** Structural subset of @etothepii/satisfactory-file-parser's SatisfactorySave; shared code never imports the parser. */
export interface SaveLike {
  header: { sessionName: string; saveDateTime: string; buildVersion: number };
  levels: Record<string, {
    objects: { typePath?: string; instanceName: string; properties?: Record<string, Prop> }[];
    collectables: { pathName: string }[];
    destroyedActorsMap?: Record<string, { pathName: string }[]>;
  }>;
}
export interface SaveMeta { sessionName: string; saveTime: number; build: number }
export interface ExtractResult { meta: SaveMeta; collected: string[]; openedNotLooted: string[]; recognised: number }

const DROP_POD_SUFFIX = '.BP_DropPod_C';
const BOOL_TRUE_FLAG = 0x10;
const TICKS_PER_MS = 10_000n;
const UNIX_EPOCH_MS_SINCE_YEAR_1 = 62_135_596_800_000n;

export function shortName(pathName: string): string {
  return pathName.slice(pathName.lastIndexOf('.') + 1);
}

/** UE 5.4+ stores bool true as tag flag 0x10; the parser then reports value false. */
export function readBool(p: Prop | undefined): boolean {
  return p?.value === true || ((p?.flags ?? 0) & BOOL_TRUE_FLAG) !== 0;
}

/** .NET ticks (100 ns since 0001-01-01) to unix ms. Not applied to the parser's header, which is already unix ms. */
export function saveTimeFromTicks(ticks: string): number {
  return Number(BigInt(ticks) / TICKS_PER_MS - UNIX_EPOCH_MS_SINCE_YEAR_1);
}

export function extractCollected(save: SaveLike, index: Pick<DatasetIndex, 'resolve'>): ExtractResult {
  const candidates = new Set<string>();
  const openedNotLooted = new Set<string>();
  for (const level of Object.values(save.levels)) {
    for (const c of level.collectables) candidates.add(shortName(c.pathName));
    for (const list of Object.values(level.destroyedActorsMap ?? {})) {
      for (const a of list) candidates.add(shortName(a.pathName));
    }
    for (const o of level.objects) {
      if (!o.typePath?.endsWith(DROP_POD_SUFFIX)) continue;
      const name = shortName(o.instanceName);
      if (readBool(o.properties?.mHasBeenLooted)) candidates.add(name);
      else if (readBool(o.properties?.mHasBeenOpened)) openedNotLooted.add(name);
    }
  }
  const resolved = new Set<string>();
  for (const c of candidates) {
    const r = index.resolve(c);
    if (r !== undefined) resolved.add(r);
  }
  const collected = [...resolved].sort();
  return {
    meta: {
      sessionName: save.header.sessionName,
      saveTime: Number(save.header.saveDateTime), // parser 4.1.2 already converts ticks to unix ms
      build: save.header.buildVersion,
    },
    collected,
    openedNotLooted: [...openedNotLooted].sort(),
    recognised: collected.length,
  };
}
