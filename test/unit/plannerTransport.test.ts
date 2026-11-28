import { transportTier, tierShort } from '../../src/shared/plannerTransport.js';
import { indexRecipes, type RecipeData } from '../../src/shared/recipes.js';
import { RECIPE_DATA } from '../fixtures/recipeData.js';

const n = (en: string) => ({ en, de: en });
// As in recipes.json of 1.2.5.0 (lifts and clean pipelines beside the belts and pipelines).
const DATA: RecipeData = {
  ...RECIPE_DATA,
  belts: [
    { id: 'Build_ConveyorBeltMk1_C', name: n('Conveyor Belt Mk.1'), kind: 'belt', rate: 60 },
    { id: 'Build_ConveyorLiftMk1_C', name: n('Conveyor Lift Mk.1'), kind: 'lift', rate: 60 },
    { id: 'Build_ConveyorBeltMk2_C', name: n('Conveyor Belt Mk.2'), kind: 'belt', rate: 120 },
    { id: 'Build_ConveyorBeltMk6_C', name: n('Conveyor Belt Mk.6'), kind: 'belt', rate: 1200 },
  ],
  pipes: [
    { id: 'Build_Pipeline_C', name: n('Pipeline Mk.1'), rate: 300 },
    { id: 'Build_Pipeline_NoIndicator_C', name: n('Clean Pipeline Mk.1'), rate: 300 },
    { id: 'Build_PipelineMK2_C', name: n('Pipeline Mk.2'), rate: 600 },
  ],
};
const IDX = indexRecipes(DATA);

describe('planner transport tiers', () => {
  it('picks the slowest belt that carries a solid flow, exactly at its rate too', () => {
    expect(transportTier(IDX, 'plate', 30)).toMatchObject({ kind: 'belt', id: 'Build_ConveyorBeltMk1_C', rate: 60, lines: 1 });
    expect(transportTier(IDX, 'plate', 60)?.id).toBe('Build_ConveyorBeltMk1_C');
    expect(transportTier(IDX, 'plate', 60 + 1e-9)?.id).toBe('Build_ConveyorBeltMk1_C');
    expect(transportTier(IDX, 'plate', 60.5)?.id).toBe('Build_ConveyorBeltMk2_C');
  });

  it('needs several lines of the fastest tier above it', () => {
    expect(transportTier(IDX, 'ore', 1200)).toMatchObject({ id: 'Build_ConveyorBeltMk6_C', lines: 1 });
    expect(transportTier(IDX, 'ore', 2500)).toMatchObject({ id: 'Build_ConveyorBeltMk6_C', lines: 3 });
  });

  it('picks pipelines for fluids, the one with flow indicator', () => {
    expect(transportTier(IDX, 'water', 300)).toMatchObject({ kind: 'pipe', id: 'Build_Pipeline_C', lines: 1 });
    expect(transportTier(IDX, 'gas', 450)).toMatchObject({ kind: 'pipe', id: 'Build_PipelineMK2_C' });
    expect(transportTier(IDX, 'fuel', 1500)).toMatchObject({ id: 'Build_PipelineMK2_C', lines: 3 });
  });

  it('has nothing for no flow or a dataset without belts and pipes', () => {
    expect(transportTier(IDX, 'plate', 0)).toBeUndefined();
    expect(transportTier(IDX, 'plate', Number.NaN)).toBeUndefined();
    expect(transportTier(indexRecipes(RECIPE_DATA), 'plate', 30)).toBeUndefined();
  });

  it('shortens a tier name to its Mk. number', () => {
    expect(tierShort('Förderband Mk.2')).toBe('Mk.2');
    expect(tierShort('Pipeline Mk.1')).toBe('Mk.1');
    expect(tierShort('Pipe')).toBe('Pipe');
  });
});
