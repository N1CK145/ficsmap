import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseDocs } from '../../scripts/game-docs.js';
import { buildMachineData, displayName, MachineBuildError, machineSummary, writeMachines } from '../../scripts/machines.js';
import type { MachineData } from '../../src/shared/machines.js';

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

// A miniature of the game's CommunityResources/Docs/*.json: the structure and value syntax of 1.2.5.0,
// cut down to the fields the builder reads; the numbers are the game's.
const path = (cls: string) => `/Script/Engine.BlueprintGeneratedClass'/Game/FactoryGame/X/${cls.slice(0, -2)}.${cls}'`;
const io = (list: [string, number][]) => `(${list.map(([c, a]) => `(ItemClass="${path(c)}",Amount=${a})`).join(',')})`;
const produced = (...cls: string[]) => `(${cls.map(c => `"/Game/FactoryGame/X/${c.slice(0, -2)}.${c}"`).join(',')})`;
const native = (n: string) => `/Script/CoreUObject.Class'/Script/FactoryGame.${n}'`;
const recipes = (...list: string[]) => `(${list.map(r => `"${path(r)}"`).join(',')})`;
const clock = { mCanChangePotential: 'True', mMinPotential: '0.010000', mMaxPotential: '1.000000' };

function docs(lang: 'en' | 'de') {
  const n = (en: string, de: string) => (lang === 'en' ? en : de);
  const build = (id: string, product: string, ingredients: [string, number][], place = 'BP_BuildGun_C') => ({
    ClassName: id, mDisplayName: n(id, id), mIngredients: io(ingredients), mProduct: io([[product, 1]]),
    mManufactoringDuration: '1.000000', mProducedIn: produced(place),
  });
  return [
    { NativeClass: native('FGItemDescriptor'), Classes: [
      { ClassName: 'Desc_IronPlate_C', mDisplayName: n('Iron Plate', 'Eisenplatte'), mForm: 'RF_SOLID' },
      { ClassName: 'Desc_IronIngot_C', mDisplayName: n('Iron Ingot', 'Eisenbarren'), mForm: 'RF_SOLID' },
      { ClassName: 'Desc_Coal_C', mDisplayName: n('Coal', 'Kohle'), mForm: 'RF_SOLID', mEnergyValue: '300.000000' },
      { ClassName: 'Desc_Water_C', mDisplayName: n('Water', 'Wasser'), mForm: 'RF_LIQUID' },
      { ClassName: 'Desc_NuclearFuelRod_C', mDisplayName: n('Uranium Fuel Rod', 'Uran-Brennstab'), mForm: 'RF_SOLID', mEnergyValue: '750000.000000' },
      { ClassName: 'Desc_NuclearWaste_C', mDisplayName: n('Uranium Waste', 'Uranabfall'), mForm: 'RF_SOLID' },
      // The German file breaks this name with a hyphen and a line break
      { ClassName: 'Desc_PlutoniumFuelRod_C', mDisplayName: n('Plutonium Fuel Rod', 'Plutonium- \r\nbrennstab'), mForm: 'RF_SOLID', mEnergyValue: '1500000.000000' },
      { ClassName: 'Desc_PlutoniumWaste_C', mDisplayName: n('Plutonium Waste', 'Plutonium-Abfall'), mForm: 'RF_SOLID' },
      { ClassName: 'Desc_LiquidFuel_C', mDisplayName: n('Fuel', 'Treibstoff'), mForm: 'RF_LIQUID', mEnergyValue: '0.750000' },
      { ClassName: 'Desc_Dark_C', mDisplayName: n('Dark Matter', 'Dunkle Materie'), mForm: 'RF_GAS' },
    ] },
    { NativeClass: native('FGItemDescriptorPowerBoosterFuel'), Classes: [
      { ClassName: 'Desc_AlienPowerFuel_C', mDisplayName: n('Alien Power Matrix', 'Alien-Energiematrix'), mForm: 'RF_SOLID', mEnergyValue: '0.000000',
        mBoostPercentage: '0.200000', mBoostDuration: '12.000000' },
    ] },
    { NativeClass: native('FGBuildingDescriptor'), Classes: [
      { ClassName: 'Desc_ConstructorMk1_C', mMenuPriority: '1.000000' },
    ] },
    { NativeClass: native('FGRecipe'), Classes: [
      { ClassName: 'Recipe_IronPlate_C', mDisplayName: n('Iron Plate', 'Eisenplatte'), mIngredients: io([['Desc_IronIngot_C', 3]]),
        mProduct: io([['Desc_IronPlate_C', 2]]), mManufactoringDuration: '6.000000',
        mProducedIn: produced('Build_ConstructorMk1_C', 'BP_WorkBenchComponent_C'),
        mVariablePowerConsumptionConstant: '0.000000', mVariablePowerConsumptionFactor: '1.000000' },
      { ClassName: 'Recipe_Alternate_Dark_C', mDisplayName: n('Alternate: Dark Plate', 'Alternativ: Dunkle Platte'),
        mIngredients: io([['Desc_IronPlate_C', 1]]), mProduct: io([['Desc_Dark_C', 10000]]), mManufactoringDuration: '30.000000',
        mProducedIn: produced('Build_HadronCollider_C'), mVariablePowerConsumptionConstant: '500.000000', mVariablePowerConsumptionFactor: '1000.000000' },
      build('Recipe_ConstructorMk1_C', 'Desc_ConstructorMk1_C', [['Desc_IronPlate_C', 2]]),
      build('Recipe_SmelterMk1_C', 'Desc_SmelterMk1_C', [['Desc_IronPlate_C', 5]]),
      build('Recipe_HadronCollider_C', 'Desc_HadronCollider_C', [['Desc_IronPlate_C', 500]]),
      build('Recipe_FrackingExtractor_C', 'Desc_FrackingExtractor_C', [['Desc_IronPlate_C', 10]]),
      build('Recipe_GeneratorGeoThermal_C', 'Desc_GeneratorGeoThermal_C', [['Desc_IronPlate_C', 50]]),
      build('Recipe_AlienPowerBuilding_C', 'Desc_AlienPowerBuilding_C', [['Desc_IronPlate_C', 10]]),
      build('Recipe_DroneStation_C', 'Desc_DroneStation_C', [['Desc_IronPlate_C', 20]]),
      build('Recipe_MinerMk1_C', 'Desc_MinerMk1_C', [['Desc_IronPlate_C', 10]]),
      build('Recipe_WaterPump_C', 'Desc_WaterPump_C', [['Desc_IronPlate_C', 20]]),
      build('Recipe_GeneratorCoal_C', 'Desc_GeneratorCoal_C', [['Desc_IronPlate_C', 20]]),
      build('Recipe_GeneratorNuclear_C', 'Desc_GeneratorNuclear_C', [['Desc_IronPlate_C', 100]]),
      build('Recipe_TruckStation_C', 'Desc_TruckStation_C', [['Desc_IronPlate_C', 15]]),
      build('Recipe_Valve_C', 'Desc_Valve_C', [['Desc_IronPlate_C', 1]]),
      build('Recipe_ResourceSink_C', 'Desc_ResourceSink_C', [['Desc_IronPlate_C', 15]]),
      build('Recipe_Truck_C', 'Desc_Truck_C', [['Desc_IronPlate_C', 20]]),
      build('Recipe_FluidTruck_C', 'Desc_FluidTruck_C', [['Desc_IronPlate_C', 20]]),
      build('Recipe_Locomotive_C', 'Desc_Locomotive_C', [['Desc_IronPlate_C', 5]]),
      build('Recipe_FactoryCart_C', 'Desc_GolfCart_C', [['Desc_IronPlate_C', 4]], 'BP_WorkshopComponent_C'),
    ] },
    { NativeClass: native('FGSchematic'), Classes: [
      { ClassName: 'Schematic_Tutorial2_C', mType: 'EST_Tutorial', mDisplayName: n('HUB Upgrade 3', 'HUB-Upgrade 3'), mTechTier: '0',
        mUnlocks: [{ Class: 'BP_UnlockRecipe_C', mRecipes: recipes('Recipe_ConstructorMk1_C', 'Recipe_MinerMk1_C') }] },
      { ClassName: 'Schematic_6-1_C', mType: 'EST_Milestone', mDisplayName: n('Logistics Mk.4', 'Logistik Mk.4'), mTechTier: '5',
        mUnlocks: [{ Class: 'BP_UnlockRecipe_C', mRecipes: recipes('Recipe_Truck_C', 'Recipe_FluidTruck_C') }, { Class: 'BP_UnlockScannableResource_C' }] },
      { ClassName: 'Schematic_7-4_C', mType: 'EST_Milestone', mDisplayName: n('Aeronautical Engineering', 'Luft- und Raumfahrttechnik'), mTechTier: '8',
        mUnlocks: [{ Class: 'BP_UnlockRecipe_C', mRecipes: recipes('Recipe_DroneStation_C') }] },
      { ClassName: 'ResourceSink_FactoryCart_C', mType: 'EST_ResourceSink', mDisplayName: n('FICSIT Factory Cart™', 'FICSIT-Fabrikwagen™'), mTechTier: '1',
        mUnlocks: [{ Class: 'BP_UnlockRecipe_C', mRecipes: recipes('Recipe_FactoryCart_C') }] },
    ] },
    { NativeClass: native('FGBuildableManufacturer'), Classes: [
      { ClassName: 'Build_ConstructorMk1_C', mDisplayName: n('Constructor', 'Konstruktor'), mDescription: n('Crafts 1 part into another part.\r\n', 'Verarbeitet ein Teil.'),
        mPowerConsumption: '4.000000', mPowerConsumptionExponent: '1.321929', mCanChangeProductionBoost: 'True', mProductionShardSlotSize: '1',
        mProductionShardBoostMultiplier: '1.000000', mOverrideProductionShardSlotSize: 'False', ...clock },
      // mProductionShardSlotSize 0 without the override flag, but 1 Somersloop slot in the game
      { ClassName: 'Build_SmelterMk1_C', mDisplayName: n('Smelter', 'Schmelzofen'), mDescription: 'x',
        mPowerConsumption: '4.000000', mPowerConsumptionExponent: '1.321929', mCanChangeProductionBoost: 'True', mProductionShardSlotSize: '0',
        mProductionShardBoostMultiplier: '1.000000', mOverrideProductionShardSlotSize: 'False', ...clock },
    ] },
    { NativeClass: native('FGBuildableManufacturerVariablePower'), Classes: [
      { ClassName: 'Build_HadronCollider_C', mDisplayName: n('Particle Accelerator', 'Teilchenbeschleuniger'), mDescription: 'x',
        mPowerConsumption: '0.000000', mEstimatedMininumPowerConsumption: '250.000000', mEstimatedMaximumPowerConsumption: '1500.000000',
        mPowerConsumptionExponent: '1.321929', mCanChangeProductionBoost: 'True', mProductionShardSlotSize: '4',
        mProductionShardBoostMultiplier: '0.250000', mOverrideProductionShardSlotSize: 'True', ...clock },
    ] },
    { NativeClass: native('FGBuildableResourceExtractor'), Classes: [
      { ClassName: 'Build_MinerMk1_C', mDisplayName: n('Miner Mk.1', 'Miner Mk.1'), mDescription: 'x', mPowerConsumption: '5.000000',
        mPowerConsumptionExponent: '1.321929', mExtractCycleTime: '1.000000', mItemsPerCycle: '1', mAllowedResourceForms: '(RF_SOLID)',
        mOnlyAllowCertainResources: 'False', ...clock },
    ] },
    { NativeClass: native('FGBuildableWaterPump'), Classes: [
      { ClassName: 'Build_WaterPump_C', mDisplayName: n('Water Extractor', 'Wasserextraktor'), mDescription: 'x', mPowerConsumption: '20.000000',
        mExtractCycleTime: '1.000000', mItemsPerCycle: '2000', mAllowedResourceForms: '(RF_LIQUID)', mOnlyAllowCertainResources: 'True',
        mAllowedResources: `("${path('Desc_Water_C')}")` },
    ] },
    { NativeClass: native('FGBuildableFrackingExtractor'), Classes: [
      { ClassName: 'Build_FrackingExtractor_C', mDisplayName: n('Resource Well Extractor', 'Quellenextraktor'), mDescription: 'x', mPowerConsumption: '0.000000',
        mPowerConsumptionExponent: '1.321929', mExtractCycleTime: '1.000000', mItemsPerCycle: '1000', mAllowedResourceForms: '(RF_LIQUID,RF_GAS)',
        mOnlyAllowCertainResources: 'True', mAllowedResources: `("${path('Desc_Water_C')}")`, ...clock },
    ] },
    { NativeClass: native('FGBuildableGeneratorFuel'), Classes: [
      { ClassName: 'Build_GeneratorCoal_C', mDisplayName: n('Coal-Powered Generator', 'Kohlegenerator'), mDescription: 'x', mPowerConsumption: '0.000000',
        mPowerProduction: '75.000000', mRequiresSupplementalResource: 'True', mSupplementalToPowerRatio: '10.000000', ...clock,
        mFuel: [{ mFuelClass: 'Desc_Coal_C', mSupplementalResourceClass: 'Desc_Water_C', mByproduct: '', mByproductAmount: '' }] },
    ] },
    { NativeClass: native('FGBuildableGeneratorNuclear'), Classes: [
      { ClassName: 'Build_GeneratorNuclear_C', mDisplayName: n('Nuclear Power Plant', 'Atomkraftwerk'), mDescription: 'x', mPowerProduction: '2500.000000',
        mRequiresSupplementalResource: 'True', mSupplementalToPowerRatio: '1.600000',
        mFuel: [
          { mFuelClass: 'Desc_NuclearFuelRod_C', mSupplementalResourceClass: 'Desc_Water_C', mByproduct: 'Desc_NuclearWaste_C', mByproductAmount: '50' },
          { mFuelClass: 'Desc_PlutoniumFuelRod_C', mSupplementalResourceClass: 'Desc_Water_C', mByproduct: 'Desc_PlutoniumWaste_C', mByproductAmount: '10' },
        ] },
    ] },
    { NativeClass: native('FGBuildableGeneratorGeoThermal'), Classes: [
      { ClassName: 'Build_GeneratorGeoThermal_C', mDisplayName: n('Geothermal Generator', 'Geothermie-Generator'), mDescription: 'x', mPowerConsumption: '0.000000',
        mPowerProduction: '0.000000', mVariablePowerProductionConstant: '0.000000', mVariablePowerProductionFactor: '200.000000',
        mVariablePowerProductionCycleLength: '60.000000', mPowerConsumptionExponent: '1.600000', ...clock, mCanChangePotential: 'False' },
    ] },
    { NativeClass: native('FGBuildablePowerBooster'), Classes: [
      { ClassName: 'Build_AlienPowerBuilding_C', mDisplayName: n('Alien Power Augmenter', 'Alien-Energieverstärker'), mDescription: 'x', mPowerConsumption: '0.000000',
        mBasePowerProduction: '500.000000', mBaseBoostPercentage: '0.100000', mPowerConsumptionExponent: '1.600000', ...clock,
        mDefaultFuelClasses: '("/Game/FactoryGame/Resource/Parts/AlienPowerFuel/Desc_AlienPowerFuel.Desc_AlienPowerFuel_C")' },
    ] },
    { NativeClass: native('FGBuildableDockingStation'), Classes: [
      { ClassName: 'Build_TruckStation_C', mDisplayName: n('Truck Station', 'Lkw-Station'), mDescription: 'Transfers up to 120 stacks per minute.',
        mPowerConsumption: '20.000000', mStorageInventorySize: '48', mFuelInventorySize: '1', mLoadUnloadCycleLength: '8.000000' },
    ] },
    { NativeClass: native('FGBuildableDroneStation'), Classes: [
      { ClassName: 'Build_DroneStation_C', mDisplayName: n('Drone Port', 'Drohnenlandeplatz'), mDescription: 'x', mPowerConsumption: '100.000000',
        mPowerConsumptionExponent: '1.600000', mStorageSizeX: '3', mStorageSizeY: '6', mFuelStorageSizeX: '1', mFuelStorageSizeY: '1', ...clock },
    ] },
    { NativeClass: native('FGBuildablePipelinePump'), Classes: [
      { ClassName: 'Build_Valve_C', mDisplayName: n('Valve', 'Ventil'), mDescription: 'x', mPowerConsumption: '0.000000' },
    ] },
    { NativeClass: native('FGBuildableResourceSink'), Classes: [
      { ClassName: 'Build_ResourceSink_C', mDisplayName: n('AWESOME Sink', 'AWESOME-Schredder'), mDescription: 'x', mPowerConsumption: '30.000000' },
    ] },
    { NativeClass: native('FGVehicleDescriptor'), Classes: [
      { ClassName: 'Desc_Truck_C', mDisplayName: n('Truck', 'Lkw'), mDescription: 'x', mManualFuelConsumption: '75.000000', mInventorySize: '48', mIsFluidStorageInventory: 'False', mMenuPriority: '2.000000' },
      { ClassName: 'Desc_FluidTruck_C', mDisplayName: n('Fluid Truck', 'Tanklaster'), mDescription: 'x', mManualFuelConsumption: '75.000000', mInventorySize: '1', mIsFluidStorageInventory: 'True', mMenuPriority: '2.100000' },
      { ClassName: 'Desc_Locomotive_C', mDisplayName: n('Electric Locomotive', 'Elektrolokomotive'), mDescription: 'x', mPowerConsumption: '(Min=25.000000,Max=110.000000)' },
    ] },
    { NativeClass: native('FGEquipmentDescriptor'), Classes: [
      { ClassName: 'Desc_GolfCart_C', mDisplayName: n('Factory Cart™', 'Fabrikwagen™'), mDescription: 'x', mForm: 'RF_SOLID' },
    ] },
  ];
}

const build = (): MachineData => buildMachineData(parseDocs(utf16(docs('en'))), parseDocs(utf16(docs('de'))));
const entry = (d: MachineData, id: string) => {
  const e = d.machines.find(m => m.id === id);
  if (!e) throw new Error(`no entry ${id}`);
  return e;
};

describe('machine wiki data', () => {
  it('takes one entry per machine and vehicle, grouped by category, without unpowered logistics parts', () => {
    const d = build();
    expect(d.format).toBe(1);
    expect(d.machines.map(m => `${m.category}:${m.id}`)).toEqual([
      // Unlocked first, then the others by name (the fixture has no menu priorities for buildings but the Constructor's)
      'production:Build_ConstructorMk1_C', 'production:Build_HadronCollider_C', 'production:Build_SmelterMk1_C',
      'extraction:Build_MinerMk1_C', 'extraction:Build_FrackingExtractor_C', 'extraction:Build_WaterPump_C',
      'power:Build_AlienPowerBuilding_C', 'power:Build_GeneratorCoal_C', 'power:Build_GeneratorGeoThermal_C', 'power:Build_GeneratorNuclear_C',
      'logistics:Build_DroneStation_C', 'logistics:Build_TruckStation_C',
      'special:Build_ResourceSink_C',
      // Unlocked in tier 5 (by menu priority), then the locomotive without a known unlock, then the shop's cart
      'vehicles:Desc_Truck_C', 'vehicles:Desc_FluidTruck_C', 'vehicles:Desc_Locomotive_C', 'vehicles:Desc_GolfCart_C',
    ]);
  });

  it('has names and the game description in both languages, and a wiki page from the English name', () => {
    const c = entry(build(), 'Build_ConstructorMk1_C');
    expect(c.name).toEqual({ en: 'Constructor', de: 'Konstruktor' });
    expect(c.description).toEqual({ en: 'Crafts 1 part into another part.', de: 'Verarbeitet ein Teil.' });
    expect(c.wikiPage).toBe('Constructor');
    expect(entry(build(), 'Build_GeneratorCoal_C').wikiPage).toBe('Coal-Powered_Generator');
    expect(entry(build(), 'Desc_GolfCart_C').wikiPage).toBe('Factory_Cart');
  });

  it('reads power, clock range, power exponent and Somersloop slots', () => {
    const d = build();
    expect(entry(d, 'Build_ConstructorMk1_C').stats).toEqual({
      powerUse: 4, clock: { min: 0.01, max: 1 }, powerExponent: 1.321929, somersloopSlots: 1,
    });
    expect(entry(d, 'Build_HadronCollider_C').stats.powerUseRange).toEqual({ min: 250, max: 1500 });
    expect(entry(d, 'Build_HadronCollider_C').stats.powerUse).toBeUndefined();
  });

  it('takes Somersloop slots from the boost multiplier, not from the slot size without its override flag', () => {
    const d = build();
    expect(entry(d, 'Build_SmelterMk1_C').stats.somersloopSlots).toBe(1);
    expect(entry(d, 'Build_HadronCollider_C').stats.somersloopSlots).toBe(4);
    const half = docs('en').map(g => ({ ...g, Classes: g.Classes.map(c => (c.ClassName === 'Build_HadronCollider_C'
      ? { ...c, mProductionShardBoostMultiplier: '0.500000', mProductionShardSlotSize: '2' }
      : c)) }));
    expect(entry(buildMachineData(parseDocs(utf16(half)), parseDocs(utf16(docs('de')))), 'Build_HadronCollider_C').stats.somersloopSlots).toBe(2);
  });

  it('leaves out clock speed and power exponent where the game has no clock speed setting despite the Docs', () => {
    const d = build();
    expect(entry(d, 'Build_AlienPowerBuilding_C').stats.clock).toBeUndefined();
    expect(entry(d, 'Build_FrackingExtractor_C').stats.clock).toBeUndefined();
    expect(entry(d, 'Build_DroneStation_C').stats).toEqual({ powerUse: 100, storageSlots: 18, fuelSlots: 1 });
    expect(entry(d, 'Build_GeneratorGeoThermal_C').stats.clock).toBeUndefined();
  });

  it('reads the geothermal average production and cycle', () => {
    expect(entry(build(), 'Build_GeneratorGeoThermal_C').stats).toEqual({ powerVariable: { average: 200, cycleSeconds: 60 } });
  });

  it('computes extraction rates, fluids in m³', () => {
    const d = build();
    expect(entry(d, 'Build_MinerMk1_C').stats).toMatchObject({ extractionPerMinute: 60, extractionFluid: false, extractionNode: true, resourceForms: ['solid'] });
    expect(entry(d, 'Build_WaterPump_C').stats).toMatchObject({ extractionPerMinute: 120, extractionFluid: true, extractionNode: false, resources: ['Desc_Water_C'] });
    expect(entry(d, 'Build_FrackingExtractor_C').stats).toEqual({ extractionPerMinute: 60, extractionFluid: true, extractionNode: true, resources: ['Desc_Water_C'] });
  });

  it('computes fuel, supplement and by-product per minute of generators from energy values', () => {
    const d = build();
    expect(entry(d, 'Build_GeneratorCoal_C').stats.fuels).toEqual([
      { item: 'Desc_Coal_C', perMinute: 15, supplement: { item: 'Desc_Water_C', amount: 45 } },
    ]);
    expect(entry(d, 'Build_GeneratorNuclear_C').stats.fuels).toEqual([
      { item: 'Desc_NuclearFuelRod_C', perMinute: 0.2, supplement: { item: 'Desc_Water_C', amount: 240 }, byproduct: { item: 'Desc_NuclearWaste_C', amount: 10 } },
      { item: 'Desc_PlutoniumFuelRod_C', perMinute: 0.1, supplement: { item: 'Desc_Water_C', amount: 240 }, byproduct: { item: 'Desc_PlutoniumWaste_C', amount: 1 } },
    ]);
    expect(entry(d, 'Build_GeneratorCoal_C').stats.powerProduction).toBe(75);
    expect(entry(d, 'Build_GeneratorCoal_C').stats.powerExponent).toBeUndefined();
  });

  it('gives the Alien Power Augmenter its fuel per minute from the boost duration, and the fuel boost', () => {
    expect(entry(build(), 'Build_AlienPowerBuilding_C').stats).toEqual({
      powerProduction: 500, gridBoost: 0.1, fuels: [{ item: 'Desc_AlienPowerFuel_C', perMinute: 5, boost: 0.2 }],
    });
  });

  it('reads vehicle fuel burn, inventories and the locomotive power range; a fluid tank has no capacity in the data', () => {
    const d = build();
    expect(entry(d, 'Desc_Truck_C').stats).toEqual({ fuelBurn: 75, inventorySlots: 48 });
    expect(entry(d, 'Desc_FluidTruck_C').stats).toEqual({ fuelBurn: 75, fluidStorage: true });
    expect(entry(d, 'Desc_Locomotive_C').stats).toEqual({ powerUseRange: { min: 25, max: 110 } });
    expect(entry(d, 'Desc_GolfCart_C').stats).toEqual({});
  });

  it('does not turn the truck station text into a transfer rate', () => {
    expect(entry(build(), 'Build_TruckStation_C').stats).toEqual({ powerUse: 20, inventorySlots: 48, fuelSlots: 1 });
  });

  it('adds build costs and unlocks; the Factory Cart is crafted in the workshop', () => {
    const d = build();
    expect(entry(d, 'Build_ConstructorMk1_C').build).toEqual({ place: 'buildGun', ingredients: [{ item: 'Desc_IronPlate_C', amount: 2 }] });
    expect(entry(d, 'Build_ConstructorMk1_C').unlockedBy).toEqual([{ kind: 'tutorial', name: { en: 'HUB Upgrade 3', de: 'HUB-Upgrade 3' }, tier: 0 }]);
    expect(entry(d, 'Desc_Truck_C').unlockedBy).toEqual([{ kind: 'milestone', name: { en: 'Logistics Mk.4', de: 'Logistik Mk.4' }, tier: 5 }]);
    expect(entry(d, 'Desc_GolfCart_C').build?.place).toBe('workshop');
    expect(entry(d, 'Desc_GolfCart_C').unlockedBy[0]?.kind).toBe('shop');
    expect(entry(d, 'Desc_Locomotive_C').unlockedBy).toEqual([]);
    expect(entry(d, 'Build_DroneStation_C').unlockedBy).toEqual([{ kind: 'milestone', name: { en: 'Aeronautical Engineering', de: 'Luft- und Raumfahrttechnik' }, tier: 8 }]);
  });

  it('joins a German name the game breaks with a hyphen and a line break', () => {
    expect(build().items.Desc_PlutoniumFuelRod_C?.name).toEqual({ en: 'Plutonium Fuel Rod', de: 'Plutoniumbrennstab' });
    expect(displayName('Plutonium- \r\nbrennstab')).toBe('Plutoniumbrennstab');
    expect(displayName('Plutonium-\nbrennstab')).toBe('Plutoniumbrennstab');
    // The hyphen goes only before a lower-case letter and only across a line break
    expect(displayName('Luft- und Raumfahrttechnik')).toBe('Luft- und Raumfahrttechnik');
    expect(displayName('Uran-\r\nBrennstab')).toBe('Uran-Brennstab');
    expect(displayName(' Two\r\nlines ')).toBe('Two lines');
  });

  it('lists the recipes of production buildings in the planner shape, fluids in m³', () => {
    const d = build();
    expect(d.recipes).toEqual([
      { id: 'Recipe_IronPlate_C', name: { en: 'Iron Plate', de: 'Eisenplatte' }, alternate: false, machine: 'Build_ConstructorMk1_C', duration: 6,
        ingredients: [{ item: 'Desc_IronIngot_C', amount: 3 }], products: [{ item: 'Desc_IronPlate_C', amount: 2 }] },
      { id: 'Recipe_Alternate_Dark_C', name: { en: 'Alternate: Dark Plate', de: 'Alternativ: Dunkle Platte' }, alternate: true,
        machine: 'Build_HadronCollider_C', duration: 30, ingredients: [{ item: 'Desc_IronPlate_C', amount: 1 }],
        products: [{ item: 'Desc_Dark_C', amount: 10 }], power: { min: 500, max: 1500 } },
    ]);
    expect(d.items.Desc_Dark_C).toEqual({ name: { en: 'Dark Matter', de: 'Dunkle Materie' }, form: 'gas' });
    expect(d.items.Desc_IronPlate_C?.name.de).toBe('Eisenplatte');
  });

  it('falls back to English when de.json lacks a class, and reports it', () => {
    const en = parseDocs(utf16(docs('en')));
    expect(() => buildMachineData(en, [])).toThrow(MachineBuildError);
    try { buildMachineData(en, []); } catch (e) {
      expect((e as MachineBuildError).problems).toContain('Build_ConstructorMk1_C is missing in de.json');
    }
  });

  it('fails on a missing category or a fuel that is no item', () => {
    const en = docs('en').filter(g => !g.NativeClass.includes('FGBuildableResourceSink'));
    expect(() => buildMachineData(parseDocs(utf16(en)), parseDocs(utf16(docs('de'))))).toThrow(/no special entries found/);
    const broken = docs('en').map(g => (g.NativeClass.includes('GeneratorFuel')
      ? { ...g, Classes: g.Classes.map(c => ({ ...c, mFuel: [{ mFuelClass: 'Desc_Nope_C', mSupplementalResourceClass: '', mByproduct: '', mByproductAmount: '' }] })) }
      : g));
    expect(() => buildMachineData(parseDocs(utf16(broken)), parseDocs(utf16(docs('de'))))).toThrow(/Desc_Nope_C, which is no item/);
  });

  it('writes machines.json from a Docs folder', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ficsmap-docs-'));
    try {
      writeFileSync(join(dir, 'en-US.json'), utf16(docs('en')));
      writeFileSync(join(dir, 'de.json'), utf16(docs('de')));
      const data = writeMachines(dir, join(dir, 'out'));
      expect(JSON.parse(readFileSync(join(dir, 'out', 'machines.json'), 'utf8'))).toEqual(data);
      expect(machineSummary(data)).toBe('17 entries (3 production, 3 extraction, 4 power, 2 logistics, 1 special, 4 vehicles), 2 recipes, 10 items');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
