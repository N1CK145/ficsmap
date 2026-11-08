import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { DatasetIndex } from '../../../shared/dataset.js';
import type { StationFlow } from '../../../shared/factory/analysis.js';
import type { Names } from '../../../shared/recipes.js';
import type { FactoryLabels } from './data.js';

export type Lang = keyof Names;

/**
 * The page's number formats, so every figure reads the same: rates with one decimal and their unit ("12.5/min",
 * "120.0 m³/min"), percentages without decimals, signed deltas, dates and play time.
 */
export function useFactoryFormat() {
  const { t, i18n } = useTranslation();
  const locale = i18n.language;
  return useMemo(() => {
    const one = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const whole = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
    const date = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric' });
    const dateTime = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const dateShort = new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit' });
    const clean = (n: number) => (Math.abs(n) < 0.05 ? 0 : n);
    const sign = (n: number, s: string) => (n > 0 ? `+${s}` : n < 0 ? `−${s.replace(/^[-−]/, '')}` : s);
    return {
      lang: (locale.startsWith('de') ? 'de' : 'en') as Lang,
      /** One decimal. */
      num1: (n: number) => one.format(clean(n)),
      int: (n: number) => whole.format(n),
      /** "12.5" plus the unit key: `/min` or `m³/min`. */
      rate: (n: number, fluid = false) => t(fluid ? 'factory.unit.fluid' : 'factory.unit.solid', { value: one.format(clean(n)) }),
      pct: (p: number) => t('factory.unit.pct', { value: whole.format(Math.round(p * 100)) }),
      /** Signed percentage points ("+3 %", "−12 %"). */
      pctDelta: (d: number) => sign(Math.round(d * 100), t('factory.unit.pct', { value: whole.format(Math.abs(Math.round(d * 100))) })),
      /** Signed percentage points of a mean productivity ("+8 Pkt.", "−3 pts"): a change of a percentage. */
      pointsDelta: (d: number) => sign(Math.round(d * 100), t('factory.unit.points', { value: whole.format(Math.abs(Math.round(d * 100))) })),
      intDelta: (d: number) => sign(d, whole.format(Math.abs(d))),
      rateDelta: (d: number, fluid = false) => sign(Math.round(d * 10), t(fluid ? 'factory.unit.fluid' : 'factory.unit.solid', { value: one.format(Math.abs(clean(d))) })),
      mw: (n: number) => t('factory.unit.mw', { value: whole.format(n) }),
      date: (ms: number) => date.format(ms),
      dateTime: (ms: number) => dateTime.format(ms),
      dateShort: (ms: number) => dateShort.format(ms),
      /** "47 h 12 min" (play time). */
      playTime: (sec: number) => t('factory.unit.playTime', { h: Math.floor(sec / 3600), m: Math.floor((sec % 3600) / 60) }),
      /** "3 min 5 s", "45 s". */
      duration: (sec: number) => {
        const s = Math.round(sec);
        return s >= 60 ? t('factory.unit.minSec', { m: Math.floor(s / 60), s: s % 60 }) : t('factory.unit.sec', { s });
      },
    };
  }, [t, locale]);
}

export type FactoryFormat = ReturnType<typeof useFactoryFormat>;

/** The biome of the collectible nearest to a point: a cheap "where is it" for stations. */
export function nearestBiome(index: DatasetIndex, x: number, y: number, lang: Lang): string | undefined {
  let best = Infinity;
  let biome = -1;
  for (const it of index.items) {
    const d = (it.x - x) ** 2 + (it.y - y) ** 2;
    if (d < best) { best = d; biome = it.biome; }
  }
  return biome < 0 ? undefined : index.ds.biomes[biome]?.name[lang];
}

/**
 * Station names: the player's name, else the building's name with a number per class in the snapshot's order
 * ("Truck Station 3").
 */
export function stationNames(stations: readonly StationFlow[], labels: FactoryLabels, lang: Lang): Map<string, string> {
  const counters = new Map<string, number>();
  const out = new Map<string, string>();
  for (const s of stations) {
    const n = (counters.get(s.cls) ?? 0) + 1;
    counters.set(s.cls, n);
    out.set(s.id, s.name ?? `${labels.building(s.cls, lang)} ${n}`);
  }
  return out;
}

/** Vehicle names: the player's name, else the vehicle's name with a number per class. */
export function vehicleNames(vehicles: readonly { id: string; cls: string; name?: string }[], labels: FactoryLabels, lang: Lang): Map<string, string> {
  const counters = new Map<string, number>();
  const out = new Map<string, string>();
  for (const v of vehicles) {
    const n = (counters.get(v.cls) ?? 0) + 1;
    counters.set(v.cls, n);
    out.set(v.id, v.name ?? `${labels.building(v.cls, lang)} ${n}`);
  }
  return out;
}
