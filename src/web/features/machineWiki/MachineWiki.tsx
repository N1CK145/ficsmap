import { Fragment, useEffect, useId, useMemo, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  descriptorClass, entryTierKeys, groupByCategory, matchesQuery, matchesTiers, perMinute, selectedUpTo, statRows, tierOf,
  tierOptions, toggleTier, upToTier, wikiUrl,
  type ItemAmount, type Lang, type MachineCategory, type MachineData, type MachineEntry, type StatRow as WikiStatRow, type TierKey, type WikiRecipe,
} from '../../../shared/machines.js';
import { MAX_SHARDS } from '../../../shared/planner.js';
import { useMediaQuery } from '../../app/useMediaQuery.js';
import { Badge } from '../../components/Badge.js';
import { Button, buttonClass } from '../../components/Button.js';
import { fieldClass } from '../../components/Field.js';
import { Fold } from '../../components/Fold.js';
import { CloseIcon, SearchIcon } from '../../components/icons.js';
import { SectionHeading } from '../../components/SectionHeading.js';
import { StatList, StatRow } from '../../components/StatRow.js';
import { Window } from '../../components/Window.js';
import { GameIcon } from './icons.js';

/** From this width the picture grid stays beside an open entry (Tailwind's `xl`). */
const WIDE_QUERY = '(min-width: 1280px)';
/** Below this width (Tailwind's `sm`) the wiki shows the list or an entry, not both. */
export const NARROW_QUERY = '(max-width: 639px)';

/** Category accents (theme tokens `--color-cat-*`), written out in full so Tailwind generates every class. */
const CATEGORY: Record<MachineCategory, { text: string; bar: string; tint: string; border: string; hover: string }> = {
  production: { text: 'text-cat-production', bar: 'bg-cat-production', tint: 'bg-cat-production/10', border: 'border-cat-production', hover: 'hover:border-cat-production' },
  extraction: { text: 'text-cat-extraction', bar: 'bg-cat-extraction', tint: 'bg-cat-extraction/10', border: 'border-cat-extraction', hover: 'hover:border-cat-extraction' },
  power: { text: 'text-cat-power', bar: 'bg-cat-power', tint: 'bg-cat-power/10', border: 'border-cat-power', hover: 'hover:border-cat-power' },
  logistics: { text: 'text-cat-logistics', bar: 'bg-cat-logistics', tint: 'bg-cat-logistics/10', border: 'border-cat-logistics', hover: 'hover:border-cat-logistics' },
  special: { text: 'text-cat-special', bar: 'bg-cat-special', tint: 'bg-cat-special/10', border: 'border-cat-special', hover: 'hover:border-cat-special' },
  vehicles: { text: 'text-cat-vehicles', bar: 'bg-cat-vehicles', tint: 'bg-cat-vehicles/10', border: 'border-cat-vehicles', hover: 'hover:border-cat-vehicles' },
};

type TierKind = 'tier' | 'mam' | 'shop' | 'other';
const kindOf = (key: TierKey): TierKind => (tierOf(key) !== undefined ? 'tier' : key as TierKind);
/** Filter chips that are switched on: milestone tiers in the accent, MAM and Shop in their own colours. */
const CHIP_ON: Record<TierKind, string> = {
  tier: 'border-accent bg-accent text-bg',
  mam: 'border-unlock-mam bg-unlock-mam text-bg',
  shop: 'border-unlock-shop bg-unlock-shop text-bg',
  other: 'border-fg bg-fg text-bg',
};
/** Small print under a block; 14 px on a phone, where 12 px Barlow reads too small. */
const NOTE = 'text-xs text-muted max-[899px]:text-sm';

type AmountText = (a: ItemAmount, perMin?: boolean) => string;

/** "2 × Iron Plate" or "45 m³ Water", in the current language. */
function useAmount(data: MachineData, lang: Lang): AmountText {
  const { t } = useTranslation();
  return (a: ItemAmount, perMin = false) => {
    const item = data.items[a.item];
    const name = item?.name[lang] ?? a.item;
    const fluid = item !== undefined && item.form !== 'solid';
    return t(perMin ? 'machineWiki.amountPerMinute' : 'machineWiki.amount', { amount: a.amount, name, fluid: fluid ? 'yes' : 'no' });
  };
}

/** An amount with the item's picture before it. The text is the element's own text (screen readers and search). */
function Amount({ item, text, px = 20, className = '' }: { item: string; text: string; px?: number; className?: string }) {
  return <span className={`inline-flex items-center gap-1.5 ${className}`}><GameIcon cls={item} px={px} />{text}</span>;
}

function TierBadge({ tier, id, hidden = false }: { tier: TierKey; id?: string; hidden?: boolean }) {
  const { t } = useTranslation();
  return (
    <span id={id} aria-hidden={hidden || undefined} className="contents">
      <Badge>{t('machineWiki.badge', { key: kindOf(tier), tier: tierOf(tier) ?? 0 })}</Badge>
    </span>
  );
}

/**
 * The wiki: one row with the search and the tier filter, the entries as picture cards grouped by category, and the
 * selected entry as a window beside them. With an entry open, the picture grid stays on wide screens and the entry
 * takes a column of reading width on the right; on medium screens the list becomes a narrow column; there both scroll
 * on their own. On phones the list or the entry; the page header's back control then leads back to the list
 * (`MachineWikiPage`), so the entry has no close button of its own there. The list stays mounted when an entry opens,
 * so the focus stays on the chosen card. `shardStep` is what one Power Shard adds to the clock speed (from the recipe
 * data, 0.5): with it the clock speed row gives the range with shards.
 */
export function MachineWiki({ data, selected, query, tiers = [], onSelect, onQuery, onTiers = () => {}, shardStep }: {
  data: MachineData; selected: string | null; query: string; tiers?: TierKey[];
  onSelect(id: string | null): void; onQuery(q: string): void; onTiers?(tiers: TierKey[]): void; shardStep?: number;
}) {
  const { t, i18n } = useTranslation();
  const lang: Lang = i18n.language === 'de' ? 'de' : 'en';
  const searchId = useId();
  const wide = useMediaQuery(WIDE_QUERY);
  const narrow = useMediaQuery(NARROW_QUERY);
  const detailRef = useRef<HTMLDivElement>(null);
  const shown = useMemo(() => data.machines.filter(m => matchesQuery(m, query) && matchesTiers(m, tiers)), [data.machines, query, tiers]);
  const groups = useMemo(() => groupByCategory(shown), [shown]);
  const options = useMemo(() => tierOptions(data.machines), [data.machines]);
  const entry = data.machines.find(m => m.id === selected) ?? null;
  const entryId = entry?.id;
  const filtered = query.trim() !== '' || tiers.length > 0;
  // Another entry starts at its top.
  useEffect(() => {
    const el = detailRef.current;
    if (!entryId || !el) return;
    el.scrollTop = 0;
    el.scrollIntoView?.({ block: 'nearest' });
  }, [entryId]);

  return (
    <div className={`flex flex-col gap-4 ${entry ? 'sm:h-full' : ''}`}>
      <div className={`flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2 ${entry ? 'max-sm:hidden' : ''}`}>
        <div className={`flex min-w-0 max-w-md flex-[1_1_16rem] items-center gap-2 ${fieldClass({}, 'focus-within:border-accent max-[899px]:h-11')}`}>
          <SearchIcon className="text-muted" />
          <label htmlFor={searchId} className="sr-only">{t('machineWiki.search')}</label>
          <input id={searchId} type="search" value={query} onChange={e => onQuery(e.target.value)} autoComplete="off"
            placeholder={t('machineWiki.searchPlaceholder')}
            className="h-full min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted max-[899px]:text-base" />
        </div>
        <TierFilter options={options} tiers={tiers} onTiers={onTiers} />
        <p className="text-sm text-muted tabular-nums empty:hidden" aria-live="polite">
          {filtered ? t('machineWiki.showing', { shown: shown.length, total: data.machines.length }) : ''}
        </p>
      </div>
      <div className={entry ? 'grid gap-4 sm:min-h-0 sm:flex-1 sm:grid-cols-[minmax(13rem,16rem)_minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_minmax(26rem,42rem)]' : ''}>
        <EntryList groups={groups} layout={entry && !wide ? 'column' : 'grid'} selected={selected} lang={lang} onSelect={onSelect}
          className={entry ? 'max-sm:hidden sm:overflow-y-auto sm:pr-1' : ''} />
        {entry && (
          <div ref={detailRef} className="min-w-0 sm:overflow-y-auto sm:pr-1">
            <EntryDetail data={data} entry={entry} lang={lang} shardStep={shardStep} onClose={narrow ? undefined : () => onSelect(null)} />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The tier filter: toggle chips, several at once (tiers 1 to 4 is "up to tier 4"), with one "Up to tier" select that
 * sets tiers 0 to n in one go, and [× Clear filter] while a tier is chosen.
 */
function TierFilter({ options, tiers, onTiers }: { options: TierKey[]; tiers: TierKey[]; onTiers(tiers: TierKey[]): void }) {
  const { t } = useTranslation();
  const labelId = useId();
  const tierNumbers = options.map(tierOf).filter((n): n is number => n !== undefined);
  const upTo = selectedUpTo(tiers);
  const upToValue = upTo !== null ? String(upTo) : tiers.some(k => tierOf(k) !== undefined) ? 'mixed' : '';

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <div role="group" aria-labelledby={labelId} className="flex flex-wrap items-center gap-1">
        <span id={labelId} className="mr-1 font-display text-sm font-semibold tracking-wider text-muted uppercase">
          <span aria-hidden="true">{t('machineWiki.tierLabel')}</span><span className="sr-only">{t('machineWiki.tierFilter')}</span>
        </span>
        {options.map(key => {
          const n = tierOf(key);
          const on = tiers.includes(key);
          const kind = kindOf(key);
          return (
            <button key={key} type="button" aria-pressed={on} onClick={() => onTiers(toggleTier(tiers, key))}
              aria-label={t('machineWiki.tierName', { key: kind, tier: n ?? 0 })}
              className={`h-8 min-w-8 chamfer border px-2 font-display text-sm font-semibold tabular-nums transition-colors focus-ring max-[899px]:h-11 max-[899px]:min-w-11 ${
                on ? CHIP_ON[kind] : 'border-line bg-bg text-muted hover:bg-line hover:text-fg'}`}>
              {n ?? t('machineWiki.tierChip', { key })}
            </button>
          );
        })}
      </div>
      <label className="flex items-center gap-2 text-sm text-muted">
        {t('machineWiki.upTo')}
        <select value={upToValue} className={fieldClass({ size: 'sm' }, 'text-fg max-[899px]:h-11')}
          onChange={e => { if (e.target.value !== 'mixed') onTiers(upToTier(tiers, e.target.value === '' ? null : Number(e.target.value))); }}>
          <option value="">{t('machineWiki.upToAll')}</option>
          {upToValue === 'mixed' && <option value="mixed" disabled>{t('machineWiki.upToMixed')}</option>}
          {tierNumbers.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      {tiers.length > 0 && <Button variant="ghost" size="sm" onClick={() => onTiers([])}><CloseIcon size={14} />{t('machineWiki.clearTiers')}</Button>}
    </div>
  );
}

/** The entries by category: picture cards in a grid (nothing selected) or a compact column beside the details. */
function EntryList({ groups, layout, selected, lang, onSelect, className = '' }: {
  groups: { category: MachineCategory; entries: MachineEntry[] }[]; layout: 'grid' | 'column';
  selected: string | null; lang: Lang; onSelect(id: string): void; className?: string;
}) {
  const { t } = useTranslation();
  const id = useId();
  return (
    <nav aria-label={t('machineWiki.listLabel')} className={`flex flex-col gap-4 ${className}`}>
      {groups.length === 0 && <p className="text-sm text-muted">{t('machineWiki.noMatch')}</p>}
      {groups.map(g => {
        const c = CATEGORY[g.category];
        return (
          <section key={g.category} aria-labelledby={`${id}-${g.category}`}>
            <h3 id={`${id}-${g.category}`} className={`mb-2 flex items-center gap-2 font-display text-sm font-semibold tracking-[0.1em] uppercase ${c.text}`}>
              <span aria-hidden="true" className={`h-3 w-[3px] ${c.bar}`} />
              {t(`machineWiki.category.${g.category}`)}
              <span aria-hidden="true" className="font-normal text-muted tabular-nums">{g.entries.length}</span>
            </h3>
            <ul className={layout === 'grid' ? 'grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2' : 'flex flex-col gap-0.5'}>
              {g.entries.map(m => (
                <li key={m.id}>
                  <EntryButton entry={m} layout={layout} current={m.id === selected} lang={lang} onSelect={onSelect} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </nav>
  );
}

/** One entry in the list. Its name is the button's name; the tier badge is its description. */
function EntryButton({ entry, layout, current, lang, onSelect }: {
  entry: MachineEntry; layout: 'grid' | 'column'; current: boolean; lang: Lang; onSelect(id: string): void;
}) {
  const badgeId = useId();
  const c = CATEGORY[entry.category];
  const tier = entry.unlockedBy.length > 0 ? entryTierKeys(entry)[0] : undefined;
  const common = {
    type: 'button' as const, onClick: () => onSelect(entry.id), 'aria-current': current ? 'true' as const : undefined,
    'aria-describedby': tier ? badgeId : undefined,
  };
  if (layout === 'grid') {
    return (
      <button {...common} className={`flex h-full w-full flex-col items-center gap-2 chamfer border border-line bg-bg p-2 text-center text-sm transition-colors focus-ring hover:bg-panel ${c.hover}`}>
        <span className={`flex size-24 items-center justify-center chamfer ${c.tint}`}>
          <GameIcon cls={descriptorClass(entry.id)} px={88} placeholder />
        </span>
        <span lang={lang} className="max-w-full leading-tight font-medium wrap-break-word hyphens-auto">{entry.name[lang]}</span>
        {tier && <TierBadge tier={tier} id={badgeId} hidden />}
      </button>
    );
  }
  return (
    <button {...common} className={`flex w-full items-center gap-2 border-l-2 px-2 py-1.5 text-left text-sm focus-ring hover:bg-raised ${
      current ? `bg-raised font-semibold ${c.border}` : 'border-transparent'}`}>
      <span className={`flex size-8 shrink-0 items-center justify-center chamfer ${c.tint}`}>
        <GameIcon cls={descriptorClass(entry.id)} px={28} placeholder />
      </span>
      <span lang={lang} className="min-w-0 flex-1 wrap-break-word hyphens-auto">{entry.name[lang]}</span>
      {tier && <TierBadge tier={tier} id={badgeId} hidden />}
    </button>
  );
}

/** A titled part of the entry window: a section heading over its content. */
function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <SectionHeading as="h4" id={id}>{title}</SectionHeading>
      {children}
    </section>
  );
}

/** Percent of a 1 = 100 % clock speed, without float noise (0.01 → 1). */
const percent = (clock: number) => Math.round(clock * 10_000) / 100;

/**
 * One entry as a window, laid out like the planner's machine window: the title bar with its picture, its name, the
 * name in the other language and its category, the tier badges and (on wider screens) ×; then its stats, fuels, the
 * game's description, build cost, unlocks, recipes (folded) and the wiki link.
 */
export function EntryDetail({ data, entry, lang, shardStep, onClose }: {
  data: MachineData; entry: MachineEntry; lang: Lang; shardStep?: number; onClose?: () => void;
}) {
  const { t } = useTranslation();
  const amount = useAmount(data, lang);
  const rows = statRows(entry, data.items, lang);
  const recipes = useMemo(() => data.recipes.filter(r => r.machine === entry.id), [data.recipes, entry.id]);
  const fuels = entry.stats.fuels ?? [];
  const other: Lang = lang === 'de' ? 'en' : 'de';
  const c = CATEGORY[entry.category];
  const itemName = (id: string) => data.items[id]?.name[lang] ?? id;
  const fluid = (id: string) => data.items[id] !== undefined && data.items[id].form !== 'solid';
  const rate = (a: ItemAmount) => t('machineWiki.rate', { amount: a.amount, fluid: fluid(a.item) ? 'yes' : 'no' });
  const value = (r: WikiStatRow): ReactNode => {
    if (r.items) {
      return (
        <span className="inline-flex flex-wrap justify-end gap-x-3 gap-y-1">
          {r.items.map((id, i) => <Fragment key={id}>{i > 0 && <span className="sr-only">, </span>}<Amount item={id} text={itemName(id)} /></Fragment>)}
        </span>
      );
    }
    // The clock speed with Power Shards: the range up to the shard slots every building has (as in the planner).
    if (r.id === 'clock' && shardStep !== undefined) {
      const min = Number(r.params.min);
      const max = Number(r.params.max) + MAX_SHARDS * shardStep;
      return t('machineWiki.statValue.clockShards', { min: percent(min), max: percent(max), shards: MAX_SHARDS });
    }
    return t(`machineWiki.statValue.${r.id}`, r.params);
  };
  const subtitle = [entry.name[other] !== entry.name[lang] ? entry.name[other] : null, t(`machineWiki.category.${entry.category}`)];

  return (
    <Window
      as="article"
      level={3}
      title={<span lang={lang} className="hyphens-auto">{entry.name[lang]}</span>}
      subtitle={<>{subtitle[0] && <><span lang={other}>{subtitle[0]}</span> · </>}<span className={c.text}>{subtitle[1]}</span></>}
      icon={<span className={`flex size-12 items-center justify-center chamfer ${c.tint}`}><GameIcon cls={descriptorClass(entry.id)} px={44} placeholder /></span>}
      actions={entry.unlockedBy.length > 0 ? <span className="flex shrink-0 flex-col items-end gap-1">{entryTierKeys(entry).map(k => <TierBadge key={k} tier={k} />)}</span> : undefined}
      onClose={onClose}
      closeLabel={t('machineWiki.back')}
      bodyClassName="flex flex-col gap-5 p-3 text-sm min-[900px]:p-4"
      footer={(
        <a href={wikiUrl(entry.wikiPage)} target="_blank" rel="noopener noreferrer" className={buttonClass({ variant: 'secondary', size: 'sm' })}>
          {t('machineWiki.wikiLink')}
          <span aria-hidden="true">↗</span>
          <span className="sr-only"> {t('machineWiki.newTab')}</span>
        </a>
      )}
    >
      {rows.length > 0 && (
        <Section title={t('machineWiki.stats')}>
          <StatList>
            {rows.map(r => <StatRow key={r.id} label={t(`machineWiki.stat.${r.id}`)} value={value(r)} />)}
          </StatList>
        </Section>
      )}

      {fuels.length > 0 && (
        <Section title={t('machineWiki.fuels')}>
          <StatList>
            {fuels.map(f => (
              <StatRow
                key={f.item}
                icon={<GameIcon cls={f.item} px={24} />}
                label={itemName(f.item)}
                value={f.perMinute === undefined ? '' : rate({ item: f.item, amount: f.perMinute })}
                hint={[
                  f.supplement && `${t('machineWiki.plus')} ${amount(f.supplement, true)}`,
                  f.byproduct && `${t('machineWiki.byproduct')} ${amount(f.byproduct, true)}`,
                  f.boost !== undefined && t('machineWiki.fuelBoost', { share: f.boost }),
                ].filter(Boolean).join(' · ') || undefined}
              />
            ))}
          </StatList>
          {entry.stats.clock && fuels.some(f => f.perMinute !== undefined) && <p className={NOTE}>{t('machineWiki.atFullClock')}</p>}
        </Section>
      )}

      <Section title={t('machineWiki.description')}>
        <blockquote lang={lang} className={`border-l-2 pl-3 whitespace-pre-line ${c.border}`}>{entry.description[lang] || t('machineWiki.noDescription')}</blockquote>
      </Section>

      {entry.build && (
        <Section title={t('machineWiki.buildCost', { place: entry.build.place })}>
          <ul className="flex flex-wrap gap-2">
            {entry.build.ingredients.map(a => (
              <li key={a.item} className="inline-flex items-center gap-2 chamfer border border-line bg-bg py-1 pr-2.5 pl-1">
                <GameIcon cls={a.item} px={28} />{amount(a)}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {entry.unlockedBy.length > 0 && (
        <Section title={t('machineWiki.unlockedBy')}>
          <ul className="flex flex-col gap-1">
            {entry.unlockedBy.map(u => <li key={`${u.kind}:${u.name.en}`}>{t('machineWiki.unlock', { kind: u.kind, tier: u.tier, name: u.name[lang] })}</li>)}
          </ul>
        </Section>
      )}

      {recipes.length > 0 && (
        <Fold title={t('machineWiki.recipes', { count: recipes.length })} className="-mx-3 border-y border-line min-[900px]:-mx-4"
          summaryClassName="px-3 py-2 min-[900px]:px-4" bodyClassName="px-3 pb-2 min-[900px]:px-4">
          <ul className="flex flex-col divide-y divide-line">
            {recipes.map(r => <RecipeLine key={r.id} recipe={r} amount={amount} lang={lang} />)}
          </ul>
          <p className={NOTE}>{t('machineWiki.atFullClock')}</p>
        </Fold>
      )}

      <p className={NOTE}>{t('machineWiki.source')}</p>
    </Window>
  );
}

function RecipeLine({ recipe: r, amount, lang }: { recipe: WikiRecipe; amount: AmountText; lang: Lang }) {
  const { t } = useTranslation();
  const rates = (list: ItemAmount[], className = '') => list.map((a, i) => (
    <Fragment key={a.item}>
      {i > 0 && <span className="sr-only">, </span>}
      <Amount item={a.item} text={amount({ item: a.item, amount: perMinute(a.amount, r.duration) }, true)} className={className} />
    </Fragment>
  ));
  return (
    <li className="flex flex-col gap-1 py-2">
      <span className="flex flex-wrap items-center gap-2 font-medium">
        {r.name[lang]}
        {r.alternate && <Badge tone="accent">{t('machineWiki.alternate')}</Badge>}
      </span>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {rates(r.ingredients)}
        <span aria-hidden="true" className="text-muted">→</span><span className="sr-only">{t('machineWiki.into')}</span>
        {rates(r.products, 'font-medium')}
      </span>
      <span className={NOTE}>
        {t('machineWiki.cycle', { seconds: r.duration })}
        {r.power && <> · {t('machineWiki.recipePower', { min: r.power.min, max: r.power.max })}</>}
      </span>
    </li>
  );
}
