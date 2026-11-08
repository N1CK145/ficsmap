import type { QueryClient } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback } from 'react';
import { create } from 'zustand';
import type { MeDto } from '../../shared/api.js';
import { cleanPrefs, WHEEL_SPEED, type UserPrefs } from '../../shared/prefs.js';
import { api } from './api.js';
import { queryKeys } from './queryKeys.js';

/**
 * The user's preferences (src/shared/prefs.ts) on the client. They live on the account: `GET /api/me` brings them
 * (`useMe` hands them to `receivePrefs`), `PATCH /api/me/prefs` saves a change. This device remembers the last known
 * values, so they apply before the account has loaded (and on the sign-in page).
 *
 * A change applies at once (`local`) and is saved a moment after the last one. Until the server has it, it wins over
 * what `GET /api/me` says; a failed save keeps it and shows a note on the profile page.
 */

/** `pending`: waiting for the next save or being saved. */
export type PrefsSaveStatus = 'idle' | 'pending' | 'saved' | 'failed';

interface PrefsState {
  /** What the server has (from `GET /api/me` or the last save); until then what this device remembered. */
  saved: UserPrefs;
  /** Changes the server does not have yet (waiting, being saved, or a failed save). */
  local: UserPrefs;
  status: PrefsSaveStatus;
}

const STORAGE_KEY = 'ficsmap:prefs';
/** A slider sends a change per pixel; save once it rests. */
export const PREFS_SAVE_DELAY_MS = 600;

function readStored(): UserPrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? {} : cleanPrefs(JSON.parse(raw));
  } catch {
    return {};
  }
}

export const usePrefsStore = create<PrefsState>(() => ({ saved: readStored(), local: {}, status: 'idle' }));

// Remembering is best effort (private mode, quota).
usePrefsStore.subscribe(s => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...s.saved, ...s.local }));
  } catch {
    // Not remembering is fine.
  }
});

let timer: ReturnType<typeof setTimeout> | undefined;
let inFlight: Promise<void> | undefined;
let lastClient: QueryClient | undefined;

/** The preferences from a `GET /api/me`; changes not saved yet stay on top. */
export function receivePrefs(prefs: UserPrefs | undefined): void {
  usePrefsStore.setState({ saved: cleanPrefs(prefs) });
}

/** Applies a change now and saves it to the account after `PREFS_SAVE_DELAY_MS` without further changes. */
export function setPrefs(patch: UserPrefs, queryClient?: QueryClient): void {
  if (queryClient) lastClient = queryClient;
  usePrefsStore.setState(s => ({ local: { ...s.local, ...cleanPrefs(patch) }, status: 'pending' }));
  clearTimeout(timer);
  timer = setTimeout(() => void savePrefs(), PREFS_SAVE_DELAY_MS);
}

/** Saves the unsaved changes now (the profile page's [Retry]); one request at a time. */
export async function savePrefs(): Promise<void> {
  clearTimeout(timer);
  timer = undefined;
  // One request at a time, so an older one cannot land after a newer one.
  while (inFlight) await inFlight;
  const sent = usePrefsStore.getState().local;
  if (Object.keys(sent).length === 0) {
    if (usePrefsStore.getState().status === 'pending') usePrefsStore.setState({ status: 'idle' });
    return;
  }
  usePrefsStore.setState({ status: 'pending' });
  inFlight = (async () => {
    try {
      const saved = cleanPrefs(await api<UserPrefs>('PATCH', '/api/me/prefs', sent));
      usePrefsStore.setState(s => {
        // Changes made while the request was out stay local; the next save takes them.
        const local = Object.fromEntries(Object.entries(s.local).filter(([k, v]) => saved[k as keyof UserPrefs] !== v)) as UserPrefs;
        return { saved, local, status: Object.keys(local).length > 0 ? 'pending' : 'saved' };
      });
      lastClient?.setQueryData<MeDto>(queryKeys.me(), me => me && { ...me, prefs: saved });
    } catch {
      // A newer change is waiting for its own save; otherwise keep the value here and say so.
      usePrefsStore.setState({ status: timer ? 'pending' : 'failed' });
    }
  })();
  try {
    await inFlight;
  } finally {
    inFlight = undefined;
  }
}

/** `setPrefs` bound to the app's query client, so a save also updates the cached `GET /api/me`. */
export function useSetPrefs(): (patch: UserPrefs) => void {
  const queryClient = useQueryClient();
  return useCallback((patch: UserPrefs) => setPrefs(patch, queryClient), [queryClient]);
}

export const usePrefsSaveStatus = (): PrefsSaveStatus => usePrefsStore(s => s.status);

const wheelSpeedOf = (s: PrefsState): number => s.local.wheelSpeed ?? s.saved.wheelSpeed ?? WHEEL_SPEED.default;

/**
 * How far one turn of the mouse wheel zooms, as a factor of the normal speed (1 = normal; 0.25 … 3). For the map
 * and the flow diagrams: scale the zoom step of one wheel event by it. Re-renders when the user changes it.
 */
export const useWheelSpeed = (): number => usePrefsStore(wheelSpeedOf);

/** `useWheelSpeed` outside React (an event handler that is set up once). */
export const getWheelSpeed = (): number => wheelSpeedOf(usePrefsStore.getState());
