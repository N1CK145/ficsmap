import { useTranslation } from 'react-i18next';
import type { Item } from '../../../shared/dataset.js';
import { useUiStore } from '../../app/store.js';
import { Button } from '../../components/Button.js';
import { useDatasetQuery } from '../map/useDataset.js';
import { isCollected, useMarks } from '../marks/useMarks.js';
import { useMe } from '../worlds/queries.js';
import { useRouteDraft } from './useRoutes.js';

/** [Next stop ›] (spec §10.6): selects the stop and asks the route layer to fly there. */
export function goToStop(actor: string): void {
  useUiStore.getState().select(actor);
  useRouteDraft.getState().flyTo(actor);
}

/**
 * The stop [Next stop ›] goes to: the first unchecked stop after `current` in route order, wrapping
 * to the start; the first unchecked stop when `current` is not on the route. So pressing it again
 * walks on even when the current stop was not checked. `current` itself only when it is the last open one.
 */
export function nextStopName(stops: readonly string[], isDone: (name: string) => boolean, current: string | null): string | undefined {
  const at = current === null ? -1 : stops.indexOf(current);
  for (let i = 1; i <= stops.length; i++) {
    const name = stops[(at + i + stops.length) % stops.length]!;
    if (!isDone(name)) return name;
  }
  return undefined;
}

/** The stop [Next stop ›] goes to now (see `nextStopName`), relative to the selected item. */
export function useNextStop(worldId: string): Item | undefined {
  const index = useDatasetQuery(useMe().data?.datasetVersion).data;
  const marks = useMarks(worldId);
  const stops = useRouteDraft(s => s.draft?.stops);
  const selected = useUiStore(s => s.selectedActor);
  if (!index || !marks || !stops) return undefined;
  const known = stops.filter(name => index.byName.has(name));
  const name = nextStopName(known, n => isCollected(marks, n), selected);
  return name === undefined ? undefined : index.byName.get(name);
}

/** The mobile sheet's sticky, full-width [Next stop ›] while a route is open (spec §10.6). */
export function NextStopButton({ worldId }: { worldId: string }) {
  const { t } = useTranslation();
  const next = useNextStop(worldId);
  return (
    <Button variant="primary" className="w-full" disabled={!next} onClick={() => { if (next) goToStop(next.name); }}>
      {t('routes.next')}
    </Button>
  );
}
