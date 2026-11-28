import { useId, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Purity } from '../../../shared/planner.js';
import { defaultNodeExtractor, nodeExtractors, nodeResources, nodeSupply, type MaxOutputResult, type NodeGroup } from '../../../shared/plannerNodes.js';
import type { RecipeIndex } from '../../../shared/recipes.js';
import { Button } from '../../components/Button.js';
import { FIELD_LABEL, fieldClass, NumberField } from '../../components/Field.js';
import { IconButton } from '../../components/IconButton.js';
import { CloseIcon } from '../../components/icons.js';
import { SectionHeading } from '../../components/SectionHeading.js';
import { StatList, StatRow } from '../../components/StatRow.js';
import { Window } from '../../components/Window.js';
import { GameIcon } from '../machineWiki/icons.js';
import { usePurityOptions } from './controls.js';
import { formatNumber, formatRate, itemName, type Lang } from './format.js';
import { parseNumber, usePlanner, type PlannerNodeInput } from './usePlanner.js';

/** The node groups as entered, for `nodeSupply`: complete rows only, the extractor defaulting to the miner setting. */
export function nodeGroups(index: RecipeIndex, nodes: readonly PlannerNodeInput[], minerId: string): NodeGroup[] {
  return nodes.flatMap(n => {
    if (!n.resource) return [];
    const fits = nodeExtractors(index, n.resource);
    const extractor = fits.find(e => e.id === n.extractor) ?? defaultNodeExtractor(index, n.resource, minerId);
    return extractor ? [{ resource: n.resource, purity: n.purity, count: parseNumber(n.count), extractor: extractor.id }] : [];
  });
}

/**
 * "Available nodes": one row per group of nodes (resource, purity, how many, extractor) with what they give per minute
 * at the extractor clock speed, "+ Add nodes" under them.
 */
export function NodeInputs({ index, lang, minerId, clock }: { index: RecipeIndex; lang: Lang; minerId: string; clock: number }) {
  const { t } = useTranslation();
  const nodes = usePlanner(s => s.nodes);
  const addNode = usePlanner(s => s.addNode);
  const headingId = useId();
  const resources = useMemo(
    () => nodeResources(index).sort((a, b) => a.name[lang].localeCompare(b.name[lang], lang)),
    [index, lang],
  );
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <SectionHeading as="h4" id={headingId}>{t('planner.nodes.title')}</SectionHeading>
      <p className="text-xs text-muted">{t('planner.nodes.hint')}</p>
      <ul className="flex flex-col gap-3">
        {nodes.map((n, i) => <NodeRow key={n.key} node={n} n={i + 1} index={index} lang={lang} minerId={minerId} clock={clock} resources={resources} />)}
      </ul>
      <Button size="sm" onClick={addNode} className="self-start">{t('planner.nodes.add')}</Button>
    </section>
  );
}

function NodeRow({ node, n, index, lang, minerId, clock, resources }: {
  node: PlannerNodeInput; n: number; index: RecipeIndex; lang: Lang; minerId: string; clock: number; resources: { id: string; name: Record<Lang, string> }[];
}) {
  const { t } = useTranslation();
  const setNode = usePlanner(s => s.setNode);
  const removeNode = usePlanner(s => s.removeNode);
  const purities = usePurityOptions();
  const ids = { resource: useId(), purity: useId(), extractor: useId() };
  const name = node.resource ? itemName(index, node.resource, lang) : t('planner.nodes.groupN', { n });
  const extractors = node.resource ? nodeExtractors(index, node.resource) : [];
  const group = nodeGroups(index, [node], minerId)[0];
  const supply = group ? nodeSupply(index, [group], clock).get(group.resource) : undefined;
  const select = fieldClass({ size: 'sm' }, 'w-full');
  return (
    <li className="grid grid-cols-2 items-end gap-2 border-l-2 border-line pl-2 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_5rem_minmax(0,1fr)_auto]">
      <div className="col-span-2 flex min-w-0 flex-col gap-1 sm:col-span-1">
        <label htmlFor={ids.resource} className={FIELD_LABEL}>{t('planner.nodes.resource')}</label>
        <span className="flex items-center gap-2">
          {node.resource && <GameIcon cls={node.resource} px={24} placeholder />}
          <select
            id={ids.resource} value={node.resource ?? ''} className={select}
            onChange={e => setNode(node.key, { resource: e.target.value || null, extractor: null })}
          >
            <option value="">{t('planner.nodes.pickResource')}</option>
            {resources.map(r => <option key={r.id} value={r.id}>{r.name[lang]}</option>)}
          </select>
        </span>
      </div>
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={ids.purity} className={FIELD_LABEL}>{t('planner.panel.purity')}</label>
        <select id={ids.purity} value={node.purity} onChange={e => setNode(node.key, { purity: e.target.value as Purity })} className={select}>
          {purities.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </div>
      <NumberField
        label={t('planner.nodes.count')} size="sm" min={0} step={1} value={node.count}
        onChange={e => setNode(node.key, { count: e.target.value })}
      />
      <div className="flex min-w-0 flex-col gap-1">
        <label htmlFor={ids.extractor} className={FIELD_LABEL}>{t('planner.nodes.extractor')}</label>
        <select
          id={ids.extractor} value={group?.extractor ?? ''} disabled={extractors.length === 0} className={select}
          onChange={e => setNode(node.key, { extractor: e.target.value })}
        >
          {extractors.map(e => <option key={e.id} value={e.id}>{e.name[lang]}</option>)}
        </select>
      </div>
      <IconButton aria-label={t('planner.remove', { item: name })} title={t('planner.remove', { item: name })} onClick={() => removeNode(node.key)} className="justify-self-end">
        <CloseIcon />
      </IconButton>
      {supply !== undefined && node.resource && (
        <p className="col-span-full text-sm text-muted tabular-nums">{t('planner.nodes.gives', { value: formatRate(index, node.resource, supply, lang, t) })}</p>
      )}
    </li>
  );
}

/**
 * The answer of the nodes mode: the most each target can be made at, the bottleneck resource, and for every node
 * resource of the plan how much of it the maximum uses.
 */
export function MaxOutputView({ max, index, lang }: { max: MaxOutputResult; index: RecipeIndex; lang: Lang }) {
  const { t } = useTranslation();
  const rate = (item: string, value: number) => formatRate(index, item, value, lang, t);
  const names = (items: string[]) => items.map(i => itemName(index, i, lang)).join(', ');
  const picture = (cls: string) => <GameIcon cls={cls} px={24} placeholder />;
  let body;
  if (!max.ok) {
    if (max.error !== 'unbounded') return null;
    body = <p className="text-sm">{t('planner.nodes.unbounded')}</p>;
  } else {
    body = (
      <>
        <StatList>
          {max.targets.map(tg => (
            <StatRow key={tg.item} icon={picture(tg.item)} label={itemName(index, tg.item, lang)} value={rate(tg.item, tg.rate)} tone="accent" />
          ))}
        </StatList>
        {max.factor <= 0
          ? <p role="alert" className="text-sm text-conflict">{t('planner.nodes.missing', { items: names(max.bottleneck) })}</p>
          : <p className="text-sm">{t('planner.nodes.bottleneck', { items: names(max.bottleneck), count: max.bottleneck.length })}</p>}
        <section className="flex flex-col">
          <SectionHeading as="h4">{t('planner.nodes.usage')}</SectionHeading>
          <StatList>
            {max.uses.map(u => {
              const limiting = max.bottleneck.includes(u.item);
              const share = u.available > 0 ? (u.used / u.available) * 100 : 0;
              return (
                <StatRow
                  key={u.item} icon={picture(u.item)} label={itemName(index, u.item, lang)}
                  hint={limiting ? t('planner.nodes.limiting') : t('planner.nodes.share', { value: formatNumber(share, lang, 1) })}
                  value={t('planner.nodes.usedOf', { used: formatNumber(u.used, lang), available: rate(u.item, u.available) })}
                  tone={limiting ? 'danger' : 'default'}
                />
              );
            })}
          </StatList>
        </section>
      </>
    );
  }
  return (
    <Window level={3} title={t('planner.nodes.maxTitle')} bodyClassName="flex flex-col gap-3 p-3">
      {body}
    </Window>
  );
}
