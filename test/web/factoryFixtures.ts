import type { FactorySnapshot, SnapshotSummary } from '../../src/shared/factory/snapshot.js';

/** A minimal factory snapshot of one save. */
export function makeSnapshot(sessionName = 'Letz Fetz', saveTime = 1_000): FactorySnapshot {
  return {
    v: 1, meta: { sessionName, saveTime, build: 1 },
    buildings: [{ id: 'b1', cls: 'Build_ConstructorMk1_C', x: 0, y: 0, z: 0, yaw: 0, prod: { clock: 1, productivity: 0.5 } }],
    lightweight: [], splines: [], powerLines: [], pathNetworks: [], stations: [], vehicles: [], markers: [], crates: [],
  };
}

/** A timeline entry as the server lists it. */
export function makeSummary(id: number, saveTime: number, sessionName = 'Letz Fetz'): SnapshotSummary {
  return { id, saveTime, sessionName, importedAt: 0, importedBy: 'Nick', buildings: 1, machines: 1, avgProductivity: 0.5, idle: 0, bytes: 100 };
}
