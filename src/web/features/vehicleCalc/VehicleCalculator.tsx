import { useId, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  calculate, DEFAULT_FUEL, defaultSpeed, loadFor, oneWaySeconds, tripsByFuel, vehicleFuels,
  type CalcResult, type FuelInput, type Load, type TransportData, type TransportFuel, type TransportItem, type TransportVehicle, type TripInput,
  type VehicleId,
} from '../../../shared/transport.js';
import { Button } from '../../components/Button.js';
import { FIELD_LABEL, fieldClass, NumberField } from '../../components/Field.js';
import { Fold } from '../../components/Fold.js';
import { IconButton } from '../../components/IconButton.js';
import { CloseIcon } from '../../components/icons.js';
import { StatList, StatRow, StatTile, TileValue } from '../../components/StatRow.js';
import { Window, WINDOW_FRAME } from '../../components/Window.js';
import { GameIcon } from '../machineWiki/icons.js';
import type { CalcForm } from './useVehicleCalc.js';

/** The game's descriptor class of each vehicle, for its picture (dataset part `icons`). */
export const VEHICLE_PICTURES: Record<VehicleId, string> = {
  tractor: 'Desc_Tractor_C',
  truck: 'Desc_Truck_C',
  explorer: 'Desc_Explorer_C',
  fluidTruck: 'Desc_FluidTruck_C',
  drone: 'Desc_DroneTransport_C',
  freightCar: 'Desc_FreightWagon_C',
};

/** "" or a non-number is NaN, so `calculate` rejects it. */
const num = (s: string) => (s.trim() === '' ? Number.NaN : Number(s));
/** One decimal at most, for display and for the defaults put into the inputs. */
const round1 = (n: number) => Math.round(n * 10) / 10;
const kmh = (mps: number) => round1(mps * 3.6);
const atLeastZero = (n: number) => Number.isFinite(n) && n >= 0;

/** A copy of the typed values per vehicle without the one of `id`, so it gets its game value again. */
function without(values: Partial<Record<VehicleId, string>>, id: VehicleId): Partial<Record<VehicleId, string>> {
  const copy = { ...values };
  delete copy[id];
  return copy;
}

export function defaultStop(v: TransportVehicle): string {
  return v.stopSeconds === null ? '' : String(round1(v.stopSeconds));
}

/** The item whose name (current language, or English) matches the typed text, ignoring case. */
export function findItem(items: readonly TransportItem[], text: string, lang: 'en' | 'de'): TransportItem | null {
  const q = text.trim().toLocaleLowerCase();
  if (q === '') return null;
  return items.find(i => i.name[lang].toLocaleLowerCase() === q) ?? items.find(i => i.name.en.toLocaleLowerCase() === q) ?? null;
}

/** The selected fuel, else Packaged Fuel, else the first; null for data without fuels. */
export function findFuel(fuels: readonly TransportFuel[] | undefined, id: string): TransportFuel | null {
  if (!fuels?.length) return null;
  return fuels.find(f => f.id === id) ?? fuels.find(f => f.id === DEFAULT_FUEL) ?? fuels[0]!;
}

/** One vehicle on the route with one fuel (see `fuelRows`). */
export interface FuelRow {
  fuel: TransportFuel;
  roundTripSeconds: number;
  /** Fuel items burnt per round trip. */
  perTrip: number;
  /** Stacks per minute of the vehicle (solid loads only). */
  stacksPerMinute: number | null;
  /** Fuel items per minute of the vehicle (wheeled vehicles; the drone's rows leave it out). */
  perMinute?: number;
}

/**
 * One vehicle on the route with every fuel it takes. The drone flies at the speed the game gives it with each fuel
 * (`tripsByFuel`), fastest first; a wheeled vehicle drives as fast with every fuel (the route as entered), so only its
 * fuel use differs: least used first.
 */
export function fuelRows(vehicle: TransportVehicle, fuels: readonly TransportFuel[], trip: TripInput, load: Load, lang: 'en' | 'de'): FuelRow[] {
  const use = vehicle.fuel ?? null;
  if (use === null) return [];
  if (use.fuels !== null) {
    return tripsByFuel(vehicle, fuels, { routeMeters: trip.routeMeters, stopSeconds: trip.stopSeconds }, load).map(r => ({
      fuel: r.fuel, roundTripSeconds: r.roundTripSeconds, perTrip: r.fuelPerRoundTrip, stacksPerMinute: r.stacksPerMinute,
    }));
  }
  return vehicleFuels(fuels, vehicle)
    .flatMap((fuel): FuelRow[] => {
      const r = calculate(trip, load, { kind: 'rate', vehicles: 1 }, { perMetreMJ: use.perMetreMJ, perTripMJ: use.perTripMJ, energyMJ: fuel.energyMJ });
      if (!r?.fuel) return [];
      return [{ fuel, roundTripSeconds: r.roundTripSeconds, perTrip: r.fuel.perTrip, stacksPerMinute: r.stacksPerVehiclePerMinute, perMinute: r.fuel.perVehiclePerMinute }];
    })
    .sort((a, b) => a.perTrip - b.perTrip || a.fuel.name[lang].localeCompare(b.fuel.name[lang], lang));
}

/** Numbers in the UI language: `digits` decimals at most; fuel amounts below 1 with three significant digits instead. */
function useNumbers() {
  const { i18n } = useTranslation();
  return useMemo(() => {
    const locale = i18n.language;
    const plain = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
    const fuel = new Intl.NumberFormat(locale, { maximumFractionDigits: 2 });
    const small = new Intl.NumberFormat(locale, { maximumSignificantDigits: 3 });
    return {
      n: (v: number) => plain.format(v),
      fuel: (v: number) => (v >= 1 ? fuel.format(v) : small.format(v)),
    };
  }, [i18n.language]);
}

/** A duration: seconds under a minute, else minutes and whole seconds. */
function useDuration() {
  const { t } = useTranslation();
  return (seconds: number) => {
    if (seconds < 60) return t('vehicleCalc.duration.seconds', { s: round1(seconds) });
    const total = Math.round(seconds);
    return t('vehicleCalc.duration.minutes', { m: Math.floor(total / 60), s: total % 60 });
  };
}

/**
 * A numbered step of the form: a window whose title bar carries the step number in the accent before the title, as
 * the game numbers the sections of its terminals ("1. Default").
 */
function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <Window level={3} title={title} icon={<span className="w-3 text-center font-display text-lg leading-none font-bold text-accent tabular-nums">{n}</span>}
      bodyClassName="flex flex-col gap-3 p-3">
      {children}
    </Window>
  );
}

/** A number field (`NumberField`, unit inside) with an optional hint and a [Game value] button while it differs from that. */
function ValueField({ label, value, onChange, unit, hint, reset }: {
  label: string; value: string; onChange(v: string): void; unit: string; hint?: string;
  reset?: { label: string; onReset(): void };
}) {
  return (
    <div className="flex flex-col items-start gap-1">
      <NumberField label={label} unit={unit} hint={hint} min={0} step="any" value={value} onChange={e => onChange(e.target.value)} className="w-full" boxClassName="max-w-48" />
      {reset && <Button size="sm" variant="ghost" className="-ml-3" onClick={reset.onReset}>{reset.label}</Button>}
    </div>
  );
}

/**
 * The vehicle calculator, one flow from top to bottom (on a wide page the result beside it): 1 the route (picked on
 * the map with `picker`, or its length typed), 2 the vehicle (cards with the game's pictures), 3 the fuel, and more
 * settings folded away (item, speed, stop time). The result leads with what one vehicle does on the route: stacks per
 * minute, the round trip and the fuel it burns; under it every fuel compared and "how many vehicles do I need".
 * Pure maths in `shared/transport.ts`.
 */
export function VehicleCalculator({ data, form, onChange, picker }: {
  data: TransportData; form: CalcForm; onChange(patch: Partial<CalcForm>): void;
  /** Step 1, above the route length: picking the route on the map (RoutePicker). */
  picker?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === 'de' ? 'de' : 'en';
  const ids = { fuelSelect: useId(), fuelHint: useId(), item: useId(), items: useId(), itemHint: useId(), radio: useId() };
  const nums = useNumbers();

  const vehicle = data.vehicles.find(v => v.id === form.vehicle) ?? data.vehicles[0];
  const item = findItem(data.items, form.item, lang);
  const sortedItems = useMemo(() => [...data.items].sort((a, b) => a.name[lang].localeCompare(b.name[lang], lang)), [data.items, lang]);
  // The fuels this vehicle takes (none for the freight car; older vehicle data has no fuel use).
  const sortedFuels = useMemo(
    () => (vehicle ? vehicleFuels(data.fuels ?? [], vehicle) : []).sort((a, b) => a.name[lang].localeCompare(b.name[lang], lang)),
    [data.fuels, vehicle, lang],
  );
  const speedTyped = vehicle ? form.speed[vehicle.id] !== undefined : false;
  const stopTyped = vehicle ? form.stop[vehicle.id] !== undefined : false;
  const moreOpen = form.item !== '' || speedTyped || stopTyped;
  if (!vehicle) return <p>{t('vehicleCalc.unavailable')}</p>;

  // The drone keeps its own fuel choice: it takes fewer fuels, and its speed depends on the fuel.
  const fuelField = vehicle.fuel?.fuels ? 'droneFuel' : 'fuel';
  const fuel = vehicle.fuel ? findFuel(sortedFuels, form[fuelField]) : null;
  const speedDefault = defaultSpeed(vehicle, fuel?.id ?? null);
  const speedGame = speedDefault ? String(kmh(speedDefault.mps)) : '';
  const speed = form.speed[vehicle.id] ?? speedGame;
  const stopGame = defaultStop(vehicle);
  const stop = form.stop[vehicle.id] ?? stopGame;
  const load = loadFor(vehicle, item);
  const trip: TripInput = { routeMeters: num(form.route), speedKmh: num(speed), stopSeconds: num(stop) };
  const fuelInput: FuelInput | undefined = fuel && vehicle.fuel ? { perMetreMJ: vehicle.fuel.perMetreMJ, perTripMJ: vehicle.fuel.perTripMJ, energyMJ: fuel.energyMJ } : undefined;
  // One vehicle on the route, and as many as the target needs.
  const one = load ? calculate(trip, load, { kind: 'rate', vehicles: 1 }, fuelInput) : null;
  const fleet = load && one ? calculate(trip, load, { kind: 'vehicles', targetPerMinute: num(form.target) }, fuelInput) : null;
  const rows = one && load ? fuelRows(vehicle, data.fuels ?? [], trip, load, lang) : [];
  const freight = vehicle.id === 'freightCar';
  const itemTyped = form.item.trim() !== '';

  // Why there is no result yet: the first thing missing, in the order of the form.
  const missing = itemTyped && !item ? t('vehicleCalc.itemUnknown')
    : item && !load ? t('vehicleCalc.cannotCarry', { vehicle: vehicle.name[lang], item: item.name[lang] })
      : !atLeastZero(trip.routeMeters) ? t('vehicleCalc.result.missing.route')
        : !(trip.speedKmh > 0) ? t('vehicleCalc.result.missing.speed')
          : t('vehicleCalc.result.missing.stop');

  const capacity = (v: TransportVehicle) => {
    if (v.slots !== null && v.fluidCapacity !== null) return t('vehicleCalc.capacity.both', { stacks: v.slots, m3: v.fluidCapacity });
    if (v.slots !== null) return t('vehicleCalc.amount.stacks', { value: v.slots });
    return v.fluidCapacity !== null ? t('vehicleCalc.amount.m3', { value: v.fluidCapacity }) : '';
  };

  const speedField = (
    <ValueField label={t('vehicleCalc.speed')} value={speed} unit={t('vehicleCalc.unit.kmh')}
      onChange={v => onChange({ speed: { ...form.speed, [vehicle.id]: v } })}
      hint={speedDefault === null ? t('vehicleCalc.speedMissing') : t(`vehicleCalc.speedDefault.${speedDefault.source}`, {
        limit: kmh(vehicle.straightPathSpeed ?? 0), fuel: fuel?.name[lang],
      })}
      reset={speedTyped && speedGame !== '' && speed !== speedGame ? {
        label: t('vehicleCalc.reset', { value: `${nums.n(Number(speedGame))} ${t('vehicleCalc.unit.kmh')}` }),
        onReset: () => onChange({ speed: without(form.speed, vehicle.id) }),
      } : undefined} />
  );
  const stopField = (
    <ValueField label={t('vehicleCalc.stop')} value={stop} unit={t('vehicleCalc.unit.s')}
      onChange={v => onChange({ stop: { ...form.stop, [vehicle.id]: v } })}
      hint={vehicle.stopSource === null ? t('vehicleCalc.stopMissing') : t(`vehicleCalc.stopSource.${vehicle.stopSource}`)}
      reset={stopTyped && stopGame !== '' && stop !== stopGame ? {
        label: t('vehicleCalc.reset', { value: `${nums.n(Number(stopGame))} ${t('vehicleCalc.unit.s')}` }),
        onReset: () => onChange({ stop: without(form.stop, vehicle.id) }),
      } : undefined} />
  );
  /** A typed number in the UI language for the folded section's summary; a dash while it is not a number. */
  const shown = (v: string) => (Number.isFinite(num(v)) ? nums.n(num(v)) : '–');
  // Without a game value the field is needed for any result, so it is not folded away.
  const speedRequired = speedDefault === null;
  const stopRequired = vehicle.stopSeconds === null;

  return (
    <form onSubmit={e => e.preventDefault()} noValidate
      className="mx-auto grid w-full max-w-6xl gap-4 lg:grid-cols-2 lg:items-start lg:gap-6">
      <div className="flex min-w-0 flex-col gap-4">
        <Step n={1} title={t('vehicleCalc.step.route')}>
          {picker}
          <ValueField label={t('vehicleCalc.route')} value={form.route} unit={t('vehicleCalc.unit.m')} onChange={route => onChange({ route })} />
        </Step>

        <Step n={2} title={t('vehicleCalc.step.vehicle')}>
          <div role="radiogroup" aria-label={t('vehicleCalc.step.vehicle')} className="grid grid-cols-3 gap-2">
            {data.vehicles.map(v => {
              const checked = v.id === vehicle.id;
              const nameId = `${ids.radio}-${v.id}`;
              return (
                <label key={v.id}
                  className={`flex min-w-0 cursor-pointer flex-col items-center gap-1 chamfer border px-1 pt-2 pb-2 text-center transition-colors has-focus-visible:ring-2 has-focus-visible:ring-accent has-focus-visible:ring-offset-2 has-focus-visible:ring-offset-panel ${
                    checked ? 'border-accent bg-accent/15' : 'border-line bg-bg hover:border-edge hover:bg-raised'}`}>
                  <input type="radio" name={ids.radio} value={v.id} checked={checked} onChange={() => onChange({ vehicle: v.id })}
                    aria-labelledby={nameId} aria-describedby={`${nameId}-cap`} className="sr-only" />
                  <GameIcon cls={VEHICLE_PICTURES[v.id]} px={56} placeholder />
                  <span id={nameId} className={`text-sm leading-tight font-semibold ${checked ? 'text-accent' : ''}`}>{v.name[lang]}</span>
                  <span id={`${nameId}-cap`} className="text-xs leading-tight text-muted">{capacity(v)}</span>
                </label>
              );
            })}
          </div>
          {speedRequired && speedField}
          {stopRequired && stopField}
        </Step>

        <Step n={3} title={t('vehicleCalc.step.fuel')}>
          {fuel ? (
            <div className="flex flex-col gap-1">
              <label htmlFor={ids.fuelSelect} className="sr-only">{t('vehicleCalc.fuel')}</label>
              <div className="flex items-center gap-2">
                <GameIcon cls={fuel.id} px={36} placeholder />
                <select id={ids.fuelSelect} value={fuel.id} onChange={e => onChange({ [fuelField]: e.target.value })}
                  aria-describedby={vehicle.fuel?.fuels ? ids.fuelHint : undefined} className={fieldClass({}, 'w-full min-w-0')}>
                  {sortedFuels.map(f => <option key={f.id} value={f.id}>{f.name[lang]}</option>)}
                </select>
              </div>
              {vehicle.fuel?.fuels && <p id={ids.fuelHint} className="text-xs text-muted">{t('vehicleCalc.fuelHint.drone')}</p>}
            </div>
          ) : (
            <p className="text-sm text-muted">{t(freight ? 'vehicleCalc.fuelNone.freightCar' : 'vehicleCalc.fuelNone.other')}</p>
          )}
        </Step>

        <Fold
          title={t('vehicleCalc.more.title')}
          summary={t('vehicleCalc.more.values', { item: itemTyped ? form.item.trim() : t('vehicleCalc.more.anyItem'), speed: shown(speed), stop: shown(stop) })}
          defaultOpen={moreOpen}
          className={WINDOW_FRAME}
          summaryClassName="px-3 py-1.5"
          bodyClassName="flex flex-col gap-4 border-t border-line p-3"
        >
            <div className="flex flex-col gap-1">
              <label htmlFor={ids.item} className={FIELD_LABEL}>{t('vehicleCalc.item')}</label>
              <div className="flex items-center gap-2">
                {item && <GameIcon cls={item.id} px={32} />}
                <input id={ids.item} list={ids.items} value={form.item} autoComplete="off" placeholder={t('vehicleCalc.itemPlaceholder')}
                  aria-describedby={ids.itemHint} aria-invalid={itemTyped && (!item || !load)}
                  onChange={e => onChange({ item: e.target.value })} className={fieldClass({}, 'w-full min-w-0')} />
                {itemTyped && (
                  <IconButton onClick={() => onChange({ item: '' })} aria-label={t('vehicleCalc.itemClear')} title={t('vehicleCalc.itemClear')}>
                    <CloseIcon />
                  </IconButton>
                )}
              </div>
              <datalist id={ids.items}>
                {sortedItems.map(i => <option key={i.id} value={i.name[lang]} />)}
              </datalist>
              <p id={ids.itemHint} className={`text-xs ${itemTyped && (!item || !load) ? 'text-conflict' : 'text-muted'}`}>
                {itemTyped && !item ? t('vehicleCalc.itemUnknown')
                  : item && !load ? t('vehicleCalc.cannotCarry', { vehicle: vehicle.name[lang], item: item.name[lang] })
                    : t('vehicleCalc.itemHint')}
              </p>
            </div>
            {!speedRequired && speedField}
            {!stopRequired && stopField}
        </Fold>
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        <ResultPanel vehicle={vehicle} fuel={fuel} route={form.route} one={one && load ? { result: one, load, oneWay: oneWaySeconds(trip), stop: trip.stopSeconds } : null}
          missing={missing} lang={lang}>
          {one && load && (
            <FleetPanel fleet={fleet} load={load} target={form.target} onTarget={target => onChange({ target })} freight={freight} fuelName={fuel?.name[lang]} />
          )}
        </ResultPanel>
        {one && load && rows.length > 0 && (
          <FuelTable rows={rows} bySpeed={vehicle.fuel?.fuels != null} selected={fuel?.id ?? null} lang={lang} />
        )}
      </div>
    </form>
  );
}

/**
 * The answer, a window: what one vehicle does on the route with the chosen fuel. Stacks per minute (m³ for fluids;
 * with an item also items), the round trip with the one-way trip, the fuel per round trip and per minute, the load per
 * trip and the stop time it includes. A status region, so changes are announced; until the input is complete it says
 * what is missing. `children` (the fleet question) goes under it.
 */
function ResultPanel({ vehicle, fuel, route, one, missing, lang, children }: {
  vehicle: TransportVehicle; fuel: TransportFuel | null; route: string; lang: 'en' | 'de'; missing: string;
  one: { result: CalcResult; load: Load; oneWay: number; stop: number } | null; children?: ReactNode;
}) {
  const { t } = useTranslation();
  const nums = useNumbers();
  const duration = useDuration();
  const freight = vehicle.id === 'freightCar';
  return (
    <Window level={3} title={t('vehicleCalc.result.title')} bodyClassName="flex flex-col">
      <div role="status" aria-label={t('vehicleCalc.result.title')} className="flex flex-col gap-3 p-3">
        {one ? (
          <>
            {/* What the numbers are for: vehicle, route length and fuel; thin lines between them where they fit on one line. */}
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted sm:gap-x-0 sm:[&>span+span]:ml-3 sm:[&>span+span]:border-l sm:[&>span+span]:border-line sm:[&>span+span]:pl-3">
              <span className="inline-flex items-center gap-1.5 font-semibold text-fg"><GameIcon cls={VEHICLE_PICTURES[vehicle.id]} px={24} />{vehicle.name[lang]}</span>
              <span className="tabular-nums">{t('vehicleCalc.routeInfo.metres', { value: nums.n(Number(route)) })}</span>
              {fuel && <span className="inline-flex items-center gap-1.5"><GameIcon cls={fuel.id} px={20} />{fuel.name[lang]}</span>}
            </p>
            <dl className={`grid grid-cols-2 gap-2 ${one.result.fuel ? 'sm:grid-cols-3' : ''}`}>
              <StatTile main className="col-span-2 sm:col-span-1" label={t(freight ? 'vehicleCalc.result.perFreightCar' : 'vehicleCalc.result.perVehicle')}
                sub={one.load.unit === 'items' ? t('vehicleCalc.rate.itemsOnly', { value: round1(one.result.perVehiclePerMinute) }) : undefined}>
                {one.load.unit === 'm3'
                  ? <TileValue value={nums.n(round1(one.result.perVehiclePerMinute))} unit={t('vehicleCalc.unit.m3')} />
                  : <TileValue value={nums.n(round1(one.result.stacksPerVehiclePerMinute ?? 0))} unit={t('vehicleCalc.unit.stacks')} />}
              </StatTile>
              <StatTile label={t('vehicleCalc.result.roundTrip')} sub={t('vehicleCalc.result.oneWay', { time: duration(one.oneWay) })}>
                {duration(one.result.roundTripSeconds)}
              </StatTile>
              {one.result.fuel && fuel && (
                <StatTile label={t('vehicleCalc.result.fuel')} sub={t('vehicleCalc.result.fuelPerMinute', { value: nums.fuel(one.result.fuel.perVehiclePerMinute) })}>
                  <span className="inline-flex items-center gap-2"><GameIcon cls={fuel.id} px={28} />{nums.fuel(one.result.fuel.perTrip)}</span>
                </StatTile>
              )}
            </dl>
            <p className="text-sm text-muted">
              {t('vehicleCalc.result.load', { load: t(`vehicleCalc.amount.${one.load.unit}`, { value: round1(one.result.perTrip) }), stop: duration(one.stop) })}
            </p>
            {vehicle.fuel && <p className="text-xs text-muted">{t(`vehicleCalc.result.fuelNote.${vehicle.fuel.source}`)}</p>}
          </>
        ) : (
          <>
            <p>{missing}</p>
            {/* What the result will show, empty until the input is complete. */}
            <dl aria-hidden="true" className={`grid grid-cols-2 gap-2 opacity-60 ${vehicle.fuel ? 'sm:grid-cols-3' : ''}`}>
              <StatTile main className="col-span-2 sm:col-span-1" label={t(freight ? 'vehicleCalc.result.perFreightCar' : 'vehicleCalc.result.perVehicle')}>–</StatTile>
              <StatTile label={t('vehicleCalc.result.roundTrip')}>–</StatTile>
              {vehicle.fuel && <StatTile label={t('vehicleCalc.result.fuel')}>–</StatTile>}
            </dl>
          </>
        )}
      </div>
      {children}
    </Window>
  );
}

/**
 * Every fuel the vehicle takes on this route, the selected one marked. For the drone, whose speed depends on the fuel:
 * round trip, fuel and stacks per minute; for a wheeled vehicle the trip takes as long with every fuel: fuel per round
 * trip and per minute. On a phone each row breaks into two lines, the fuel's name over its numbers, so nothing is cut
 * off; the explicit roles keep it a table for screen readers while its rows are grids.
 */
function FuelTable({ rows, bySpeed, selected, lang }: { rows: readonly FuelRow[]; bySpeed: boolean; selected: string | null; lang: 'en' | 'de' }) {
  const { t } = useTranslation();
  const nums = useNumbers();
  const duration = useDuration();
  const line = `max-sm:grid ${bySpeed ? 'max-sm:grid-cols-3' : 'max-sm:grid-cols-2'}`;
  const cell = 'px-1.5 py-1 text-right whitespace-nowrap tabular-nums';
  const head = 'px-1.5 py-1 text-right align-bottom font-semibold';
  return (
    <Window level={3} title={t('vehicleCalc.compare.title')} bodyClassName="flex flex-col gap-2 p-3">
      <p className="text-xs text-muted">{t(bySpeed ? 'vehicleCalc.compare.bySpeed' : 'vehicleCalc.compare.sameSpeed')}</p>
      <table role="table" aria-label={t('vehicleCalc.compare.title')} className="w-full border-collapse text-sm">
        <thead role="rowgroup">
          <tr role="row" className={`border-b border-line font-display text-xs tracking-wider text-muted uppercase ${line}`}>
            <th role="columnheader" scope="col" className="px-1.5 py-1 text-left align-bottom font-semibold max-sm:col-span-full">{t('vehicleCalc.fuel')}</th>
            {bySpeed && <th role="columnheader" scope="col" className={head}>{t('vehicleCalc.compare.roundTrip')}</th>}
            <th role="columnheader" scope="col" className={head}>{t(bySpeed ? 'vehicleCalc.compare.used' : 'vehicleCalc.compare.perTrip')}</th>
            <th role="columnheader" scope="col" className={head}>{bySpeed ? t('vehicleCalc.compare.stacks') : t('vehicleCalc.compare.perMinute')}</th>
          </tr>
        </thead>
        <tbody role="rowgroup">
          {rows.map(r => {
            const current = r.fuel.id === selected;
            return (
              <tr key={r.fuel.id} role="row" aria-current={current || undefined}
                className={`border-b border-line last:border-b-0 ${line} ${current ? 'border-l-2 border-l-accent bg-accent/15 font-semibold' : ''}`}>
                <th role="rowheader" scope="row" className={`px-1.5 py-1 text-left max-sm:col-span-full max-sm:pb-0 ${current ? '' : 'font-normal'}`}>
                  <span className="flex items-center gap-1.5"><GameIcon cls={r.fuel.id} px={20} placeholder />{r.fuel.name[lang]}</span>
                </th>
                {bySpeed && <td role="cell" className={cell}>{duration(r.roundTripSeconds)}</td>}
                <td role="cell" className={cell}>{nums.fuel(r.perTrip)}</td>
                <td role="cell" className={cell}>{bySpeed ? nums.n(round1(r.stacksPerMinute ?? 0)) : nums.fuel(r.perMinute ?? 0)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Window>
  );
}

/**
 * "How many vehicles do I need?", folded away until asked: the target throughput in the load's unit, then the vehicles
 * it takes (rounded up), their utilisation, what they move at most and the fuel they burn together.
 */
function FleetPanel({ fleet, load, target, onTarget, freight, fuelName }: {
  fleet: CalcResult | null; load: Load; target: string; onTarget(v: string): void; freight: boolean; fuelName: string | undefined;
}) {
  const { t } = useTranslation();
  const nums = useNumbers();
  const noun = freight ? 'freightCars' : 'vehicles';
  const rate = (perMinute: number, stacks: number | null) => (load.unit === 'items'
    ? t('vehicleCalc.rate.items', { items: round1(perMinute), stacks: round1(stacks ?? 0) })
    : t(`vehicleCalc.rate.${load.unit}`, { value: round1(perMinute) }));
  return (
    <Fold
      title={t(`vehicleCalc.fleet.question.${noun}`)}
      defaultOpen={target !== ''}
      className="border-t border-line"
      summaryClassName="px-3 py-1.5"
      bodyClassName="flex flex-col gap-3 px-3 pb-3"
    >
      <ValueField label={t('vehicleCalc.fleet.target')} value={target} unit={t(`vehicleCalc.unit.${load.unit}`)} onChange={onTarget} />
      <div role="status" aria-label={t(`vehicleCalc.fleet.question.${noun}`)} className="text-sm">
        {fleet ? (
          <StatList>
            <StatRow label={t(`vehicleCalc.fleet.needed.${noun}`)} value={nums.n(fleet.vehicles)} tone="accent" />
            <StatRow label={t('vehicleCalc.fleet.utilisation')} value={t('vehicleCalc.fleet.percent', { share: fleet.utilisation ?? 0 })} />
            <StatRow label={t('vehicleCalc.fleet.capacity')} value={rate(fleet.capacityPerMinute, fleet.capacityStacksPerMinute)} />
            {fleet.fuel && fuelName && (
              <StatRow label={t('vehicleCalc.fleet.fuel')} value={t('vehicleCalc.fleet.fuelTotal', { value: nums.fuel(fleet.fuel.perMinute), fuel: fuelName })} />
            )}
          </StatList>
        ) : <p className="text-muted">{t('vehicleCalc.fleet.missing')}</p>}
      </div>
      {freight && <p className="text-xs text-muted">{t('vehicleCalc.fleet.freightCarNote')}</p>}
    </Fold>
  );
}
