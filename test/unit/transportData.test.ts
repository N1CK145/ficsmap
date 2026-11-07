import { docsItems, parseDocs, type DocsClass } from '../../scripts/game-docs.js';
import { buildTransportData, describedCubicMetres, oneLine, type RawTransport } from '../../scripts/transport.js';

/** A Docs file as the game ships it: UTF-16 LE with a byte order mark. */
function utf16(groups: unknown): Uint8Array {
  const text = '﻿' + JSON.stringify(groups);
  const bytes = new Uint8Array(text.length * 2);
  for (let i = 0; i < text.length; i++) {
    bytes[2 * i] = text.charCodeAt(i) & 0xff;
    bytes[2 * i + 1] = text.charCodeAt(i) >> 8;
  }
  return bytes;
}

const NBSP = ' ', NNBSP = ' ';

// Values as in the game's en-US.json (1.2.5.0), cut down to the fields used.
const EN = [
  { NativeClass: 'FGItemDescriptor', Classes: [
    { ClassName: 'Desc_IronPlate_C', mDisplayName: 'Iron Plate', mForm: 'RF_SOLID', mStackSize: 'SS_BIG', mCachedStackSize: '200' },
    { ClassName: 'Desc_Water_C', mDisplayName: 'Water', mForm: 'RF_LIQUID', mStackSize: 'SS_FLUID', mCachedStackSize: '50000' },
    { ClassName: 'Desc_NitrogenGas_C', mDisplayName: 'Nitrogen Gas', mForm: 'RF_GAS', mStackSize: 'SS_FLUID', mCachedStackSize: '50000', mEnergyValue: '0.000000' },
    { ClassName: 'Desc_Fuel_C', mDisplayName: 'Packaged Fuel', mForm: 'RF_SOLID', mStackSize: 'SS_MEDIUM', mCachedStackSize: '100', mEnergyValue: '750.000000' },
    { ClassName: 'Desc_Coal_C', mDisplayName: 'Coal', mForm: 'RF_SOLID', mStackSize: 'SS_MEDIUM', mCachedStackSize: '100', mEnergyValue: '300.000000' },
    { ClassName: 'Desc_LiquidFuel_C', mDisplayName: 'Fuel', mForm: 'RF_LIQUID', mStackSize: 'SS_FLUID', mCachedStackSize: '50000', mEnergyValue: '0.750000' },
    { ClassName: 'Desc_Battery_C', mDisplayName: 'Battery', mForm: 'RF_SOLID', mStackSize: 'SS_HUGE', mCachedStackSize: '200', mEnergyValue: '6000.000000' },
    { ClassName: 'Desc_PlutoniumFuelRod_C', mDisplayName: 'Plutonium Fuel Rod', mForm: 'RF_SOLID', mStackSize: 'SS_SMALL', mCachedStackSize: '50', mEnergyValue: '1500000.000000' },
  ] },
  { NativeClass: 'FGBuildingDescriptor', Classes: [
    { ClassName: 'Desc_Wall_C', mDisplayName: 'Wall', mForm: 'RF_INVALID', mStackSize: 'SS_MEDIUM', mCachedStackSize: '100' },
  ] },
  { NativeClass: 'FGVehicleDescriptor', Classes: [
    { ClassName: 'Desc_Tractor_C', mManualFuelConsumption: '55.000000', mAutopilotFuelConsumption: '0.050000', mDisplayName: 'Tractor', mInventorySize: '25', mIsFluidStorageInventory: 'False', mForm: 'RF_INVALID', mDescription: '' },
    { ClassName: 'Desc_Truck_C', mManualFuelConsumption: '75.000000', mAutopilotFuelConsumption: '0.050000', mDisplayName: 'Truck', mInventorySize: '48', mIsFluidStorageInventory: 'False', mForm: 'RF_INVALID', mDescription: '' },
    { ClassName: 'Desc_Explorer_C', mManualFuelConsumption: '90.000000', mAutopilotFuelConsumption: '0.050000', mDisplayName: 'Explorer', mInventorySize: '12', mIsFluidStorageInventory: 'False', mForm: 'RF_INVALID', mDescription: '' },
    { ClassName: 'Desc_FluidTruck_C', mManualFuelConsumption: '75.000000', mAutopilotFuelConsumption: '0.050000', mDisplayName: 'Fluid Truck', mInventorySize: '1', mIsFluidStorageInventory: 'True', mForm: 'RF_INVALID', mDescription: `Has a capacity of 3200${NBSP}m³ for fluid storage.` },
    { ClassName: 'Desc_DroneTransport_C', mDisplayName: 'Drone', mInventorySize: '9', mForm: 'RF_INVALID', mDescription: 'Has 9 inventory slots.' },
    { ClassName: 'Desc_FreightWagon_C', mDisplayName: 'Freight Car', mInventorySize: '32', mForm: 'RF_INVALID', mDescription: `Has a 2400${NNBSP}m³ or 32-slot capacity, depending on whether resources are liquid or solid.` },
  ] },
  { NativeClass: 'FGBuildableDockingStation', Classes: [
    { ClassName: 'Build_TruckStation_C', mDescription: `Has 48 inventory slots.\r\n\r\nTransfers up to 120${NBSP}stacks per minute to/from docked vehicles.`, mLoadUnloadCycleLength: '8.000000' },
    { ClassName: 'Build_FluidTruckStation_C', mLoadUnloadCycleLength: '9.000000' },
  ] },
  { NativeClass: 'FGBuildableDroneStation', Classes: [
    { ClassName: 'Build_DroneStation_C', mTripPowerCost: '24000.000000', mTripPowerPerMeterCost: '6.000000' },
  ] },
  { NativeClass: 'FGBuildableTrainPlatformCargo', Classes: [
    { ClassName: 'Build_TrainDockingStation_C', mTimeToCompleteLoad: '27.000000', mTimeToCompleteUnload: '27.000000' },
    { ClassName: 'Build_TrainDockingStationLiquid_C', mTimeToCompleteLoad: '27.000000', mTimeToCompleteUnload: '27.000000' },
  ] },
];
const DE = [{ NativeClass: 'FGItemDescriptor', Classes: [
  { ClassName: 'Desc_IronPlate_C', mDisplayName: 'Eisenplatte' }, { ClassName: 'Desc_Truck_C', mDisplayName: 'Lkw' },
  { ClassName: 'Desc_Fuel_C', mDisplayName: 'Abgefüllter Treibstoff' }, { ClassName: 'Desc_PlutoniumFuelRod_C', mDisplayName: 'Plutonium- \r\nbrennstab' },
] }];

const bp = (cls: string, v: Partial<RawTransport['vehicles'][number]> = {}) => ({
  class: cls, inventorySize: null, isFluidStorage: null, fluidStackSizeMultiplier: null,
  dockingSequenceDuration: null, takeoffSequenceDuration: null, straightPathSpeedLimit: null, tractionSpeedLimit: null, droneFuelTypes: null, ...v,
});
// Values as in the extractor's transport.json (1.2.5.0), the drone with 3 of its 7 fuels.
const RAW: RawTransport = { vehicles: [
  bp('BP_Tractor_C', { inventorySize: 25, straightPathSpeedLimit: 25, tractionSpeedLimit: 19.6 }),
  bp('BP_Truck_C', { inventorySize: 48, fluidStackSizeMultiplier: 32, straightPathSpeedLimit: 25, tractionSpeedLimit: 26.2 }),
  bp('BP_FluidTruck_C', { inventorySize: 1, isFluidStorage: true, fluidStackSizeMultiplier: 64, straightPathSpeedLimit: 25, tractionSpeedLimit: 26.2 }),
  bp('BP_Explorer_C', { inventorySize: 12, straightPathSpeedLimit: 28, tractionSpeedLimit: 27.9 }),
  bp('BP_FreightWagon_C', { inventorySize: 32, fluidStackSizeMultiplier: 48 }),
  bp('BP_DroneTransport_C', {
    inventorySize: 9, dockingSequenceDuration: 28, takeoffSequenceDuration: 23,
    droneFuelTypes: [{ item: 'Desc_Battery_C', travelSpeed: 7500 }, { item: 'Desc_Fuel_C', travelSpeed: 5000 }, { item: 'Desc_PlutoniumFuelRod_C', travelSpeed: 10_000 }],
  }),
] };

describe('game Docs', () => {
  it('reads the UTF-16 file the game ships and plain UTF-8', () => {
    const docs = parseDocs(utf16(EN));
    expect(docs.find(c => c.ClassName === 'Desc_Truck_C')).toMatchObject({ mInventorySize: '48', NativeClass: 'FGVehicleDescriptor' });
    expect(parseDocs(new TextEncoder().encode(JSON.stringify(DE)))).toHaveLength(4);
  });

  it('lists items with a physical form and their numeric stack size', () => {
    expect(docsItems(parseDocs(utf16(EN))).slice(0, 4)).toEqual([
      { className: 'Desc_IronPlate_C', name: 'Iron Plate', stackSize: 200, fluid: false, energyMJ: 0 },
      { className: 'Desc_Water_C', name: 'Water', stackSize: 50_000, fluid: true, energyMJ: 0 },
      { className: 'Desc_NitrogenGas_C', name: 'Nitrogen Gas', stackSize: 50_000, fluid: true, energyMJ: 0 },
      { className: 'Desc_Fuel_C', name: 'Packaged Fuel', stackSize: 100, fluid: false, energyMJ: 750 },
    ]);
    const broken = [{ NativeClass: 'X', Classes: [{ ClassName: 'Desc_X_C', mForm: 'RF_SOLID', mStackSize: 'SS_BIG' }] }];
    expect(() => docsItems(parseDocs(utf16(broken)))).toThrow(/mCachedStackSize/);
  });

  it('joins names with a manual line break: a hyphen before the break and a lowercase letter splits a word', () => {
    expect(oneLine('Plutonium- \r\nbrennstab')).toBe('Plutoniumbrennstab');
    expect(oneLine('Plutonium-\r\nbrennstab')).toBe('Plutoniumbrennstab');
    // A hyphen followed by a plain space is part of the name.
    expect(oneLine('Luft- und Raumfahrttechnik')).toBe('Luft- und Raumfahrttechnik');
    expect(oneLine('Ficsonium-\r\nBrennstab')).toBe('Ficsonium-Brennstab');
    expect(oneLine('Packaged\r\nFuel')).toBe('Packaged Fuel');
    expect(oneLine('Iron Plate')).toBe('Iron Plate');
  });

  it('reads numbers from the descriptions, with the no-break spaces the game uses', () => {
    expect(describedCubicMetres(`a 2,400${NNBSP}m³ or 32-slot capacity`)).toBe(2400);
    expect(describedCubicMetres('no capacity here')).toBeNull();
  });
});

describe('transport data', () => {
  const en = parseDocs(utf16(EN)) as DocsClass[];
  const de = parseDocs(utf16(DE)) as DocsClass[];
  const data = buildTransportData(en, de, RAW, '1.2.5.0');
  const v = (id: string) => data.vehicles.find(x => x.id === id)!;

  it('takes slots from the Docs and fluid capacity from slot size times the blueprint multiplier', () => {
    expect(data.vehicles.map(x => x.id)).toEqual(['tractor', 'truck', 'explorer', 'fluidTruck', 'drone', 'freightCar']);
    expect(v('truck')).toEqual({
      id: 'truck', name: { en: 'Truck', de: 'Lkw' }, slots: 48, fluidCapacity: null, stopSeconds: 16, stopSource: 'truckStation',
      straightPathSpeed: 25, tractionSpeed: 26.2, fuel: { source: 'autopilot', perMetreMJ: 5, perTripMJ: 0, fuels: null },
    });
    expect(v('fluidTruck')).toMatchObject({ slots: null, fluidCapacity: 3200, straightPathSpeed: 25, tractionSpeed: 26.2 });
    expect(v('freightCar')).toMatchObject({ slots: 32, fluidCapacity: 2400, stopSeconds: 54, stopSource: 'freightPlatform', straightPathSpeed: null, tractionSpeed: null, fuel: null });
  });

  it('derives the stop times: station cycle at both ends, platform load + unload, drone docking + take-off twice', () => {
    expect(v('tractor').stopSeconds).toBe(16); // 2 x 8 s, whatever the inventory
    expect(v('explorer').stopSeconds).toBe(16);
    expect(v('fluidTruck')).toMatchObject({ stopSeconds: 18, stopSource: 'fluidTruckStation' }); // 2 x 9 s
    expect(v('drone')).toMatchObject({ slots: 9, stopSeconds: 102, stopSource: 'dronePort', straightPathSpeed: null, tractionSpeed: null });
  });

  it('takes the speeds where the tractive effort ends', () => {
    expect([v('tractor'), v('explorer')].map(x => [x.straightPathSpeed, x.tractionSpeed])).toEqual([[25, 19.6], [28, 27.9]]);
  });

  it('burns fuel per distance on autopilot: mAutopilotFuelConsumption per cm, as MJ per metre', () => {
    for (const id of ['tractor', 'truck', 'explorer', 'fluidTruck']) expect(v(id).fuel).toEqual({ source: 'autopilot', perMetreMJ: 5, perTripMJ: 0, fuels: null });
    expect(data.fuels).toEqual([
      { id: 'Desc_Coal_C', name: { en: 'Coal', de: 'Coal' }, energyMJ: 300 },
      { id: 'Desc_Fuel_C', name: { en: 'Packaged Fuel', de: 'Abgefüllter Treibstoff' }, energyMJ: 750 },
      { id: 'Desc_Battery_C', name: { en: 'Battery', de: 'Battery' }, energyMJ: 6000 },
      { id: 'Desc_PlutoniumFuelRod_C', name: { en: 'Plutonium Fuel Rod', de: 'Plutoniumbrennstab' }, energyMJ: 1_500_000 },
    ]);
  });

  it("gives the drone the Drone Port's trip cost and its own fuels with their travel speed in m/s", () => {
    expect(v('drone').fuel).toEqual({
      source: 'dronePort', perMetreMJ: 6, perTripMJ: 24_000,
      fuels: [{ id: 'Desc_Battery_C', speed: 75 }, { id: 'Desc_Fuel_C', speed: 50 }, { id: 'Desc_PlutoniumFuelRod_C', speed: 100 }],
    });
  });

  it('lists the items sorted by English name, German name with English fallback', () => {
    expect(data.items.map(i => i.name.en)).toEqual(['Battery', 'Coal', 'Fuel', 'Iron Plate', 'Nitrogen Gas', 'Packaged Fuel', 'Plutonium Fuel Rod', 'Water']);
    expect(data.items.find(i => i.id === 'Desc_IronPlate_C')!.name).toEqual({ en: 'Iron Plate', de: 'Eisenplatte' });
    expect(data.gameVersion).toBe('1.2.5.0');
  });

  it('fails when the Docs and the blueprints disagree', () => {
    const wrong = { vehicles: RAW.vehicles.map(x => x.class === 'BP_Truck_C' ? { ...x, inventorySize: 40 } : x) };
    expect(() => buildTransportData(en, de, wrong, 'v')).toThrow(/inventory 48, blueprint 40/);
    const multiplier = { vehicles: RAW.vehicles.map(x => x.class === 'BP_FluidTruck_C' ? { ...x, fluidStackSizeMultiplier: 32 } : x) };
    expect(() => buildTransportData(en, de, multiplier, 'v')).toThrow(/computed 1600 m³, description says 3200 m³/);
    expect(() => buildTransportData(en, de, { vehicles: RAW.vehicles.slice(1) }, 'v')).toThrow(/BP_Tractor_C/);
  });

  it('fails on drone fuels it cannot use and on an extractor output from an older patch', () => {
    const drone = (droneFuelTypes: RawTransport['vehicles'][number]['droneFuelTypes']) => ({ vehicles: RAW.vehicles.map(x => x.class === 'BP_DroneTransport_C' ? { ...x, droneFuelTypes } : x) });
    expect(() => buildTransportData(en, de, drone([{ item: 'Desc_Water_C', travelSpeed: 5000 }]), 'v')).toThrow(/Desc_Water_C is no solid fuel/);
    expect(() => buildTransportData(en, de, drone([{ item: 'Desc_Fuel_C', travelSpeed: null }]), 'v')).toThrow(/no travel speed/);
    expect(() => buildTransportData(en, de, drone(null), 'v')).toThrow(/no droneFuelTypes/);
    const old = { vehicles: RAW.vehicles.map(({ tractionSpeedLimit: _, droneFuelTypes: __, ...x }) => x) } as unknown as RawTransport;
    expect(() => buildTransportData(en, de, old, 'v')).toThrow(/older patch/);
  });
});
