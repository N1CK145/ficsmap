import { COLLECTIBLE_TYPES, classify, typeById } from '../../src/shared/collectibleTypes.js';

test('every type has shape, colour, label and at least one class', () => {
  for (const t of COLLECTIBLE_TYPES) {
    expect(t.shape).toBeTruthy(); expect(t.colorToken).toBeTruthy();
    expect(t.labelKey).toMatch(/^types\./); expect(t.classes.length).toBeGreaterThan(0);
  }
});
test('ids are unique and cover the six in-scope types', () => {
  expect(COLLECTIBLE_TYPES.map(t => t.id).sort()).toEqual(
    ['hard_drive','mercer_sphere','slug_blue','slug_purple','slug_yellow','somersloop']);
});
test('classify uses exact class names from the extractor', () => {
  expect(classify('pickups', 'BP_WAT2_C')).toBe('mercer_sphere');
  expect(classify('dropPods', 'BP_DropPod_C')).toBe('hard_drive');
  expect(classify('pickups', 'BP_Berry_C')).toBeNull();
});
test('slug pips are 1/2/3 and shards come from Task 1', () => {
  expect([typeById('slug_blue').pips, typeById('slug_yellow').pips, typeById('slug_purple').pips]).toEqual([1,2,3]);
  expect([typeById('slug_blue').powerShards, typeById('slug_yellow').powerShards, typeById('slug_purple').powerShards]).toEqual([1,2,5]);
});
