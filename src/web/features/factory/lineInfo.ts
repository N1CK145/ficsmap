import type { LineEdge, LineGroup, ProductionLine, ShortInput } from '../../../shared/factory/lines.js';
import { prettyClass, type FactoryLabels } from './data.js';
import type { Lang } from './format.js';

export { lineHasIssue, lineLoss, PROBLEMS, sortLines } from '../../../shared/factory/lines.js';

/**
 * One reading of a production line for the Fabrik page and the factory map: its name, the name of its groups, the
 * bottleneck in one sentence and a connection's capacity in words. Pure (labels and `t` come in), so both views say
 * exactly the same; the order (`sortLines`) and the issue rule (`lineHasIssue`, one `PROBLEMS` set) come from
 * `src/shared/factory/lines.ts` and are re-exported here.
 */

type T = (key: string, opts?: Record<string, unknown>) => string;

/** A building class (with a name and picture in the dataset), not a logistics kind. */
export const isClass = (cls: string) => /^(Build|BP)_/.test(cls);

const numbers = new Map<string, { one: Intl.NumberFormat; whole: Intl.NumberFormat }>();
function nf(lang: Lang) {
  let n = numbers.get(lang);
  if (!n) numbers.set(lang, (n = { one: new Intl.NumberFormat(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 }), whole: new Intl.NumberFormat(lang, { maximumFractionDigits: 0 }) }));
  return n;
}
/** "12,5/min" or "120,0 m³/min", as the page's `fmt.rate`. */
const rate = (v: number, fluid: boolean, lang: Lang, t: T) => t(fluid ? 'factory.unit.fluid' : 'factory.unit.solid', { value: nf(lang).one.format(Math.abs(v) < 0.05 ? 0 : v) });
/** A capacity as a whole number where it is one ("120"), else with one decimal. */
export const capacityNumber = (n: number, lang: Lang) => (Math.abs(n - Math.round(n)) < 0.05 ? nf(lang).whole.format(Math.round(n)) : nf(lang).one.format(n));

/** "4× Konstruktor"; a single logistics node just by name ("Fusionator"). Without `t` a logistics kind keeps its class name. */
export function groupTitle(g: Pick<LineGroup, 'cls' | 'kind' | 'logistics' | 'members'>, labels: FactoryLabels, lang: Lang, t?: T): string {
  const own = labels.building(g.cls, lang);
  // A logistics class without a name in the dataset (a lift splitter) is called by its kind ("Splitter").
  const named = isClass(g.cls) && !(g.logistics && own === prettyClass(g.cls));
  const name = named || !t ? own : t(`factory.lines.kind.${g.kind ?? g.cls}`, { defaultValue: own });
  return g.logistics && g.members.length === 1 ? name : `${nf(lang).whole.format(g.members.length)}× ${name}`;
}

/**
 * A line's name, the same on the page and the map: its products ("Draht, Beton +1"); without products (it ends in
 * generators, or makes nothing yet) what its last group should make ("Quarzkristall"), else its machines of the last
 * group's class ("4× Biomasse-Brenner"), else its main input. Never a bare building name.
 */
export function lineName(line: ProductionLine, labels: FactoryLabels | undefined, lang: Lang): string {
  const item = (id: string) => labels?.item(id, lang) ?? id;
  const products = line.products.map(p => item(p.item));
  if (products.length > 0) return products.length > 2 ? `${products.slice(0, 2).join(', ')} +${products.length - 2}` : products.join(', ');
  const machines = line.groups.filter(g => !g.logistics);
  const last = line.groups.find(g => g.members.includes(line.id)) ?? [...machines].sort((a, b) => b.stage - a.stage)[0];
  const made = last?.nominal[0]?.item ?? last?.outputs[0]?.item;
  if (made) return item(made);
  if (last && labels) {
    const count = machines.filter(g => g.cls === last.cls).reduce((n, g) => n + g.members.length, 0);
    return `${nf(lang).whole.format(count)}× ${labels.building(last.cls, lang)}`;
  }
  return line.inputs[0] ? item(line.inputs[0].item) : line.id;
}

/** The next faster belt, lift or pipeline class (Mk.1 → Mk.2), or null at the fastest. */
export function nextTier(cls: string): string | null {
  const belt = /^(Build_Conveyor(?:Belt|Lift)Mk)(\d)(_C)$/.exec(cls);
  if (belt) return Number(belt[2]) < 6 ? `${belt[1]}${Number(belt[2]) + 1}${belt[3]}` : null;
  if (/^Build_Pipeline(_NoIndicator)?_C$/.test(cls)) return 'Build_PipelineMK2_C';
  return null;
}

/** The next miner (Mk.1 → Mk.2), or null. */
const nextMiner = (cls: string | undefined) => {
  const m = cls ? /^Build_MinerMk(\d)_C$/.exec(cls) : null;
  return m && Number(m[1]) < 3 ? `Build_MinerMk${Number(m[1]) + 1}_C` : null;
};

/**
 * What a connection can carry, in words, after its flow: "von 120" for one belt or pipe, "4× Förderband Mk.1 (je 60)"
 * for parallel ones of one capacity (`short`: "4× Mk.1 (je 60)"), else "von 1.320" (several of different capacity,
 * added up). Null without one.
 */
export function capacityText(e: Pick<LineEdge, 'capacity' | 'perLink' | 'links' | 'slowest'>, labels: FactoryLabels, lang: Lang, t: T, short = false): string | null {
  if (e.capacity === undefined) return null;
  if (e.perLink !== undefined && e.links > 1 && e.slowest) {
    // `short` (the diagram's labels, where the item's picture stands before): just the tier ("4× Mk.1 (je 60)").
    const name = labels.building(e.slowest, lang);
    const belt = short ? /Mk\.\d+$/.exec(name)?.[0] ?? name : name;
    return t('factory.lines.capacityEach', { count: e.links, belt, each: capacityNumber(e.perLink, lang) });
  }
  return t('factory.lines.of', { value: capacityNumber(e.capacity, lang) });
}

/** "79,0/min · 4× Förderband Mk.1 (je 60)", "60,0/min von 60": a connection's flow with its capacity. */
export function edgeRateText(e: LineEdge, labels: FactoryLabels, lang: Lang, t: T): string | null {
  if (e.perMin === undefined) return null;
  const fluid = e.pipe ?? (e.item ? labels.isFluid(e.item) : false);
  const flow = rate(e.perMin, fluid, lang, t);
  const cap = capacityText(e, labels, lang, t);
  if (!cap) return flow;
  return e.perLink !== undefined && e.links > 1 ? `${flow} · ${cap}` : `${flow} ${cap}`;
}

function shortText(group: string, s: ShortInput, labels: FactoryLabels, lang: Lang, t: T, makerClass: string | undefined): string {
  const pct = (p: number) => t('factory.unit.pct', { value: nf(lang).whole.format(Math.round(p * 100)) });
  const fluid = s.fluid ?? labels.isFluid(s.item);
  const base = {
    group, item: labels.item(s.item, lang), supply: nf(lang).one.format(s.supply), need: rate(s.need, fluid, lang, t),
  };
  if (s.makers === 0) return t('factory.lines.neck.shortOutside', base);
  const p = s.makersProductivity ?? 0;
  if (p < 0.99) return t('factory.lines.neck.shortMakers', { ...base, pct: pct(p) });
  const miner = nextMiner(makerClass);
  const fix = s.extractors
    ? (miner ? t('factory.lines.neck.fixMiner', { miner: labels.building(miner, lang) }) : t('factory.lines.neck.fixExtractor'))
    : t('factory.lines.neck.fixMakers');
  return t('factory.lines.neck.shortFull', { ...base, pct: pct(p), fix });
}

/**
 * The bottleneck in one sentence, the same on the page and the map (shown after the "Engpass" chip):
 * - a full belt or pipe: "Förderband Mk.1 voll zwischen 16× Schmelzofen und Fusionator (60,0/min von 60) – auf
 *   Förderband Mk.2 aufrüsten";
 * - one carrying next to nothing: "Verbindung prüfen: Förderband Mk.1 zwischen … führt kaum etwas (0,4/min von 60)";
 * - a starved group: "16× Schmelzofen: Mangel an Eisenerz – 360,0 von 480,0/min kommen an, Zulieferer laufen 100 %
 *   (übertakten, Miner Mk.3 oder weitere Vorkommen)";
 * - the end of the line: "8× Konstruktor: Abnehmer brauchen nicht mehr – mehr Abnehmer oder AWESOME-Schredder";
 * - else the group and its reason ("Konstruktor: Kein Strom").
 * Null without a bottleneck.
 */
export function bottleneckText(line: ProductionLine, labels: FactoryLabels, lang: Lang, t: T): string | null {
  const b = line.bottleneck;
  if (!b) return null;
  const groups = new Map(line.groups.map(g => [g.id, g]));
  /** "8× Konstruktor (Kupferblech)": a machine group with what it makes, a logistics node by name. */
  const title = (id: string) => {
    const g = groups.get(id);
    if (!g) return id;
    const made = g.logistics ? undefined : g.outputs[0]?.item ?? g.nominal[0]?.item;
    return made ? `${groupTitle(g, labels, lang, t)} (${labels.item(made, lang)})` : groupTitle(g, labels, lang, t);
  };
  if (b.kind === 'edge') {
    const e = line.edges[b.edge];
    if (!e) return null;
    const fluid = e.pipe ?? (e.item ? labels.isFluid(e.item) : false);
    const belt = e.slowest ? labels.building(e.slowest, lang) : t(fluid ? 'factory.lines.pipe' : 'factory.lines.belt');
    const flow = edgeRateText(e, labels, lang, t) ?? '';
    const parts = { belt, from: title(e.from), to: title(e.to), flow };
    if (b.why === 'connection') return t('factory.lines.neck.connection', parts);
    const next = e.slowest ? nextTier(e.slowest) : null;
    const fix = next ? t('factory.lines.neck.fixTier', { next: labels.building(next, lang) }) : t(fluid ? 'factory.lines.neck.fixPipe' : 'factory.lines.neck.fixBelt');
    return t('factory.lines.neck.capacity', { ...parts, fix });
  }
  const g = groups.get(b.group);
  const group = title(b.group);
  if (b.why === 'demand') return t('factory.lines.neck.demand', { group });
  if (b.why === 'starved' && b.short) {
    const makers = line.groups.filter(x => !x.logistics && x.stage < (g?.stage ?? Infinity) && (x.outputs.some(o => o.item === b.short!.item) || x.nominal.some(o => o.item === b.short!.item)));
    const classes = new Set(makers.map(x => x.cls));
    return shortText(group, b.short, labels, lang, t, classes.size === 1 ? [...classes][0] : undefined);
  }
  return t('factory.lines.neck.group', { group, why: t(`factory.reason.${b.why}`) });
}
