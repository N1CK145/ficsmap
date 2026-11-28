import { create } from 'zustand';
import { parseChoiceKey, choiceKey, PURITY_FACTOR, type Choice, type Purity } from '../../../shared/planner.js';
import { useIsMobile } from '../../app/useMediaQuery.js';

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

/**
 * What the planner computes from: the wanted rates (`rate`), or the most the available nodes allow (`nodes`; the
 * targets' rates are then only their ratio).
 */
export type PlannerMode = 'rate' | 'nodes';

/** A group of available resource nodes as entered: resource and extractor null until picked (extractor null = default). */
export interface PlannerNodeInput { key: number; resource: string | null; purity: Purity; count: string; extractor: string | null }

/** How the steps are shown: a diagram from top to bottom, or a list. */
export type PlannerView = 'diagram' | 'list';

/** What "Start over" clears, and what its Undo puts back (the view and the mode stay). */
export interface PlannerPlan {
  targets: PlannerTarget[];
  /** Per item the chosen recipe, extractor or "external"; missing = default. */
  choices: Record<string, Choice>;
  /** Per item: its step's clock speed and purity. */
  steps: Record<string, PlannerStepInput>;
  settings: PlannerSettingsInput;
  /** The available nodes for the `nodes` mode. */
  nodes: PlannerNodeInput[];
}

export interface PlannerState extends PlannerPlan {
  mode: PlannerMode;
  /** The view the user picked; null until then (`usePlannerView` then picks one by the screen width). */
  view: PlannerView | null;
  setTarget(key: number, patch: Partial<Omit<PlannerTarget, 'key'>>): void;
  addTarget(): void;
  removeTarget(key: number): void;
  setChoice(item: string, choice: Choice | null): void;
  /** Merges into an item's step settings; an empty clock or undefined value goes back to the default. */
  setStep(item: string, patch: PlannerStepInput): void;
  setSettings(patch: Partial<PlannerSettingsInput>): void;
  setView(view: PlannerView): void;
  setMode(mode: PlannerMode): void;
  addNode(): void;
  setNode(key: number, patch: Partial<Omit<PlannerNodeInput, 'key'>>): void;
  removeNode(key: number): void;
  /** Back to an empty plan; the view stays. Returns the plan as it was, for `restore`. */
  reset(): PlannerPlan;
  /** Puts back a plan `reset` returned. */
  restore(plan: PlannerPlan): void;
}

const STORAGE_KEY = 'ficsmap:planner';
const DEFAULT_SETTINGS: PlannerSettingsInput = { miner: null, clock: '100', purity: 'normal' };

interface Persisted extends PlannerPlan { view: PlannerView | null; mode: PlannerMode }

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
    // `viewChoice`, not the older `view`: that one was saved also when nobody had picked a view.
    const view: PlannerView | null = d.viewChoice === 'list' || d.viewChoice === 'diagram' ? d.viewChoice : null;
    const mode: PlannerMode = d.mode === 'nodes' ? 'nodes' : 'rate';
    const nodes = Array.isArray(d.nodes)
      ? (d.nodes as Record<string, unknown>[])
        .filter(n => n && (n.resource === null || isStr(n.resource)) && isPurity(n.purity) && isStr(n.count) && (n.extractor === null || isStr(n.extractor)))
        .map((n, i) => ({ key: i + 1, resource: n.resource as string | null, purity: n.purity as Purity, count: n.count as string, extractor: n.extractor as string | null }))
      : [];
    return { targets, choices, steps, settings, view, mode, nodes };
  } catch {
    return null;
  }
}

function save(s: Persisted): void {
  try {
    const choices = Object.fromEntries(Object.entries(s.choices).map(([k, c]) => [k, choiceKey(c)]));
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      targets: s.targets.map(t => ({ item: t.item, rate: t.rate })), choices, steps: s.steps, settings: s.settings, viewChoice: s.view,
      mode: s.mode, nodes: s.nodes.map(({ key: _, ...n }) => n),
    }));
  } catch {
    // Not remembering is fine.
  }
}

const emptyTarget = (key: number): PlannerTarget => ({ key, item: null, rate: '60' });
const emptyNode = (key: number): PlannerNodeInput => ({ key, resource: null, purity: 'normal', count: '1', extractor: null });

function initial(): Persisted {
  const stored = loadPlanner();
  if (stored && stored.targets.length > 0) return stored;
  return {
    targets: [emptyTarget(1)], choices: stored?.choices ?? {}, steps: stored?.steps ?? {}, settings: stored?.settings ?? { ...DEFAULT_SETTINGS },
    view: stored?.view ?? null, mode: stored?.mode ?? 'rate', nodes: stored?.nodes ?? [],
  };
}

/**
 * The production planner's state: the plan (targets, choices, settings) and the view, remembered on the
 * device, so the planner page finds it again however often it is left.
 */
export const usePlanner = create<PlannerState>()((set, get) => {
  const update = (patch: Partial<Persisted>) => {
    set(patch);
    const { targets, choices, steps, settings, view, mode, nodes } = get();
    save({ targets, choices, steps, settings, view, mode, nodes });
  };
  const nextKey = () => Math.max(0, ...get().targets.map(t => t.key)) + 1;
  const nextNodeKey = () => Math.max(0, ...get().nodes.map(n => n.key)) + 1;
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
    setMode: mode => update({ mode, ...(mode === 'nodes' && get().nodes.length === 0 ? { nodes: [emptyNode(1)] } : {}) }),
    addNode: () => update({ nodes: [...get().nodes, emptyNode(nextNodeKey())] }),
    setNode: (key, patch) => update({ nodes: get().nodes.map(n => (n.key === key ? { ...n, ...patch } : n)) }),
    removeNode: key => update({ nodes: get().nodes.filter(n => n.key !== key) }),
    reset: () => {
      const { targets, choices, steps, settings, nodes } = get();
      update({ targets: [emptyTarget(1)], choices: {}, steps: {}, settings: { ...DEFAULT_SETTINGS }, nodes: get().mode === 'nodes' ? [emptyNode(1)] : [] });
      return { targets, choices, steps, settings, nodes };
    },
    restore: plan => update({ targets: plan.targets, choices: plan.choices, steps: plan.steps, settings: plan.settings, nodes: plan.nodes }),
  };
});

/** The view in effect: the one the user picked, else the list on a phone (below 900 px) and the diagram on wider screens. */
export function usePlannerView(): PlannerView {
  const picked = usePlanner(s => s.view);
  const mobile = useIsMobile();
  return picked ?? (mobile ? 'list' : 'diagram');
}

/** "12,5" or "12.5" -> 12.5; anything else NaN. */
export function parseNumber(text: string): number {
  const t = text.trim().replace(',', '.');
  return t === '' ? Number.NaN : Number(t);
}
