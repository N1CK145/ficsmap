import { describe, expect, it } from 'vitest';
import { rulesBySide, sideOfPort, splitterOutput, splitterSides } from '../../src/shared/factory/splitter.js';

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
});
