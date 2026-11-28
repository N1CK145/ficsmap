import { describe, expect, it } from 'vitest';
import { rulesBySide, sideOfPort, sortMatch, splitterOutput, splitterSides } from '../../src/shared/factory/splitter.js';

describe('splitter outputs', () => {
  it('maps rule indices to sides and connectors (Output1 ahead, Output2 right, Output3 left)', () => {
    const cls = 'Build_ConveyorAttachmentSplitterSmart_C';
    expect([0, 1, 2].map(i => splitterOutput(cls, i))).toEqual([
      { side: 'center', port: 'Output1' }, { side: 'right', port: 'Output2' }, { side: 'left', port: 'Output3' },
    ]);
    expect(splitterOutput(cls, 3)).toBeUndefined();
    expect(splitterSides(cls)).toEqual(['left', 'center', 'right']);
    expect(sideOfPort(cls, 'Output3')).toBe('left');
    expect(sideOfPort(cls, 'Input1')).toBeUndefined();
  });

  it('lift splitters: index 0 is the top connection', () => {
    const cls = 'Build_ConveyorAttachmentSplitterSmartLift_C';
    expect(splitterOutput(cls, 0)).toEqual({ side: 'top', port: 'TopConnection' });
    expect(sideOfPort(cls, 'Output1')).toBe('left');
    expect(splitterSides(cls)).toEqual(['left', 'top', 'right']);
  });

  it('groups rules per side in the save order', () => {
    const by = rulesBySide('Build_ConveyorAttachmentSplitterProgrammable_C', [['Desc_Coal_C', 1], ['Desc_AnyUndefined_C', 0], ['Desc_Cement_C', 1], ['Desc_X_C', 9]]);
    expect(Object.fromEntries(by)).toEqual({ right: ['Desc_Coal_C', 'Desc_Cement_C'], center: ['Desc_AnyUndefined_C'] });
  });

  describe('sortMatch: how the rules treat an item on one output', () => {
    const cls = 'Build_ConveyorAttachmentSplitterSmart_C';
    // centre: Iron Plate, right: Any Undefined, left: Overflow
    const sort: [string, number][] = [['Desc_IronPlate_C', 0], ['Desc_AnyUndefined_C', 1], ['Desc_Overflow_C', 2]];
    it('an item named by a rule matches that output only; Any Undefined takes the items no rule names', () => {
      expect(sortMatch(cls, sort, 'Output1', 'Desc_IronPlate_C')).toBe('match');
      expect(sortMatch(cls, sort, 'Output2', 'Desc_IronPlate_C')).toBeNull();
      expect(sortMatch(cls, sort, 'Output1', 'Desc_Coal_C')).toBeNull();
      expect(sortMatch(cls, sort, 'Output2', 'Desc_Coal_C')).toBe('match');
    });
    it('Overflow takes any item, after the matching outputs', () => {
      expect(sortMatch(cls, sort, 'Output3', 'Desc_IronPlate_C')).toBe('overflow');
      expect(sortMatch(cls, sort, 'Output3', 'Desc_Coal_C')).toBe('overflow');
    });
    it('Any takes every item, also one named elsewhere; None and an output without rules take nothing', () => {
      const s: [string, number][] = [['Desc_IronPlate_C', 0], ['Desc_Wildcard_C', 1], ['Desc_None_C', 2]];
      expect(sortMatch(cls, s, 'Output2', 'Desc_IronPlate_C')).toBe('match');
      expect(sortMatch(cls, s, 'Output3', 'Desc_IronPlate_C')).toBeNull();
      expect(sortMatch(cls, [['Desc_Wildcard_C', 0]], 'Output2', 'Desc_IronPlate_C')).toBeNull();
    });
    it('a port that is no output of the splitter is not filtered', () => {
      expect(sortMatch(cls, sort, 'SomethingElse', 'Desc_Coal_C')).toBe('match');
      expect(sortMatch(cls, sort, undefined, 'Desc_Coal_C')).toBe('match');
    });
  });
});
