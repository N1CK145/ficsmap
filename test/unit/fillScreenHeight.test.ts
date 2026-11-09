import { describe, expect, it } from 'vitest';
import { fillScreenHeight } from '../../src/web/features/planner/FlowDiagram.js';

describe('fillScreenHeight', () => {
  it('takes the rest of the screen under the box', () => {
    // 1000 px screen, box at 200 px: the rest is 784; the default would be min(400, 700) = 400, 1.5× = 600.
    expect(fillScreenHeight({ viewport: 1000, boxTop: 200, content: 400 })).toBe(784);
  });
  it('is at least 1.5 times the default height', () => {
    // Box far down (rest 284) and a tall diagram: default min(2000, 700) = 700, 1.5× = 1050.
    expect(fillScreenHeight({ viewport: 1000, boxTop: 700, content: 2000 })).toBe(1050);
    // A small diagram: default 300, 1.5× = 450 > rest 284.
    expect(fillScreenHeight({ viewport: 1000, boxTop: 700, content: 300 })).toBe(450);
  });
});
