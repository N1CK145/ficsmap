import { useDeferredValue, useEffect, useMemo } from 'react';
import { belowScene, filterScene, heightProfile, normalizeRange, rangeFits, type HeightProfile, type HeightRange } from './height.js';
import type { Scene } from './scene.js';
import { useFactoryMap } from './useFactoryMap.js';

export interface HeightView {
  /** The shown scene's heights; null without a scene or buildings. */
  profile: HeightProfile | null;
  /** The world's range as it applies to the shown save (within its span), or null: all heights. */
  range: HeightRange | null;
  /** The scene with only what lies in the range (the scene itself without a range). */
  shown: Scene | null;
  /** With "Darunter blass zeigen": what lies wholly below the range, else null. */
  below: Scene | null;
}

/**
 * A world's height range applied to the shown scene. The remembered range is dropped when the shown save is of
 * another session or its span lies wholly outside the range (stepping the timeline keeps it while it still fits); not
 * while the next save is still loading (`settled` false: the scene shown meanwhile may be another world's).
 * `deferred`: the map follows a dragged slider a little behind, so the slider stays smooth.
 */
export function useHeight(worldId: string, scene: Scene | null, { deferred = false, settled = true } = {}): HeightView {
  const stored = useFactoryMap(s => s.heights[worldId]);
  const belowOn = useFactoryMap(s => s.heightBelow);
  const profile = useMemo(() => (scene ? heightProfile(scene) : null), [scene]);
  const session = scene?.snapshot.meta.sessionName ?? null;
  const valid = !!stored && !!profile && session !== null && stored.session === session && rangeFits(stored, profile);
  const range = useMemo(
    () => (valid && stored && profile ? normalizeRange(stored, profile) : null),
    [valid, stored, profile],
  );
  useEffect(() => {
    if (settled && stored && profile && session !== null && !valid) useFactoryMap.getState().setHeight(worldId, null);
  }, [worldId, stored, profile, session, valid, settled]);
  const applied = useDeferredValue(range);
  const r = deferred ? applied : range;
  const shown = useMemo(() => (scene ? filterScene(scene, r, profile) : null), [scene, r, profile]);
  const below = useMemo(() => (scene && belowOn ? belowScene(scene, r, profile) : null), [scene, r, profile, belowOn]);
  return { profile, range, shown, below };
}
