import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { IconBuildError, iconSummary, selectIcons, writeIcons } from '../../scripts/icons.js';
import { iconSizeFor, itemIconPath, parseItemIconIndex } from '../../src/shared/icons.js';

// The extractor's index.json (`--icons-out`), as written for 1.2.5.0, cut down.
const INDEX = {
  gameVersion: '1.2.5.0',
  format: 'webp',
  sizes: [256, 64],
  icons: {
    Desc_IronPlate_C: { nativeClass: 'FGItemDescriptor', texture: 'FactoryGame/Resource/Parts/IronPlate/UI/IconDesc_IronPlates_256.IconDesc_IronPlates_256' },
    Desc_Water_C: { nativeClass: 'FGResourceDescriptor', texture: 'x' },
    Desc_Truck_C: { nativeClass: 'FGVehicleDescriptor', texture: 'x' },
    BP_EquipmentDescriptorJetPack_C: { nativeClass: 'FGEquipmentDescriptor', texture: 'x' },
    Desc_ConstructorMk1_C: { nativeClass: 'FGBuildingDescriptor', texture: 'x' },
    Desc_Foundation_8x4_01_C: { nativeClass: 'FGBuildingDescriptor', texture: 'x' },
    Desc_Wall_8x4_01_C: { nativeClass: 'FGBuildingDescriptor', texture: 'x' },
  },
  missing: { Desc_PillarTop_C: 'no icon in the Docs (None)' },
};
const MACHINES = new Set(['Desc_ConstructorMk1_C']);

describe('icons dataset part: selection', () => {
  it('keeps every item, resource, equipment and vehicle, and of the buildings only the wiki entries', () => {
    const s = selectIcons(INDEX, MACHINES);
    expect(s.icons).toEqual(['BP_EquipmentDescriptorJetPack_C', 'Desc_ConstructorMk1_C', 'Desc_IronPlate_C', 'Desc_Truck_C', 'Desc_Water_C']);
    expect(s.sizes).toEqual([64, 256]);
    expect(s.skipped).toBe(2);
    expect(s.missing).toEqual([]);
  });

  it('names wiki buildings the extractor has no picture for', () => {
    expect(selectIcons(INDEX, new Set(['Desc_ConstructorMk1_C', 'Desc_NewMachine_C'])).missing).toEqual(['Desc_NewMachine_C']);
  });

  it('fails on a malformed index and on class names that could not be file names', () => {
    const fails = (raw: unknown) => {
      try { selectIcons(raw, MACHINES); } catch (e) { return (e as IconBuildError).problems; }
      throw new Error('did not fail');
    };
    expect(fails({ ...INDEX, format: 'png' })).toEqual(['format is "png", expected "webp"']);
    expect(fails({ ...INDEX, sizes: [] })).toEqual(['bad sizes []']);
    expect(fails({ ...INDEX, icons: {} })).toEqual(['the index lists no icons']);
    expect(fails({ ...INDEX, icons: { '../evil': { nativeClass: 'FGItemDescriptor' }, Desc_X_C: {} } }))
      .toEqual(['bad class name "../evil"', 'Desc_X_C has no nativeClass']);
    expect(fails(null)).toHaveLength(3);
  });
});

describe('icons dataset part: files', () => {
  let src: string;
  let out: string;
  beforeEach(() => {
    const root = mkdtempSync(join(tmpdir(), 'ficsmap-icons-'));
    src = join(root, 'extractor-icons');
    out = join(root, 'dataset');
    for (const size of INDEX.sizes) {
      mkdirSync(join(src, String(size)), { recursive: true });
      for (const cls of Object.keys(INDEX.icons)) writeFileSync(join(src, String(size), `${cls}.webp`), `${cls}@${size}`);
    }
    writeFileSync(join(src, 'index.json'), JSON.stringify(INDEX));
  });
  afterEach(() => rmSync(join(src, '..'), { recursive: true, force: true }));

  it('copies the selected pictures per size and writes the dataset index, replacing an older build', () => {
    mkdirSync(join(out, 'icons', 'items', '64'), { recursive: true });
    writeFileSync(join(out, 'icons', 'items', '64', 'Desc_Stale_C.webp'), 'old');
    writeFileSync(join(out, 'icons', 'hardDrive.png'), 'marker icon of the map part');

    const result = writeIcons(src, out, MACHINES);
    const index = JSON.parse(readFileSync(join(out, 'icons', 'items', 'index.json'), 'utf8'));
    expect(index).toEqual({ format: 1, sizes: [64, 256], icons: result.index.icons });
    expect(index.icons).toHaveLength(5);
    expect(readdirSync(join(out, 'icons', 'items', '64')).sort()).toEqual(index.icons.map((c: string) => `${c}.webp`));
    expect(readFileSync(join(out, itemIconPath('Desc_Truck_C', 256)), 'utf8')).toBe('Desc_Truck_C@256');
    expect(existsSync(join(out, 'icons', 'items', '64', 'Desc_Foundation_8x4_01_C.webp'))).toBe(false);
    // the map part's marker icons next to it stay
    expect(readFileSync(join(out, 'icons', 'hardDrive.png'), 'utf8')).toBe('marker icon of the map part');
    expect(iconSummary(result)).toMatch(/^5 pictures at 64 and 256 px \(0\.0 MB\), 2 other building descriptors left out$/);
  });

  it('fails when a listed picture is missing and leaves the old pictures alone', () => {
    rmSync(join(src, '256', 'Desc_Water_C.webp'));
    mkdirSync(join(out, 'icons', 'items'), { recursive: true });
    writeFileSync(join(out, 'icons', 'items', 'index.json'), 'old');
    expect(() => writeIcons(src, out, MACHINES)).toThrow(/256\/Desc_Water_C\.webp is listed in index\.json but missing/);
    expect(readFileSync(join(out, 'icons', 'items', 'index.json'), 'utf8')).toBe('old');
  });
});

describe('icon index in the browser', () => {
  it('accepts a valid index and drops bad class names and sizes', () => {
    expect(parseItemIconIndex({ format: 1, sizes: [256, 64], icons: ['Desc_IronPlate_C', '../x', 3] }))
      .toEqual({ format: 1, sizes: [64, 256], icons: ['Desc_IronPlate_C'] });
    expect(parseItemIconIndex({ format: 1, sizes: [0, -1, 'x'], icons: [] })).toBeNull();
    expect(parseItemIconIndex({ format: 2, sizes: [64], icons: [] })).toBeNull();
    expect(parseItemIconIndex(null)).toBeNull();
    expect(parseItemIconIndex('<html>')).toBeNull();
  });

  it('picks the smallest size that covers the display size', () => {
    expect(iconSizeFor([64, 256], 20)).toBe(64);
    expect(iconSizeFor([64, 256], 64)).toBe(64);
    expect(iconSizeFor([64, 256], 72)).toBe(256);
    expect(iconSizeFor([64, 256], 512)).toBe(256);
    expect(itemIconPath('Desc_IronPlate_C', 64)).toBe('icons/items/64/Desc_IronPlate_C.webp');
  });
});
