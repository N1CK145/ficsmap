import type { ParsedSave, SaveParser } from '../../src/server/parse/pool.js';
import { SaveParseError } from '../../src/server/parse/pool.js';
import { readSaveHeader } from '../../src/server/parse/header.js';
import type { FactorySnapshot } from '../../src/shared/factory/snapshot.js';

const EPOCH_TICKS = 621_355_968_000_000_000n;

/**
 * The bytes of a save header (header type 0, the oldest layout the parser reads) and nothing else: enough for
 * `readSaveHeader`, not for a real parse. ASCII session names only.
 */
export function fakeSaveBytes(sessionName: string, saveTime: number, build = 517_554): Buffer {
  const parts: Buffer[] = [];
  const int32 = (n: number) => { const b = Buffer.alloc(4); b.writeInt32LE(n); parts.push(b); };
  const str = (s: string) => { int32(s.length + 1); parts.push(Buffer.from(`${s}\0`, 'latin1')); };
  int32(0); // saveHeaderType
  int32(46); // saveVersion (compressed saves)
  int32(build);
  str('Persistent_Level');
  str('');
  str(sessionName);
  int32(3600); // playDurationSeconds
  const ticks = Buffer.alloc(8);
  ticks.writeBigInt64LE(BigInt(saveTime) * 10_000n + EPOCH_TICKS);
  parts.push(ticks);
  parts.push(Buffer.from([0])); // sessionVisibility
  parts.push(Buffer.alloc(64)); // stands in for the body
  return Buffer.concat(parts);
}

export function factoryFor(sessionName: string, saveTime: number): FactorySnapshot {
  return {
    v: 1,
    meta: { sessionName, saveTime, build: 517_554 },
    buildings: [{ id: 'Build_SmelterMk1_C_1', cls: 'Build_SmelterMk1_C', x: 0, y: 0, z: 0, yaw: 0, prod: { clock: 1, productivity: 0.5 } }],
    lightweight: [], splines: [], powerLines: [], pathNetworks: [], stations: [], vehicles: [], markers: [], crates: [],
  };
}

/**
 * A SaveParser for the API tests: reads the header of `fakeSaveBytes` and reports `collected` as found in the save.
 * `fail` makes the next parse reject with that code.
 */
export function fakeParser(collected: string[] = []): SaveParser & { calls: number; fail?: SaveParseError['code'] } {
  const p = {
    calls: 0,
    fail: undefined as SaveParseError['code'] | undefined,
    async parse(buffer: ArrayBuffer): Promise<ParsedSave> {
      p.calls++;
      if (p.fail) {
        const code = p.fail;
        p.fail = undefined;
        throw new SaveParseError(code, `fake ${code}`);
      }
      const h = readSaveHeader(buffer)!;
      return {
        result: {
          meta: { sessionName: h.sessionName, saveTime: h.saveTime, build: h.build },
          collected, openedNotLooted: [], recognised: collected.length,
          resourceNodes: { overrides: [], settings: null, extractors: [] },
          factory: factoryFor(h.sessionName, h.saveTime),
        },
        timing: { parseMs: 1, totalMs: 1 },
      };
    },
    async close() {},
  };
  return p;
}
