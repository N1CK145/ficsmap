import { create } from 'zustand';
import { parseChoiceKey, choiceKey, PURITY_FACTOR, type Choice, type Purity } from '../../../shared/planner.js';

/** One row of the planner's input: an item (null until picked) and the wanted rate as typed. */
export interface PlannerTarget { key: number; item: string | null; rate: string }

export interface PlannerSettingsInput {
  /** Miner extractor id; null = the lowest tier in the data. */
  miner: string | null;
  /** Default extractor clock speed in percent, as typed. */
  clock: string;
  /** Default purity of the nodes. */
  purity: Purity;
}

/** Per step: clock speed in percent as typed, node purity. Missing = the default. */
export interface PlannerStepInput { clock?: string; purity?: Purity }

/** How the steps are shown: a diagram from left to right, or a list. */
export type PlannerView = 'diagram' | 'list';

export interface PlannerState {
  targets: PlannerTarget[];
  /** Per item the chosen recipe, extractor or "external"; missing = default. */
  choices: Record<string, Choice>;
  /** Per item: its step's clock speed and purity. */
  steps: Record<string, PlannerStepInput>;
  settings: PlannerSettingsInput;
  view: PlannerView;
  setTarget(key: number, patch: Partial<Omit<PlannerTarget, 'key'>>): void;
  addTarget(): void;
  removeTarget(key: number): void;
  setChoice(item: string, choice: Choice | null): void;
  /** Merges into an item's step settings; an empty clock or undefined value goes back to the default. */
  setStep(item: string, patch: PlannerStepInput): void;
  setSettings(patch: Partial<PlannerSettingsInput>): void;
  setView(view: PlannerView): void;
  /** Back to an empty plan; the view stays. */
  reset(): void;
}

const STORAGE_KEY = 'ficsmap:planner';
const DEFAULT_SETTINGS: PlannerSettingsInput = { miner: null, clock: '100', purity: 'normal' };

interface Persisted { targets: PlannerTarget[]; choices: Record<string, Choice>; steps: Record<string, PlannerStepInput>; settings: PlannerSettingsInput; view: PlannerView }

const isStr = (v: unknown): v is string => typeof v === 'string';
const isPurity = (v: unknown): v is Purity => isStr(v) && Object.hasOwn(PURITY_FACTOR, v);

/** The remembered plan, keeping only well-formed parts. */
export function loadPlanner(): Persisted | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const d = JSON.parse(raw) as Record<string, unknown>;
    const targets = Array.isArray(d.targets)
      ? (d.targets as Record<string, unknown>[])
        .filter(t => t && (t.item === null || isStr(t.item)) && isStr(t.rate))
        .map((t, i) => ({ key: i + 1, item: t.item as string | null, rate: t.rate as string }))
      : [];
    const choices: Record<string, Choice> = {};
    if (d.choices && typeof d.choices === 'object') {
      for (const [item, c] of Object.entries(d.choices as Record<string, unknown>)) {
        const parsed = isStr(c) ? parseChoiceKey(c) : undefined;
        if (parsed) choices[item] = parsed;
      }
    }
    const steps: Record<string, PlannerStepInput> = {};
    if (d.steps && typeof d.steps === 'object') {
      for (const [item, v] of Object.entries(d.steps as Record<string, Record<string, unknown> | null>)) {
        if (!v || typeof v !== 'object') continue;
        const st: PlannerStepInput = {};
        if (isStr(v.clock)) st.clock = v.clock;
        if (isPurity(v.purity)) st.purity = v.purity;
        if (st.clock !== undefined || st.purity !== undefined) steps[item] = st;
      }
    }
    const s = (d.settings ?? {}) as Record<string, unknown>;
    const settings: PlannerSettingsInput = {
      miner: isStr(s.miner) ? s.miner : null,
      clock: isStr(s.clock) ? s.clock : DEFAULT_SETTINGS.clock,
      purity: isPurity(s.purity) ? s.purity : DEFAULT_SETTINGS.purity,
    };
    const view: PlannerView = d.view === 'list' ? 'list' : 'diagram';
    return { targets, choices, steps, settings, view };
  } catch {
    return null;
  }
}

function save(s: Persisted): void {
  try {
    const choices = Object.fromEntries(Object.entries(s.choices).map(([k, c]) => [k, choiceKey(c)]));
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ targets: s.targets.map(t => ({ item: t.item, rate: t.rate })), choices, steps: s.steps, settings: s.settings, view: s.view }));
  } catch {
    // Not remembering is fine.
  }
}

const emptyTarget = (key: number): PlannerTarget => ({ key, item: null, rate: '60' });

function initial(): Persisted {
  const stored = loadPlanner();
  if (stored && stored.targets.length > 0) return stored;
  return {
    targets: [emptyTarget(1)], choices: stored?.choices ?? {}, steps: stored?.steps ?? {}, settings: stored?.settings ?? { ...DEFAULT_SETTINGS },
    view: stored?.view ?? 'diagram',
  };
}

/**
 * The production planner's state: the plan (targets, choices, settings) and the view, remembered on the
 * device, so the planner page finds it again however often it is left.
 */
export const usePlanner = create<PlannerState>()((set, get) => {
  const update = (patch: Partial<Persisted>) => {
    set(patch);
    const { targets, choices, steps, settings, view } = get();
    save({ targets, choices, steps, settings, view });
  };
  const nextKey = () => Math.max(0, ...get().targets.map(t => t.key)) + 1;
  return {
    ...initial(),
    setTarget: (key, patch) => update({ targets: get().targets.map(t => (t.key === key ? { ...t, ...patch } : t)) }),
    addTarget: () => update({ targets: [...get().targets, emptyTarget(nextKey())] }),
    removeTarget: key => {
      const rest = get().targets.filter(t => t.key !== key);
      update({ targets: rest.length > 0 ? rest : [emptyTarget(nextKey())] });
    },
    setChoice: (item, choice) => {
      const choices = { ...get().choices };
      if (choice) choices[item] = choice;
      else delete choices[item];
      update({ choices });
    },
    setStep: (item, patch) => {
      const merged: PlannerStepInput = { ...get().steps[item], ...patch };
      const st: PlannerStepInput = {};
      if (merged.clock !== undefined && merged.clock.trim() !== '') st.clock = merged.clock;
      if (merged.purity !== undefined) st.purity = merged.purity;
      const steps = { ...get().steps };
      if (st.clock === undefined && st.purity === undefined) delete steps[item];
      else steps[item] = st;
      update({ steps });
    },
    setSettings: patch => update({ settings: { ...get().settings, ...patch } }),
    setView: view => update({ view }),
    reset: () => update({ targets: [emptyTarget(1)], choices: {}, steps: {}, settings: { ...DEFAULT_SETTINGS } }),
  };
});

/** "12,5" or "12.5" -> 12.5; anything else NaN. */
export function parseNumber(text: string): number {
  const t = text.trim().replace(',', '.');
  return t === '' ? Number.NaN : Number(t);
}
