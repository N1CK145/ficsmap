import { Fragment, useId, useMemo, type MouseEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  descriptorClass, entryTierKeys, groupByCategory, matchesQuery, matchesTiers, perMinute, selectedUpTo, statRows, tierOf,
  tierOptions, toggleTier, upToTier, wikiUrl,
  type ItemAmount, type Lang, type MachineCategory, type MachineData, type MachineEntry, type TierKey, type WikiRecipe,
} from '../../../shared/machines.js';
import { Button } from '../../components/Button.js';
import { GameIcon } from './icons.js';

const INPUT = 'h-10 w-full min-w-0 rounded border border-line bg-bg px-3 text-fg focus-ring';

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
/** Badges: milestone tiers neutral, MAM and Shop in their own colours. */
const BADGE: Record<TierKind, string> = {
  tier: 'border-line bg-bg text-fg',
  mam: 'border-unlock-mam/60 bg-bg text-unlock-mam',
  shop: 'border-unlock-shop/60 bg-bg text-unlock-shop',
  other: 'border-line bg-bg text-muted',
};
/** Filter chips that are switched on. */
const CHIP_ON: Record<TierKind, string> = {
  tier: 'border-accent bg-accent text-bg',
  mam: 'border-unlock-mam bg-unlock-mam text-bg',
  shop: 'border-unlock-shop bg-unlock-shop text-bg',
  other: 'border-fg bg-fg text-bg',
};

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
  const kind = kindOf(tier);
  return (
    <span id={id} aria-hidden={hidden || undefined}
      className={`inline-flex shrink-0 items-center rounded border px-1.5 text-xs leading-5 font-semibold whitespace-nowrap tabular-nums ${BADGE[kind]}`}>
      {t('machineWiki.badge', { key: kind, tier: tierOf(tier) ?? 0 })}
    </span>
  );
}

/**
 * The wiki: search, tier filter, the entries as picture cards grouped by category, and the selected entry's details.
 * With an entry open, the list becomes a narrow column beside it on wider screens; on phones the list or the details,
 * with a way back to the list.
 */
export function MachineWiki({ data, selected, query, tiers = [], onSelect, onQuery, onTiers = () => {} }: {
  data: MachineData; selected: string | null; query: string; tiers?: TierKey[];
  onSelect(id: string | null): void; onQuery(q: string): void; onTiers?(tiers: TierKey[]): void;
}) {
  const { t, i18n } = useTranslation();
  const lang: Lang = i18n.language === 'de' ? 'de' : 'en';
  const searchId = useId();
  const shown = useMemo(() => data.machines.filter(m => matchesQuery(m, query) && matchesTiers(m, tiers)), [data.machines, query, tiers]);
  const groups = useMemo(() => groupByCategory(shown), [shown]);
  const options = useMemo(() => tierOptions(data.machines), [data.machines]);
  const entry = data.machines.find(m => m.id === selected) ?? null;

  return (
    <div className="flex flex-col gap-4">
      <div className={`flex flex-col gap-3 ${entry ? 'max-sm:hidden' : ''}`}>
        <div className="flex flex-col gap-1">
          <label htmlFor={searchId} className="text-sm font-medium">{t('machineWiki.search')}</label>
          <input id={searchId} type="search" value={query} onChange={e => onQuery(e.target.value)} className={INPUT}
            placeholder={t('machineWiki.searchPlaceholder')} autoComplete="off" />
        </div>
        <TierFilter options={options} tiers={tiers} onTiers={onTiers} />
        <p className="text-xs text-muted" aria-live="polite">{t('machineWiki.showing', { shown: shown.length, total: data.machines.length })}</p>
      </div>
      {entry ? (
        <div className="grid gap-4 sm:grid-cols-[minmax(13rem,16rem)_1fr]">
          <EntryList groups={groups} layout="column" selected={selected} lang={lang} onSelect={onSelect} className="max-sm:hidden" />
          <div className="min-w-0">
            <EntryDetail data={data} entry={entry} lang={lang} onBack={() => onSelect(null)} />
          </div>
        </div>
      ) : (
        <>
          <p className="text-sm text-muted">{t('machineWiki.pick')}</p>
          <EntryList groups={groups} layout="grid" selected={selected} lang={lang} onSelect={onSelect} />
        </>
      )}
    </div>
  );
}

/**
 * The tier filter: toggle chips (several at once), Shift-click or the "Up to tier" select for everything from tier 0
 * to the one picked, and a reset.
 */
function TierFilter({ options, tiers, onTiers }: { options: TierKey[]; tiers: TierKey[]; onTiers(tiers: TierKey[]): void }) {
  const { t } = useTranslation();
  const labelId = useId();
  const tierNumbers = options.map(tierOf).filter((n): n is number => n !== undefined);
  const upTo = selectedUpTo(tiers);
  const upToValue = upTo !== null ? String(upTo) : tiers.some(k => tierOf(k) !== undefined) ? 'mixed' : '';
  const click = (key: TierKey, e: MouseEvent) => {
    const n = tierOf(key);
    onTiers(e.shiftKey && n !== undefined ? upToTier(tiers, n) : toggleTier(tiers, key));
  };

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <div role="group" aria-labelledby={labelId} className="flex flex-wrap items-center gap-1">
        <span id={labelId} className="mr-1 text-sm font-medium">
          <span aria-hidden="true">{t('machineWiki.tierLabel')}</span><span className="sr-only">{t('machineWiki.tierFilter')}</span>
        </span>
        {options.map(key => {
          const n = tierOf(key);
          const on = tiers.includes(key);
          const kind = kindOf(key);
          return (
            <button key={key} type="button" aria-pressed={on} onClick={e => click(key, e)}
              aria-label={t('machineWiki.tierName', { key: kind, tier: n ?? 0 })}
              title={n !== undefined ? t('machineWiki.tierHint') : undefined}
              className={`h-10 min-w-10 rounded border px-2 text-sm font-semibold tabular-nums transition-colors focus-ring sm:h-8 sm:min-w-8 ${
                on ? CHIP_ON[kind] : 'border-line bg-bg text-muted hover:bg-line hover:text-fg'}`}>
              {n ?? t('machineWiki.tierChip', { key })}
            </button>
          );
        })}
      </div>
      <label className="flex items-center gap-2 text-sm">
        {t('machineWiki.upTo')}
        <select value={upToValue} className="h-10 rounded border border-line bg-bg px-2 text-fg focus-ring sm:h-8"
          onChange={e => { if (e.target.value !== 'mixed') onTiers(upToTier(tiers, e.target.value === '' ? null : Number(e.target.value))); }}>
          <option value="">{t('machineWiki.upToAll')}</option>
          {upToValue === 'mixed' && <option value="mixed" disabled>{t('machineWiki.upToMixed')}</option>}
          {tierNumbers.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      {tiers.length > 0 && <Button variant="ghost" size="sm" onClick={() => onTiers([])}>{t('machineWiki.clearTiers')}</Button>}
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
    <nav aria-label={t('machineWiki.listLabel')}
      className={`flex flex-col gap-4 ${layout === 'column' ? 'sm:max-h-[70vh] sm:overflow-y-auto sm:pr-1' : ''} ${className}`}>
      {groups.length === 0 && <p className="text-sm text-muted">{t('machineWiki.noMatch')}</p>}
      {groups.map(g => {
        const c = CATEGORY[g.category];
        return (
          <section key={g.category} aria-labelledby={`${id}-${g.category}`}>
            <h3 id={`${id}-${g.category}`} className={`mb-2 flex items-center gap-2 text-xs font-semibold tracking-wide uppercase ${c.text}`}>
              <span aria-hidden="true" className={`h-3.5 w-1 rounded ${c.bar}`} />
              {t(`machineWiki.category.${g.category}`)}
              <span aria-hidden="true" className="font-normal text-muted tabular-nums">{g.entries.length}</span>
            </h3>
            <ul className={layout === 'grid' ? 'grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5' : 'flex flex-col gap-0.5'}>
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
      <button {...common} className={`flex h-full w-full flex-col items-center gap-2 rounded border border-line bg-bg p-2 text-center text-sm transition-colors focus-ring hover:bg-panel ${c.hover}`}>
        <span className={`flex size-24 items-center justify-center rounded ${c.tint}`}>
          <GameIcon cls={descriptorClass(entry.id)} px={88} placeholder />
        </span>
        <span lang={lang} className="max-w-full leading-tight font-medium wrap-break-word hyphens-auto">{entry.name[lang]}</span>
        {tier && <TierBadge tier={tier} id={badgeId} hidden />}
      </button>
    );
  }
  return (
    <button {...common} className={`flex w-full items-center gap-2 rounded border-l-2 px-2 py-1.5 text-left text-sm focus-ring hover:bg-line ${
      current ? `bg-line font-semibold ${c.border}` : 'border-transparent'}`}>
      <span className={`flex size-8 shrink-0 items-center justify-center rounded ${c.tint}`}>
        <GameIcon cls={descriptorClass(entry.id)} px={28} placeholder />
      </span>
      <span lang={lang} className="min-w-0 flex-1 wrap-break-word hyphens-auto">{entry.name[lang]}</span>
      {tier && <TierBadge tier={tier} id={badgeId} hidden />}
    </button>
  );
}

function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h4 className="font-display text-base font-semibold">{title}</h4>
      {children}
    </section>
  );
}

/** One entry: picture, stats table, fuels, game description, build cost, unlocks, recipes and the wiki link. */
export function EntryDetail({ data, entry, lang, onBack }: { data: MachineData; entry: MachineEntry; lang: Lang; onBack(): void }) {
  const { t } = useTranslation();
  const titleId = useId();
  const amount = useAmount(data, lang);
  const rows = statRows(entry, data.items, lang);
  const recipes = useMemo(() => data.recipes.filter(r => r.machine === entry.id), [data.recipes, entry.id]);
  const fuels = entry.stats.fuels ?? [];
  const other: Lang = lang === 'de' ? 'en' : 'de';
  const c = CATEGORY[entry.category];
  const itemName = (id: string) => data.items[id]?.name[lang] ?? id;

  return (
    <article aria-labelledby={titleId} className="flex flex-col gap-5 text-sm">
      <Button variant="ghost" size="sm" className="self-start sm:hidden" onClick={onBack}>
        <span aria-hidden="true">←</span>{t('machineWiki.back')}
      </Button>
      <header className={`flex flex-col items-center gap-4 rounded border border-line p-4 sm:flex-row ${c.tint}`}>
        <GameIcon cls={descriptorClass(entry.id)} px={128} alt={entry.name[lang]} placeholder />
        <div className="flex min-w-0 flex-col items-center gap-2 text-center sm:items-start sm:text-left">
          <h3 id={titleId} lang={lang} className="max-w-full font-display text-2xl leading-tight font-semibold wrap-break-word hyphens-auto">{entry.name[lang]}</h3>
          {entry.name[other] !== entry.name[lang] && <p lang={other} className="text-muted">{entry.name[other]}</p>}
          <div className="flex flex-wrap items-center justify-center gap-2">
            <span className={`inline-flex items-center gap-1.5 text-xs font-semibold tracking-wide uppercase ${c.text}`}>
              <span aria-hidden="true" className={`size-2 rounded-full ${c.bar}`} />{t(`machineWiki.category.${entry.category}`)}
            </span>
            {entry.unlockedBy.length > 0 && entryTierKeys(entry).map(k => <TierBadge key={k} tier={k} />)}
          </div>
        </div>
      </header>

      {rows.length > 0 && (
        <div className="overflow-hidden rounded border border-line">
        <table className="w-full border-collapse">
          <caption className="sr-only">{t('machineWiki.stats')}</caption>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-b border-line last:border-b-0 even:bg-bg/50">
                <th scope="row" className="px-3 py-1.5 text-left font-normal text-muted">{t(`machineWiki.stat.${r.id}`)}</th>
                <td className="px-3 py-1.5 text-right tabular-nums">
                  {r.items
                    ? <span className="inline-flex flex-wrap justify-end gap-x-3 gap-y-1">
                      {r.items.map((id, i) => (
                        <Fragment key={id}>{i > 0 && <span className="sr-only">, </span>}<Amount item={id} text={itemName(id)} /></Fragment>
                      ))}
                    </span>
                    : t(`machineWiki.statValue.${r.id}`, r.params)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}

      {fuels.length > 0 && (
        <Section title={t('machineWiki.fuels')}>
          <ul className="flex flex-col gap-1.5">
            {fuels.map(f => (
              <li key={f.item} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded border border-line bg-bg px-2 py-1.5">
                <Amount item={f.item} px={24} className="font-medium"
                  text={f.perMinute === undefined ? itemName(f.item) : amount({ item: f.item, amount: f.perMinute }, true)} />
                {f.supplement && <span className="inline-flex items-center gap-1.5 text-muted">· {t('machineWiki.plus')} <GameIcon cls={f.supplement.item} px={20} />{amount(f.supplement, true)}</span>}
                {f.byproduct && <span className="inline-flex items-center gap-1.5 text-muted">· {t('machineWiki.byproduct')} <GameIcon cls={f.byproduct.item} px={20} />{amount(f.byproduct, true)}</span>}
                {f.boost !== undefined && <span className="text-muted"> · {t('machineWiki.fuelBoost', { share: f.boost })}</span>}
              </li>
            ))}
          </ul>
          {entry.stats.clock && fuels.some(f => f.perMinute !== undefined) && <p className="text-xs text-muted">{t('machineWiki.atFullClock')}</p>}
        </Section>
      )}

      <Section title={t('machineWiki.description')}>
        <blockquote lang={lang} className={`border-l-2 pl-3 whitespace-pre-line ${c.border}`}>{entry.description[lang] || t('machineWiki.noDescription')}</blockquote>
      </Section>

      {entry.build && (
        <Section title={t('machineWiki.buildCost', { place: entry.build.place })}>
          <ul className="flex flex-wrap gap-2">
            {entry.build.ingredients.map(a => (
              <li key={a.item} className="inline-flex items-center gap-2 rounded border border-line bg-bg py-1 pr-2.5 pl-1">
                <GameIcon cls={a.item} px={28} />{amount(a)}
              </li>
            ))}
          </ul>
        </Section>
      )}

      {entry.unlockedBy.length > 0 && (
        <Section title={t('machineWiki.unlockedBy')}>
          <ul>
            {entry.unlockedBy.map(u => <li key={`${u.kind}:${u.name.en}`}>{t('machineWiki.unlock', { kind: u.kind, tier: u.tier, name: u.name[lang] })}</li>)}
          </ul>
        </Section>
      )}

      {recipes.length > 0 && (
        <details className="rounded border border-line">
          <summary className="cursor-pointer px-3 py-2 font-display text-base font-semibold focus-ring">
            {t('machineWiki.recipes', { count: recipes.length })}
          </summary>
          <ul className="flex flex-col divide-y divide-line px-3 pb-2">
            {recipes.map(r => <RecipeLine key={r.id} recipe={r} amount={amount} lang={lang} />)}
          </ul>
          <p className="px-3 pb-2 text-xs text-muted">{t('machineWiki.atFullClock')}</p>
        </details>
      )}

      <p>
        <a href={wikiUrl(entry.wikiPage)} target="_blank" rel="noopener noreferrer" className="text-accent underline focus-ring">
          {t('machineWiki.wikiLink')}
          <span className="sr-only"> {t('machineWiki.newTab')}</span>
        </a>
      </p>
      <p className="text-xs text-muted">{t('machineWiki.source')}</p>
    </article>
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
      <span className="font-medium">
        {r.name[lang]}
        {r.alternate && <span className="ml-2 rounded border border-line px-1 text-xs text-muted">{t('machineWiki.alternate')}</span>}
      </span>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {rates(r.ingredients)}
        <span aria-hidden="true" className="text-muted">→</span><span className="sr-only">{t('machineWiki.into')}</span>
        {rates(r.products, 'font-medium')}
      </span>
      <span className="text-xs text-muted">
        {t('machineWiki.cycle', { seconds: r.duration })}
        {r.power && <> · {t('machineWiki.recipePower', { min: r.power.min, max: r.power.max })}</>}
      </span>
    </li>
  );
}
