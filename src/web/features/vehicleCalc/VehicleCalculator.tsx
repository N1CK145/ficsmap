import { useId, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { calculate, DEFAULT_FUEL, defaultSpeed, loadFor, vehicleFuels, type CalcResult, type Load, type TransportData, type TransportFuel, type TransportItem, type TransportVehicle, type VehicleId } from '../../../shared/transport.js';
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
 * The vehicle calculator: route length, vehicle, optional item, speed and stop time, then either the
 * vehicles needed for a target rate or the rate of a number of vehicles. Pure maths in `shared/transport.ts`.
 */
export function VehicleCalculator({ data, form, onChange }: { data: TransportData; form: CalcForm; onChange(patch: Partial<CalcForm>): void }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === 'de' ? 'de' : 'en';
  const ids = { route: useId(), vehicle: useId(), item: useId(), items: useId(), itemHint: useId(), speed: useId(), speedHint: useId(), stop: useId(), stopHint: useId(), fuel: useId(), fuelHint: useId(), amount: useId(), amountHint: useId(), result: useId() };

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
  const result = load
    ? calculate(
      { routeMeters: num(form.route), speedKmh: num(speed), stopSeconds: num(stop) },
      load,
      form.goal === 'vehicles' ? { kind: 'vehicles', targetPerMinute: num(form.target) } : { kind: 'rate', vehicles: num(form.count) },
      fuel && vehicle.fuel ? { perMetreMJ: vehicle.fuel.perMetreMJ, perTripMJ: vehicle.fuel.perTripMJ, energyMJ: fuel.energyMJ } : undefined,
    )
    : null;

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
        <div role="status" className="mt-1 text-sm">
          {result && load ? <Result result={result} load={load} goal={form.goal} freightCars={vehicle.id === 'freightCar'} fuelName={fuel?.name[lang]} /> : <p className="text-muted">{t('vehicleCalc.result.incomplete')}</p>}
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

function Result({ result, load, goal, freightCars, fuelName }: { result: CalcResult; load: Load; goal: CalcGoal; freightCars: boolean; fuelName: string | undefined }) {
  const { t } = useTranslation();
  const rate = useRate();
  const noun = freightCars ? 'freightCars' : 'vehicles';
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
      <dt className="text-muted">{t(`vehicleCalc.result.perOne.${noun}`)}</dt>
      <dd>{rate(load, result.perVehiclePerMinute, result.stacksPerVehiclePerMinute)}</dd>
      <dt className="text-muted">{t('vehicleCalc.result.perTrip')}</dt>
      <dd>{t(`vehicleCalc.amount.${load.unit}`, { value: round1(result.perTrip) })}</dd>
      <dt className="text-muted">{t('vehicleCalc.result.roundTrip')}</dt>
      <dd>{t('vehicleCalc.result.seconds', { value: round1(result.roundTripSeconds) })}</dd>
      {result.fuel && fuelName && (
        <>
          <dt className="text-muted">{t('vehicleCalc.result.fuel')}</dt>
          <dd>{t('vehicleCalc.result.fuelValue', {
            value: roundFuel(result.fuel.perMinute), perOne: roundFuel(result.fuel.perVehiclePerMinute), perTrip: roundFuel(result.fuel.perTrip), fuel: fuelName,
          })}</dd>
        </>
      )}
    </dl>
  );
}
