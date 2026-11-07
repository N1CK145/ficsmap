import { useId, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  groupByCategory, matchesQuery, perMinute, statRows, wikiUrl,
  type ItemAmount, type Lang, type MachineData, type MachineEntry, type WikiRecipe,
} from '../../../shared/machines.js';
import { Button } from '../../components/Button.js';

const INPUT = 'h-10 w-full min-w-0 rounded border border-line bg-bg px-3 text-fg focus-ring';

/** "2 × Iron Plate" or "45 m³ Water", in the current language. */
function useAmount(data: MachineData, lang: Lang) {
  const { t } = useTranslation();
  return (a: ItemAmount, perMin = false) => {
    const item = data.items[a.item];
    const name = item?.name[lang] ?? a.item;
    const fluid = item !== undefined && item.form !== 'solid';
    return t(perMin ? 'machineWiki.amountPerMinute' : 'machineWiki.amount', { amount: a.amount, name, fluid: fluid ? 'yes' : 'no' });
  };
}

/**
 * The wiki: a searchable list grouped by category and the selected entry's details. Side by side on
 * wider screens; on phones the list or the details, with a way back to the list.
 */
export function MachineWiki({ data, selected, query, onSelect, onQuery }: {
  data: MachineData; selected: string | null; query: string; onSelect(id: string | null): void; onQuery(q: string): void;
}) {
  const { t, i18n } = useTranslation();
  const lang: Lang = i18n.language === 'de' ? 'de' : 'en';
  const searchId = useId();
  const groups = useMemo(() => groupByCategory(data.machines.filter(m => matchesQuery(m, query))), [data.machines, query]);
  const entry = data.machines.find(m => m.id === selected) ?? null;

  return (
    <div className="grid gap-4 sm:grid-cols-[minmax(12rem,15rem)_1fr]">
      <div className={`flex min-w-0 flex-col gap-3 ${entry ? 'max-sm:hidden' : ''}`}>
        <div className="flex flex-col gap-1">
          <label htmlFor={searchId} className="text-sm font-medium">{t('machineWiki.search')}</label>
          <input id={searchId} type="search" value={query} onChange={e => onQuery(e.target.value)} className={INPUT}
            placeholder={t('machineWiki.searchPlaceholder')} autoComplete="off" />
        </div>
        <nav aria-label={t('machineWiki.listLabel')} className="flex flex-col gap-3 sm:max-h-[60vh] sm:overflow-y-auto sm:pr-1">
          {groups.length === 0 && <p className="text-sm text-muted">{t('machineWiki.noMatch')}</p>}
          {groups.map(g => (
            <section key={g.category} aria-labelledby={`${searchId}-${g.category}`}>
              <h3 id={`${searchId}-${g.category}`} className="mb-1 text-xs font-semibold tracking-wide text-muted uppercase">
                {t(`machineWiki.category.${g.category}`)}
              </h3>
              <ul className="flex flex-col">
                {g.entries.map(m => (
                  <li key={m.id}>
                    <button type="button" onClick={() => onSelect(m.id)} aria-current={m.id === selected ? 'true' : undefined}
                      className={`w-full rounded px-2 py-2 text-left text-sm focus-ring hover:bg-line sm:py-1 ${m.id === selected ? 'bg-line font-semibold text-accent' : ''}`}>
                      {m.name[lang]}
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </nav>
      </div>
      <div className={`min-w-0 ${entry ? '' : 'max-sm:hidden'}`}>
        {entry
          ? <EntryDetail data={data} entry={entry} lang={lang} onBack={() => onSelect(null)} />
          : <p className="text-sm text-muted">{t('machineWiki.pick')}</p>}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h4 className="font-display text-base font-semibold">{title}</h4>
      {children}
    </section>
  );
}

/** One entry: stats table, fuels, game description, build cost, unlocks, recipes and the wiki link. */
export function EntryDetail({ data, entry, lang, onBack }: { data: MachineData; entry: MachineEntry; lang: Lang; onBack(): void }) {
  const { t } = useTranslation();
  const titleId = useId();
  const amount = useAmount(data, lang);
  const rows = statRows(entry, data.items, lang);
  const recipes = useMemo(() => data.recipes.filter(r => r.machine === entry.id), [data.recipes, entry.id]);
  const fuels = entry.stats.fuels ?? [];
  const other: Lang = lang === 'de' ? 'en' : 'de';

  return (
    <article aria-labelledby={titleId} className="flex flex-col gap-4 text-sm">
      <div className="flex flex-col gap-1">
        <Button variant="ghost" size="sm" className="self-start sm:hidden" onClick={onBack}>
          <span aria-hidden="true">←</span>{t('machineWiki.back')}
        </Button>
        <h3 id={titleId} className="font-display text-xl font-semibold">{entry.name[lang]}</h3>
        <p className="text-muted">
          {t(`machineWiki.category.${entry.category}`)}
          {entry.name[other] !== entry.name[lang] && <> · <span lang={other}>{entry.name[other]}</span></>}
        </p>
      </div>

      {rows.length > 0 && (
        <table className="w-full border-collapse">
          <caption className="sr-only">{t('machineWiki.stats')}</caption>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-b border-line last:border-b-0">
                <th scope="row" className="py-1 pr-3 text-left font-normal text-muted">{t(`machineWiki.stat.${r.id}`)}</th>
                <td className="py-1 text-right tabular-nums">{t(`machineWiki.statValue.${r.id}`, r.params)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {fuels.length > 0 && (
        <Section title={t('machineWiki.fuels')}>
          <ul className="flex flex-col gap-1">
            {fuels.map(f => (
              <li key={f.item}>
                {f.perMinute === undefined ? data.items[f.item]?.name[lang] ?? f.item : amount({ item: f.item, amount: f.perMinute }, true)}
                {f.supplement && <span className="text-muted"> · {t('machineWiki.plus')} {amount(f.supplement, true)}</span>}
                {f.byproduct && <span className="text-muted"> · {t('machineWiki.byproduct')} {amount(f.byproduct, true)}</span>}
                {f.boost !== undefined && <span className="text-muted"> · {t('machineWiki.fuelBoost', { share: f.boost })}</span>}
              </li>
            ))}
          </ul>
          {entry.stats.clock && fuels.some(f => f.perMinute !== undefined) && <p className="text-xs text-muted">{t('machineWiki.atFullClock')}</p>}
        </Section>
      )}

      <Section title={t('machineWiki.description')}>
        <blockquote lang={lang} className="border-l-2 border-line pl-3 whitespace-pre-line">{entry.description[lang] || t('machineWiki.noDescription')}</blockquote>
      </Section>

      {entry.build && (
        <Section title={t('machineWiki.buildCost', { place: entry.build.place })}>
          <ul className="flex flex-wrap gap-x-4 gap-y-1">
            {entry.build.ingredients.map(a => <li key={a.item}>{amount(a)}</li>)}
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
            {recipes.map(r => <RecipeLine key={r.id} recipe={r} lang={lang} amount={amount} />)}
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

function RecipeLine({ recipe: r, lang, amount }: { recipe: WikiRecipe; lang: Lang; amount: (a: ItemAmount, perMin?: boolean) => string }) {
  const { t } = useTranslation();
  const rate = (a: ItemAmount) => amount({ item: a.item, amount: perMinute(a.amount, r.duration) }, true);
  return (
    <li className="flex flex-col gap-0.5 py-2">
      <span className="font-medium">
        {r.name[lang]}
        {r.alternate && <span className="ml-2 rounded border border-line px-1 text-xs text-muted">{t('machineWiki.alternate')}</span>}
      </span>
      <span>{r.ingredients.map(rate).join(', ')} <span aria-hidden="true">→</span><span className="sr-only">{t('machineWiki.into')}</span> {r.products.map(rate).join(', ')}</span>
      <span className="text-xs text-muted">
        {t('machineWiki.cycle', { seconds: r.duration })}
        {r.power && <> · {t('machineWiki.recipePower', { min: r.power.min, max: r.power.max })}</>}
      </span>
    </li>
  );
}
