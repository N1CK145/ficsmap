/*
 * Smart and programmable splitters: which output a sort rule's `OutputIndex` means. Checked against the belts of a
 * 1.2 save (build 517554, 287 splitter outputs): `Output1` leaves straight ahead, `Output2` to the right, `Output3` to
 * the left; rule index i sends to `Output{i+1}`. The lift splitters have the top connection as index 0 and their two
 * side outputs (`Output1` left, `Output2` right) as 1 and 2.
 */

export type SplitterSide = 'left' | 'center' | 'right' | 'top';

/** Filter items a sort rule can have instead of a real item. */
export const SORT_FILTERS = ['Desc_Wildcard_C', 'Desc_AnyUndefined_C', 'Desc_Overflow_C', 'Desc_None_C'] as const;

const isLift = (cls: string) => /Lift_C$/.test(cls);

/** The outputs of a splitter class in the order the game's window shows them. */
export function splitterSides(cls: string): SplitterSide[] {
  return isLift(cls) ? ['left', 'top', 'right'] : ['left', 'center', 'right'];
}

/** A rule's output index → its side and the connector name links use (`SnapshotLink.fromPort`). */
export function splitterOutput(cls: string, index: number): { side: SplitterSide; port: string } | undefined {
  const map: [SplitterSide, string][] = isLift(cls)
    ? [['top', 'TopConnection'], ['left', 'Output1'], ['right', 'Output2']]
    : [['center', 'Output1'], ['right', 'Output2'], ['left', 'Output3']];
  const e = map[index];
  return e ? { side: e[0], port: e[1] } : undefined;
}

/** A link's connector name → the splitter side it leaves from. */
export function sideOfPort(cls: string, port: string | undefined): SplitterSide | undefined {
  for (let i = 0; i < 3; i++) {
    const o = splitterOutput(cls, i);
    if (o && o.port === port) return o.side;
  }
  return undefined;
}

/** The rules per side: item classes in the save's order; a side without rules is missing. */
export function rulesBySide(cls: string, sort: readonly (readonly [string, number])[]): Map<SplitterSide, string[]> {
  const out = new Map<SplitterSide, string[]>();
  for (const [item, index] of sort) {
    const o = splitterOutput(cls, index);
    if (!o) continue;
    const list = out.get(o.side) ?? [];
    list.push(item);
    out.set(o.side, list);
  }
  return out;
}
