import { render, screen, within } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import { initI18n } from '../../src/web/app/i18n/index.js';
import type { FactoryLabels } from '../../src/web/features/factory/data.js';
import type { FactoryFormat } from '../../src/web/features/factory/format.js';
import { SplitterWindow } from '../../src/web/features/factory/SplitterWindow.js';

const labels = { item: (cls: string) => (cls === 'Desc_Gunpowder_C' ? 'Schwarzpulver' : cls) } as unknown as FactoryLabels;
const fmt = { lang: 'de' } as unknown as FactoryFormat;

beforeAll(() => { initI18n(['de']); });

describe('SplitterWindow', () => {
  it('lists per side the items, the filters by their game name and where the belt leads', () => {
    render(
      <SplitterWindow
        name="Intelligenter Splitter" picture="Build_ConveyorAttachmentSplitterSmart_C" labels={labels} fmt={fmt} onClose={() => {}}
        outputs={[
          { side: 'left', items: [], target: undefined },
          { side: 'center', items: ['Desc_Gunpowder_C'], target: 'Raffinerie' },
          { side: 'right', items: ['Desc_AnyUndefined_C'], target: 'Fließbandzusammenführer' },
        ]}
      />,
    );
    const left = within(screen.getByTestId('splitter-left'));
    expect(left.getByText('Links')).toBeTruthy();
    expect(left.getByText('Keine Regel')).toBeTruthy();
    expect(left.getByText(/nicht angeschlossen/)).toBeTruthy();
    const center = within(screen.getByTestId('splitter-center'));
    expect(center.getByText('Schwarzpulver')).toBeTruthy();
    expect(center.getByText('→ Raffinerie')).toBeTruthy();
    expect(within(screen.getByTestId('splitter-right')).getByText('Beliebig undefiniert')).toBeTruthy();
  });

  it('says so when the snapshot has no rules yet', () => {
    render(<SplitterWindow name="S" picture="x" labels={labels} fmt={fmt} onClose={() => {}} outputs={null} />);
    expect(screen.getByTestId('splitter-unknown')).toBeTruthy();
  });
});
