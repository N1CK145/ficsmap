import { create } from 'zustand';

/** How long a marker changed by someone else shows its ring (spec §10.5). */
export const PULSE_MS = 1500;

interface RemotePulseState {
  /** actor → unix ms until which its marker pulses. */
  pulse: Map<string, number>;
  start(actor: string): void;
}

/** Actors recently changed by another member. Markers read it; entries remove themselves. */
export const useRemotePulse = create<RemotePulseState>()((set, get) => ({
  pulse: new Map(),
  start: actor => {
    const until = Date.now() + PULSE_MS;
    set(s => ({ pulse: new Map(s.pulse).set(actor, until) }));
    setTimeout(() => {
      // A newer pulse for the same actor keeps its own timer.
      if (get().pulse.get(actor) !== until) return;
      set(s => {
        const pulse = new Map(s.pulse);
        pulse.delete(actor);
        return { pulse };
      });
    }, PULSE_MS);
  },
}));
