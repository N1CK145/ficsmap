import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { initI18n } from '../../src/web/app/i18n/index.js';
import { Badge, badgeClass } from '../../src/web/components/Badge.js';
import { Button } from '../../src/web/components/Button.js';
import { fieldClass, NumberField } from '../../src/web/components/Field.js';
import { Fold } from '../../src/web/components/Fold.js';
import { Header } from '../../src/web/components/Header.js';
import { PageActions, PageActionsSlot, PageBackSlot, usePageBack, type PageBackTarget } from '../../src/web/components/PageActions.js';
import { SectionHeading } from '../../src/web/components/SectionHeading.js';
import { StatList, StatRow, StatTile, TileValue } from '../../src/web/components/StatRow.js';
import { Window, WindowTitleBar } from '../../src/web/components/Window.js';
import { MemoryRouter } from 'react-router';

const classes = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/);

describe('Window', () => {
  beforeAll(() => { initI18n(['en']); });

  it('is a region named by its title, with the title as a heading, its content and a footer', () => {
    render(
      <Window title="Constructor" subtitle="Tier 0" footer={<Button>Apply</Button>}>
        <p>Body</p>
      </Window>,
    );
    const win = screen.getByRole('region', { name: 'Constructor' });
    expect(within(win).getByRole('heading', { level: 2, name: 'Constructor' })).toBeInTheDocument();
    expect(within(win).getByText('Tier 0')).toBeInTheDocument();
    expect(within(win).getByText('Body')).toBeInTheDocument();
    expect(within(win).getByRole('button', { name: 'Apply' })).toBeInTheDocument();
    expect(within(win).queryByRole('button', { name: 'Close' })).toBeNull();
  });

  it('shows a close button only with onClose, and calls it', async () => {
    const onClose = vi.fn();
    render(<Window title="Info" as="aside" onClose={onClose}>x</Window>);
    await userEvent.click(within(screen.getByRole('complementary', { name: 'Info' })).getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('title bar: accent rule by default, conflict rule for the danger tone, level 3 on request', () => {
    const { container } = render(<><WindowTitleBar title="A" /><WindowTitleBar title="B" tone="danger" level={3} /></>);
    const [a, b] = [...container.children];
    expect(classes(a!)).toContain('border-t-accent');
    expect(classes(b!)).toContain('border-t-conflict');
    expect(screen.getByRole('heading', { level: 3, name: 'B' })).toBeInTheDocument();
  });
});

describe('SectionHeading', () => {
  it('renders the heading at the level asked, with the extra at the end outside the heading', () => {
    render(<SectionHeading as="h3" end="3/5">Nearby</SectionHeading>);
    const heading = screen.getByRole('heading', { level: 3 });
    expect(heading).toHaveTextContent(/^Nearby$/);
    expect(screen.getByText('3/5')).toBeInTheDocument();
  });
});

describe('Badge', () => {
  it('shows its text and takes the tone colours', () => {
    render(<Badge tone="danger">Conflict</Badge>);
    expect(classes(screen.getByText('Conflict'))).toContain('text-conflict');
    expect(badgeClass('accent')).toContain('text-accent');
    expect(badgeClass()).toContain('text-muted');
  });
});

describe('StatRow', () => {
  it('is a description list: each label a term, each value with its unit a definition', () => {
    render(
      <StatList>
        <StatRow label="Power" value="4" unit="MW" />
        <StatRow label="Rate" value="30" unit="/min" tone="accent" />
      </StatList>,
    );
    const terms = screen.getAllByRole('term');
    const values = screen.getAllByRole('definition');
    expect(terms.map(t => t.textContent)).toEqual(['Power', 'Rate']);
    expect(values.map(v => v.textContent)).toEqual(['4MW', '30/min']);
    expect(classes(values[1]!)).toContain('text-accent');
  });
});

describe('StatTile', () => {
  it('is a term with its value and the line under it, the answer in the accent', () => {
    render(
      <dl>
        <StatTile main label="Power" sub="varies"><TileValue value="2,550" unit="MW" /></StatTile>
        <StatTile label="Buildings">365</StatTile>
      </dl>,
    );
    expect(screen.getAllByRole('term').map(t => t.textContent)).toEqual(['Power', 'Buildings']);
    expect(screen.getAllByRole('definition').map(d => d.textContent)).toEqual(['2,550 MW', 'varies', '365']);
    expect(classes(screen.getByText('2,550'))).toContain('text-accent');
  });
});

describe('Fold', () => {
  it('is folded until its summary is clicked, shows the values in effect, and remembers being opened', async () => {
    render(<Fold title="Extractors" summary="Miner Mk.1 · 100 %"><label>Clock <input /></label></Fold>);
    const details = screen.getByText('Extractors').closest('details')!;
    expect(details).not.toHaveAttribute('open');
    expect(details.querySelector('summary')).toHaveTextContent('ExtractorsMiner Mk.1 · 100 %');
    await userEvent.click(screen.getByText('Extractors'));
    expect(details).toHaveAttribute('open');
    expect(screen.getByLabelText('Clock')).toBeInTheDocument();
  });

  it('can start open', () => {
    render(<Fold title="More" defaultOpen>x</Fold>);
    expect(screen.getByText('More').closest('details')).toHaveAttribute('open');
  });
});

describe('NumberField', () => {
  it('is a labelled number input that names its unit as its description and passes value changes through', async () => {
    function Controlled() {
      const [v, setV] = useState('60');
      return <NumberField label="Target rate" unit="/min" hint="Up to 780" min={0} value={v} onChange={e => setV(e.target.value)} />;
    }
    render(<Controlled />);
    const input = screen.getByRole('spinbutton', { name: 'Target rate' });
    expect(input).toHaveAttribute('type', 'number');
    expect(input).toHaveAccessibleDescription('/min Up to 780');
    await userEvent.clear(input);
    await userEvent.type(input, '120');
    expect(input).toHaveValue(120);
  });

  it('can hide its label and keep it as the name', () => {
    render(<NumberField label="Clock" hideLabel unit="%" defaultValue={100} />);
    expect(screen.getByRole('spinbutton', { name: 'Clock' })).toHaveValue(100);
    expect(classes(screen.getByText('Clock'))).toContain('sr-only');
  });

  it('takes a width for the box alone, so a long hint keeps the whole width', () => {
    render(<NumberField label="Speed" unit="km/h" hint="A long explanation" boxClassName="max-w-48" />);
    expect(classes(screen.getByRole('spinbutton', { name: 'Speed' }).parentElement!)).toContain('max-w-48');
    expect(classes(screen.getByText('A long explanation').parentElement!)).not.toContain('max-w-48');
  });

  it('fieldClass gives the 3:1 edge and the focus ring, and keeps the caller layout classes', () => {
    const c = fieldClass({ size: 'sm' }, 'w-full').split(/\s+/);
    expect(c).toEqual(expect.arrayContaining(['border-edge', 'focus-ring', 'h-8', 'w-full']));
  });

  it('keeps form text at 16 px below 900 px, so iOS does not zoom into a focused field', () => {
    expect(fieldClass({ size: 'sm' }).split(/\s+/)).toContain('max-[899px]:text-base');
    expect(fieldClass().split(/\s+/)).toContain('max-[899px]:text-base');
    render(<NumberField label="Rate" size="sm" hint="per minute" />);
    expect(screen.getByRole('spinbutton', { name: 'Rate' }).parentElement).toHaveClass('text-sm', 'max-[899px]:text-base');
    // Hints read at 14 px on a phone.
    expect(screen.getByText('per minute')).toHaveClass('max-[899px]:text-sm');
  });
});

describe('page back control', () => {
  it('lets a page point the header\'s back control somewhere inside it, and gives it back when it is done', () => {
    let target: PageBackTarget | null = null;
    function Page({ on }: { on: boolean }) {
      usePageBack(on ? { to: '/list', label: 'Back to the list' } : null);
      return null;
    }
    const set = (t: PageBackTarget | null) => { target = t; };
    const { rerender, unmount } = render(<PageBackSlot value={set}><Page on /></PageBackSlot>);
    expect(target).toEqual({ to: '/list', label: 'Back to the list' });
    rerender(<PageBackSlot value={set}><Page on={false} /></PageBackSlot>);
    expect(target).toBeNull();
    rerender(<PageBackSlot value={set}><Page on /></PageBackSlot>);
    unmount();
    expect(target).toBeNull();
    // Outside a world page it does nothing.
    render(<Page on />);
  });
});

describe('PageActions', () => {
  it('renders into the slot a page header provides, and nothing without one', () => {
    function Page() {
      const [slot, setSlot] = useState<HTMLDivElement | null>(null);
      return (
        <>
          <div data-testid="slot" ref={setSlot} />
          <PageActionsSlot value={slot}><PageActions><Button>Reset</Button></PageActions></PageActionsSlot>
        </>
      );
    }
    const { unmount } = render(<Page />);
    expect(within(screen.getByTestId('slot')).getByRole('button', { name: 'Reset' })).toBeInTheDocument();
    unmount();
    render(<PageActions><Button>Reset</Button></PageActions>);
    expect(screen.queryByRole('button', { name: 'Reset' })).toBeNull();
  });
});

describe('Header', () => {
  beforeAll(() => { initI18n(['en']); });

  it('links the mark home, keeps the right side at its content width without a middle, and shares the width with one', () => {
    const { rerender } = render(<MemoryRouter><Header tools={<button type="button">Tools</button>} end={<span>me</span>}><h1>World</h1></Header></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'ficsmap' })).toHaveAttribute('href', '/?list=1');
    const right = () => screen.getByRole('button', { name: 'Tools' }).parentElement!;
    // A phone: no middle, so the right side never grows into the world name and never overlaps it.
    expect(classes(right())).toEqual(expect.arrayContaining(['shrink-0', 'min-w-max']));
    expect(classes(right())).not.toContain('flex-1');
    rerender(<MemoryRouter><Header center={<input aria-label="Search" />} tools={<button type="button">Tools</button>}><h1>World</h1></Header></MemoryRouter>);
    expect(classes(right())).toEqual(expect.arrayContaining(['flex-1', 'basis-0', 'min-w-max']));
    // The language switch lives in the account menu now, not in the bar.
    expect(screen.queryByRole('radiogroup', { name: 'Language' })).toBeNull();
  });
});
