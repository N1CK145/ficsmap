import { useId, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  calculate, DEFAULT_FUEL, defaultSpeed, loadFor, oneWaySeconds, tripsByFuel, vehicleFuels,
  type CalcResult, type FuelTrip, type Load, type TransportData, type TransportFuel, type TransportItem, type TransportVehicle, type TripInput, type VehicleId,
} from '../../../shared/transport.js';
import { SegmentedControl } from '../../components/SegmentedControl.js';
import type { CalcForm, CalcGoal } from './useVehicleCalc.js';

const INPUT = 'h-10 w-full min-w-0 rounded border border-line bg-bg px-3 text-fg focus-ring';

/** "" or a non-number is NaN, so `calculate` rejects it. */
const num = (s: string) => (s.trim() === '' ? Number.NaN : Number(s));
/** One decimal at most, for display and for the defaults put into the inputs. */
const round1 = (n: number) => Math.round(n * 10) / 10;
/** Fuel rates: two decimals, three significant digits below 1 (fuel rods last long). */
const roundFuel = (n: number) => (n >= 1 ? Math.round(n * 100) / 100 : Number(n.toPrecision(3)));
const kmh = (mps: number) => round1(mps * 3.6);

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

function Field({ id, label, hint, hintId, children }: { id: string; label: ReactNode; hint?: ReactNode; hintId?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">{label}</label>
      {children}
      {hint && <p id={hintId} className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

/**
 * The vehicle calculator: route length (typed, or picked on the map with `picker`), vehicle, optional item, speed and
 * stop time; then what one vehicle does on the route (trip times, fuel, stacks per minute; for the drone per fuel),
 * and either the vehicles needed for a target rate or the rate of a number of vehicles. Pure maths in
 * `shared/transport.ts`.
 */
export function VehicleCalculator({ data, form, onChange, picker }: {
  data: TransportData; form: CalcForm; onChange(patch: Partial<CalcForm>): void;
  /** Under the route length: picking it on the map (RoutePicker). */
  picker?: ReactNode;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === 'de' ? 'de' : 'en';
  const ids = { route: useId(), vehicle: useId(), item: useId(), items: useId(), itemHint: useId(), speed: useId(), speedHint: useId(), stop: useId(), stopHint: useId(), fuel: useId(), fuelHint: useId(), amount: useId(), amountHint: useId(), trip: useId(), result: useId() };

  const vehicle = data.vehicles.find(v => v.id === form.vehicle) ?? data.vehicles[0];
  const item = findItem(data.items, form.item, lang);
  const sortedItems = useMemo(() => [...data.items].sort((a, b) => a.name[lang].localeCompare(b.name[lang], lang)), [data.items, lang]);
  // The fuels this vehicle takes (none for the freight car; older vehicle data has no fuel use).
  const sortedFuels = useMemo(
    () => (vehicle ? vehicleFuels(data.fuels ?? [], vehicle) : []).sort((a, b) => a.name[lang].localeCompare(b.name[lang], lang)),
    [data.fuels, vehicle, lang],
  );
  if (!vehicle) return <p>{t('vehicleCalc.unavailable')}</p>;

  // The drone keeps its own fuel choice: it takes fewer fuels, and its speed depends on the fuel.
  const fuelField = vehicle.fuel?.fuels ? 'droneFuel' : 'fuel';
  const fuel = vehicle.fuel ? findFuel(sortedFuels, form[fuelField]) : null;
  const speedDefault = defaultSpeed(vehicle, fuel?.id ?? null);
  const speed = form.speed[vehicle.id] ?? (speedDefault ? String(kmh(speedDefault.mps)) : '');
  const stop = form.stop[vehicle.id] ?? defaultStop(vehicle);
  const load = loadFor(vehicle, item);
  const unit = load?.unit ?? 'stacks';
  const trip: TripInput = { routeMeters: num(form.route), speedKmh: num(speed), stopSeconds: num(stop) };
  const fuelInput = fuel && vehicle.fuel ? { perMetreMJ: vehicle.fuel.perMetreMJ, perTripMJ: vehicle.fuel.perTripMJ, energyMJ: fuel.energyMJ } : undefined;
  // One vehicle on the route, whatever the goal.
  const one = load ? calculate(trip, load, { kind: 'rate', vehicles: 1 }, fuelInput) : null;
  const result = load
    ? calculate(trip, load, form.goal === 'vehicles' ? { kind: 'vehicles', targetPerMinute: num(form.target) } : { kind: 'rate', vehicles: num(form.count) }, fuelInput)
    : null;
  // The drone's speed depends on its fuel: what it does with each (at the game's speed for it).
  const byFuel = one && load && vehicle.fuel?.fuels ? tripsByFuel(vehicle, data.fuels ?? [], { routeMeters: trip.routeMeters, stopSeconds: trip.stopSeconds }, load) : [];
  const noun = vehicle.id === 'freightCar' ? 'freightCars' : 'vehicles';

  const itemTyped = form.item.trim() !== '';
  const setVehicle = (id: VehicleId) => onChange({ vehicle: id });

  return (
    <form onSubmit={e => e.preventDefault()} className="flex flex-col gap-4" noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={ids.route} label={t('vehicleCalc.route')}>
          <div className="flex items-center gap-2">
            <input id={ids.route} type="number" inputMode="decimal" min={0} step="any" value={form.route}
              onChange={e => onChange({ route: e.target.value })} className={INPUT} />
            <span className="text-sm text-muted">{t('vehicleCalc.unit.m')}</span>
          </div>
        </Field>
        <Field id={ids.vehicle} label={t('vehicleCalc.vehicle')}>
          <select id={ids.vehicle} value={vehicle.id} onChange={e => setVehicle(e.target.value as VehicleId)} className={INPUT}>
            {data.vehicles.map(v => <option key={v.id} value={v.id}>{v.name[lang]}</option>)}
          </select>
        </Field>
      </div>
      {picker}

      <Field id={ids.item} label={t('vehicleCalc.item')} hintId={ids.itemHint}
        hint={itemTyped && !item ? t('vehicleCalc.itemUnknown') : item && !load ? t('vehicleCalc.cannotCarry', { vehicle: vehicle.name[lang], item: item.name[lang] }) : t('vehicleCalc.itemHint')}>
        <div className="flex items-center gap-2">
          <input id={ids.item} list={ids.items} value={form.item} autoComplete="off" placeholder={t('vehicleCalc.itemPlaceholder')}
            aria-describedby={ids.itemHint} aria-invalid={itemTyped && (!item || !load)}
            onChange={e => onChange({ item: e.target.value })} className={INPUT} />
          {itemTyped && (
            <button type="button" onClick={() => onChange({ item: '' })} aria-label={t('vehicleCalc.itemClear')}
              className="size-10 shrink-0 rounded border border-line text-muted hover:text-fg focus-ring">
              <span aria-hidden="true">×</span>
            </button>
          )}
        </div>
        <datalist id={ids.items}>
          {sortedItems.map(i => <option key={i.id} value={i.name[lang]} />)}
        </datalist>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={ids.speed} label={t('vehicleCalc.speed')} hintId={ids.speedHint}
          hint={speedDefault === null ? t('vehicleCalc.speedMissing') : t(`vehicleCalc.speedDefault.${speedDefault.source}`, {
            speed: kmh(speedDefault.mps), limit: kmh(vehicle.straightPathSpeed ?? 0), fuel: fuel?.name[lang],
          })}>
          <div className="flex items-center gap-2">
            <input id={ids.speed} type="number" inputMode="decimal" min={0} step="any" value={speed} aria-describedby={ids.speedHint}
              onChange={e => onChange({ speed: { ...form.speed, [vehicle.id]: e.target.value } })} className={INPUT} />
            <span className="text-sm text-muted">{t('vehicleCalc.unit.kmh')}</span>
          </div>
        </Field>
        <Field id={ids.stop} label={t('vehicleCalc.stop')} hintId={ids.stopHint}
          hint={vehicle.stopSource === null ? t('vehicleCalc.stopMissing') : t(`vehicleCalc.stopSource.${vehicle.stopSource}`, { seconds: round1(vehicle.stopSeconds ?? 0) })}>
          <div className="flex items-center gap-2">
            <input id={ids.stop} type="number" inputMode="decimal" min={0} step="any" value={stop} aria-describedby={ids.stopHint}
              onChange={e => onChange({ stop: { ...form.stop, [vehicle.id]: e.target.value } })} className={INPUT} />
            <span className="text-sm text-muted">{t('vehicleCalc.unit.s')}</span>
          </div>
        </Field>
      </div>

      {fuel && vehicle.fuel && (
        <Field id={ids.fuel} label={t('vehicleCalc.fuel')} hintId={ids.fuelHint}
          hint={t(`vehicleCalc.fuelHint.${vehicle.fuel.source}`, { perMetre: vehicle.fuel.perMetreMJ, trip: vehicle.fuel.perTripMJ, energy: fuel.energyMJ })}>
          <select id={ids.fuel} value={fuel.id} aria-describedby={ids.fuelHint} onChange={e => onChange({ [fuelField]: e.target.value })} className={INPUT}>
            {sortedFuels.map(f => <option key={f.id} value={f.id}>{f.name[lang]}</option>)}
          </select>
        </Field>
      )}

      <section aria-labelledby={ids.trip} className="rounded border-2 border-accent/60 bg-bg p-3">
        <h3 id={ids.trip} className="font-display text-lg font-semibold">{t(`vehicleCalc.trip.title.${noun}`)}</h3>
        <div role="status" aria-labelledby={ids.trip} className="mt-2 text-sm">
          {one && load
            ? <TripResult one={one} oneWay={oneWaySeconds(trip)} load={load} fuelName={fuel?.name[lang]} />
            : <p className="text-muted">{t('vehicleCalc.trip.incomplete')}</p>}
        </div>
        {byFuel.length > 0 && <FuelTable rows={byFuel} selected={fuel?.id ?? null} lang={lang} />}
      </section>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium" aria-hidden="true">{t('vehicleCalc.goal')}</span>
        <SegmentedControl<CalcGoal>
          label={t('vehicleCalc.goal')}
          value={form.goal}
          onChange={goal => onChange({ goal })}
          options={[{ value: 'vehicles', label: t('vehicleCalc.goalVehicles') }, { value: 'rate', label: t('vehicleCalc.goalRate') }]}
        />
      </div>

      {form.goal === 'vehicles' ? (
        <Field id={ids.amount} label={t('vehicleCalc.target')}>
          <div className="flex items-center gap-2">
            <input id={ids.amount} type="number" inputMode="decimal" min={0} step="any" value={form.target}
              onChange={e => onChange({ target: e.target.value })} className={INPUT} />
            <span className="shrink-0 text-sm text-muted">{t(`vehicleCalc.unit.${unit}`)}</span>
          </div>
        </Field>
      ) : (
        <Field id={ids.amount} label={t(vehicle.id === 'freightCar' ? 'vehicleCalc.countFreightCars' : 'vehicleCalc.count')}>
          <input id={ids.amount} type="number" inputMode="numeric" min={0} step={1} value={form.count}
            onChange={e => onChange({ count: e.target.value })} className={INPUT} />
        </Field>
      )}

      <section aria-labelledby={ids.result} className="rounded border border-line bg-bg p-3">
        <h3 id={ids.result} className="font-display text-lg font-semibold">{t('vehicleCalc.result.title')}</h3>
        <div role="status" aria-labelledby={ids.result} className="mt-1 text-sm">
          {result && load ? <Result result={result} load={load} goal={form.goal} noun={noun} fuelName={fuel?.name[lang]} /> : <p className="text-muted">{t('vehicleCalc.result.incomplete')}</p>}
        </div>
        {vehicle.id === 'freightCar' && <p className="mt-2 text-xs text-muted">{t('vehicleCalc.freightCarNote')}</p>}
      </section>
    </form>
  );
}

/** A rate in the load's unit; with an item also in stacks. */
function useRate() {
  const { t } = useTranslation();
  return (load: Load, perMinute: number, stacksPerMinute: number | null) => {
    if (load.unit === 'items') return t('vehicleCalc.rate.items', { items: round1(perMinute), stacks: round1(stacksPerMinute ?? 0) });
    return t(`vehicleCalc.rate.${load.unit}`, { value: round1(perMinute) });
  };
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

function Tile({ label, children, sub }: { label: ReactNode; children: ReactNode; sub?: ReactNode }) {
  return (
    <div className="flex flex-col rounded bg-panel px-3 py-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-lg leading-snug font-semibold tabular-nums">{children}</dd>
      {sub && <dd className="text-xs text-muted tabular-nums">{sub}</dd>}
    </div>
  );
}

/**
 * One vehicle on the route: the drive one way, the round trip with the stops, what it moves per minute (stacks, or
 * m³ for fluids; with an item also items), the load per trip and the fuel per round trip.
 */
function TripResult({ one, oneWay, load, fuelName }: { one: CalcResult; oneWay: number; load: Load; fuelName: string | undefined }) {
  const { t } = useTranslation();
  const duration = useDuration();
  const moves = load.unit === 'm3'
    ? t('vehicleCalc.rate.m3', { value: round1(one.perVehiclePerMinute) })
    : t('vehicleCalc.rate.stacks', { value: round1(one.stacksPerVehiclePerMinute ?? 0) });
  return (
    <dl className="grid grid-cols-2 gap-2">
      <Tile label={t('vehicleCalc.trip.oneWay')}>{duration(oneWay)}</Tile>
      <Tile label={t('vehicleCalc.trip.roundTrip')}>{duration(one.roundTripSeconds)}</Tile>
      <Tile label={t('vehicleCalc.trip.moves')} sub={load.unit === 'items' ? t('vehicleCalc.rate.itemsOnly', { value: round1(one.perVehiclePerMinute) }) : undefined}>
        {moves}
      </Tile>
      <Tile label={t('vehicleCalc.result.perTrip')}>{t(`vehicleCalc.amount.${load.unit}`, { value: round1(one.perTrip) })}</Tile>
      {one.fuel && fuelName && (
        <Tile label={t('vehicleCalc.trip.fuel')} sub={t('vehicleCalc.trip.fuelPerMinute', { value: roundFuel(one.fuel.perVehiclePerMinute) })}>
          {t('vehicleCalc.trip.fuelValue', { value: roundFuel(one.fuel.perTrip), fuel: fuelName })}
        </Tile>
      )}
    </dl>
  );
}

/** The drone on the route with each of its fuels (speed from the game data); the selected fuel's row is marked. */
function FuelTable({ rows, selected, lang }: { rows: readonly FuelTrip[]; selected: string | null; lang: 'en' | 'de' }) {
  const { t, i18n } = useTranslation();
  const duration = useDuration();
  const n = new Intl.NumberFormat(i18n.language).format;
  const cell = 'px-2 py-1 text-right whitespace-nowrap tabular-nums';
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full border-collapse text-sm">
        <caption className="pb-1 text-left text-xs text-muted">{t('vehicleCalc.fuelTable.caption')}</caption>
        <thead>
          <tr className="border-b border-line text-xs text-muted">
            <th scope="col" className="px-2 py-1 text-left font-medium">{t('vehicleCalc.fuel')}</th>
            <th scope="col" className="px-2 py-1 text-right font-medium">{t('vehicleCalc.fuelTable.speed')}</th>
            <th scope="col" className="px-2 py-1 text-right font-medium">{t('vehicleCalc.trip.oneWay')}</th>
            <th scope="col" className="px-2 py-1 text-right font-medium">{t('vehicleCalc.trip.roundTrip')}</th>
            <th scope="col" className="px-2 py-1 text-right font-medium">{t('vehicleCalc.trip.fuel')}</th>
            <th scope="col" className="px-2 py-1 text-right font-medium">{t('vehicleCalc.unit.stacks')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => {
            const current = r.fuel.id === selected;
            return (
              <tr key={r.fuel.id} aria-current={current || undefined} className={`border-b border-line last:border-b-0 ${current ? 'bg-accent/15 font-semibold' : ''}`}>
                <th scope="row" className={`px-2 py-1 text-left ${current ? 'border-l-2 border-accent' : 'font-normal'}`}>{r.fuel.name[lang]}</th>
                <td className={cell}>{t('vehicleCalc.fuelTable.kmh', { value: kmh(r.speed) })}</td>
                <td className={cell}>{duration(r.oneWaySeconds)}</td>
                <td className={cell}>{duration(r.roundTripSeconds)}</td>
                <td className={cell}>{n(roundFuel(r.fuelPerRoundTrip))}</td>
                <td className={cell}>{n(round1(r.stacksPerMinute ?? 0))}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** All the vehicles: how many are needed (with the utilisation) or what they move, and the fuel they burn together. */
function Result({ result, load, goal, noun, fuelName }: { result: CalcResult; load: Load; goal: CalcGoal; noun: 'vehicles' | 'freightCars'; fuelName: string | undefined }) {
  const { t } = useTranslation();
  const rate = useRate();
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
      {goal === 'vehicles' ? (
        <>
          <dt className="text-muted">{t(`vehicleCalc.result.needed.${noun}`)}</dt>
          <dd className="font-semibold">{t('vehicleCalc.result.countValue', { count: result.vehicles })}</dd>
          <dt className="text-muted">{t('vehicleCalc.result.utilisation')}</dt>
          <dd>{t('vehicleCalc.result.percent', { share: result.utilisation ?? 0 })}</dd>
          <dt className="text-muted">{t('vehicleCalc.result.capacity')}</dt>
          <dd>{rate(load, result.capacityPerMinute, result.capacityStacksPerMinute)}</dd>
        </>
      ) : (
        <>
          <dt className="text-muted">{t('vehicleCalc.result.throughput')}</dt>
          <dd className="font-semibold">{rate(load, result.capacityPerMinute, result.capacityStacksPerMinute)}</dd>
        </>
      )}
      {result.fuel && fuelName && (
        <>
          <dt className="text-muted">{t('vehicleCalc.result.fuel')}</dt>
          <dd>{t('vehicleCalc.result.fuelTotal', { value: roundFuel(result.fuel.perMinute), fuel: fuelName })}</dd>
        </>
      )}
    </dl>
  );
}
