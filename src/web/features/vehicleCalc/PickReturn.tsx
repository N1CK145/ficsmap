import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router';
import type { WorldCtx } from '../../app/feature.js';
import { useVehicleCalc, vehiclesPath } from './useVehicleCalc.js';

/** The history state of the map entry that "Pick on the map" pushes from the calculator page. */
export const PICK_STATE = { vehiclePick: true } as const;

/**
 * Inside the map: once picking ends with the destination, Esc or Cancel (`returnRequest`), back to the calculator page.
 * When the map's history entry is the one the picker pushed, that is a step back, so after the round trip Back leads
 * where it led before the pick; otherwise (the map was reached another way meanwhile) a new entry.
 */
export function PickReturn({ ctx }: { ctx: WorldCtx }) {
  const request = useVehicleCalc(s => s.returnRequest);
  const navigate = useNavigate();
  const state = useLocation().state as Partial<typeof PICK_STATE> | null;
  const pushedByPicker = state?.vehiclePick === true;
  useEffect(() => {
    if (!request) return;
    useVehicleCalc.getState().clearReturnRequest();
    if (pushedByPicker) void navigate(-1);
    else void navigate(vehiclesPath(ctx.worldId));
  }, [request, pushedByPicker, navigate, ctx.worldId]);
  return null;
}
