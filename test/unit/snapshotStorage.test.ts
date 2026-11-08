import { sameSave, snapshotFigures } from '../../src/shared/factory/storage.js';
import type { SnapshotBuilding } from '../../src/shared/factory/snapshot.js';

const b = (prod?: SnapshotBuilding['prod']): SnapshotBuilding => ({ id: 'a', cls: 'Build_X_C', x: 0, y: 0, z: 0, yaw: 0, ...(prod ? { prod } : {}) });

describe('snapshotFigures', () => {
  it('counts buildings, machines (with prod), the mean productivity of those measured and the idle ones (< 1 %)', () => {
    const f = snapshotFigures({
      buildings: [b(), b({ clock: 1, productivity: 1 }), b({ clock: 1, productivity: 0.005 }), b({ clock: 1, productivity: 0.01 }), b({ clock: 1 })],
    });
    expect(f).toMatchObject({ buildings: 5, machines: 4, idle: 1 });
    expect(f.avgProductivity).toBeCloseTo((1 + 0.005 + 0.01) / 3);
  });

  it('has no mean without measured machines, and clamps values outside 0..1', () => {
    expect(snapshotFigures({ buildings: [b(), b({ clock: 1 })] })).toEqual({ buildings: 2, machines: 1, avgProductivity: null, idle: 0 });
    expect(snapshotFigures({ buildings: [b({ clock: 1, productivity: 1.2 })] }).avgProductivity).toBe(1);
    expect(snapshotFigures({ buildings: [] })).toEqual({ buildings: 0, machines: 0, avgProductivity: null, idle: 0 });
  });
});

describe('sameSave', () => {
  it('compares session name and save time (whole ms)', () => {
    expect(sameSave({ sessionName: 'A', saveTime: 1000.4 }, { sessionName: 'A', saveTime: 1000 })).toBe(true);
    expect(sameSave({ sessionName: 'A', saveTime: 1000 }, { sessionName: 'B', saveTime: 1000 })).toBe(false);
    expect(sameSave({ sessionName: 'A', saveTime: 1000 }, { sessionName: 'A', saveTime: 1001 })).toBe(false);
  });
});
