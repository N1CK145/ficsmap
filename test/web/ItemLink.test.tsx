import { QueryClient } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import type { MeDto, WorldDto } from '../../src/shared/api.js';
import { indexDataset, type Dataset } from '../../src/shared/dataset.js';
import type { WorldCtx } from '../../src/web/app/feature.js';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { useUiStore } from '../../src/web/app/store.js';
import type { ToastInput } from '../../src/web/components/Toast.js';
import { itemPanelFeature } from '../../src/web/features/itemPanel/index.js';
import { ITEM_PARAM, itemLink, ItemLinkOpener } from '../../src/web/features/itemPanel/itemLink.js';

const W = '6f1c2b0e-8a43-4f5e-9d1b-2c3d4e5f6a7b';
const DS: Dataset = {
  version: 'test', build: 1, bounds: { minX: 0, minY: 0, maxX: 100_000, maxY: 100_000 }, mapId: 'm', podRequirementsKnown: true,
  biomes: [{ id: 'b', name: { en: 'B', de: 'B' } }],
  items: [['S1', 'somersloop', 80_000, 20_000, 0, 0, 1]],
  aliases: { S1_old: 'S1' },
};
const ME: MeDto = { id: 1, displayName: 'Nick', avatarUrl: null, email: null, datasetVersion: 'test' };

let search = '';
function Location() {
  search = useLocation().search;
  return null;
}

function open(url: string) {
  const toasts: ToastInput[] = [];
  const ctx: WorldCtx = {
    worldId: W, world: {} as WorldDto, me: ME, index: indexDataset(DS), queryClient: new QueryClient(),
    navigate: () => {}, toast: { show: t => { toasts.push(t); } },
  };
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes><Route path="/w/:id" element={<><ItemLinkOpener ctx={ctx} /><Location /></>} /></Routes>
    </MemoryRouter>,
  );
  return { toasts };
}

describe('item links', () => {
  beforeAll(() => { initI18n(['en']); });
  beforeEach(() => {
    useUiStore.getState().enterWorld(W);
    useUiStore.setState({ mainView: 'list', markersVisible: false });
  });

  it('builds /w/<world>?item=<actor> on this origin', () => {
    expect(itemLink(W, 'Persistent_Level:PersistentLevel.BP_Crystal_C_12')).toBe(
      `${window.location.origin}/w/${W}?${ITEM_PARAM}=Persistent_Level%3APersistentLevel.BP_Crystal_C_12`);
  });

  it('opens the map at the item from the link and selects it, then drops the parameter', () => {
    const { toasts } = open(`/w/${W}?item=S1&x=1`);
    const s = useUiStore.getState();
    expect(s.selectedActor).toBe('S1');
    expect(s.focusRequest).toEqual({ actor: 'S1' });
    expect(s.mainView).toBe('map');
    expect(s.markersVisible).toBe(true);
    expect(toasts).toEqual([]);
    expect(search).toBe('?x=1');
  });

  it('follows an old actor name to the item it became', () => {
    open(`/w/${W}?item=S1_old`);
    expect(useUiStore.getState().selectedActor).toBe('S1');
  });

  it('says so for an item the dataset does not have', () => {
    const { toasts } = open(`/w/${W}?item=Nope`);
    expect(useUiStore.getState().selectedActor).toBeNull();
    expect(toasts).toEqual([{ message: 'The linked object is not on this map.' }]);
    expect(search).toBe('');
  });

  it('is part of the item panel feature, on every world view', () => {
    expect(itemPanelFeature.headerItems).toEqual([expect.objectContaining({ id: 'item-link', Component: ItemLinkOpener })]);
    expect(itemPanelFeature.headerItems?.[0]?.mapOnly).toBeFalsy();
  });
});
