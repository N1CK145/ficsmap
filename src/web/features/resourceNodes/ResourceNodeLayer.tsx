import './resourceNodes.css';
import type L from 'leaflet';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMap } from 'react-leaflet';
import { worldToLatLng, UNITS_PER_METER } from '../../../shared/geo.js';
import { filterNodes, type ExtractorInfo, type ResourceNode } from '../../../shared/resourceNodes.js';
import type { WorldCtx } from '../../app/feature.js';
import { NodeCanvasLayer } from './NodeCanvasLayer.js';
import type { DrawExtractor, DrawNode } from './drawNode.js';
import { ExtractorList, useExtractorLabel } from './Extractors.js';
import { PurityPips, ResourceSwatch } from './PurityPips.js';
import { resourceToken, useResourceLabels, type ResourceLabel } from './resourceStyle.js';
import { useNodeFilter, useNodeLayer, useWorldNodes } from './useResourceNodes.js';

const HOVER_CLASS = 'ficsmap-node-hover';
/** px between the node and its info box. */
const BOX_OFFSET = 14;

/**
 * The resource nodes on the map while the layer is switched on, filtered by resource and purity. Hovering a
 * node shows its resource, purity and position; a click (or tap) pins that box until a click elsewhere or
 * Escape.
 */
export function ResourceNodeLayer({ ctx }: { ctx: WorldCtx }) {
  const map = useMap();
  const visible = useNodeLayer(s => s.visible);
  const data = useWorldNodes(ctx.me.datasetVersion, ctx.worldId, visible);
  const extractors = data?.extractors;
  const filter = useNodeFilter(extractors);
  const labelOf = useResourceLabels(data?.file);
  const extractorLabel = useExtractorLabel();
  const bounds = ctx.index.ds.bounds;

  const shown = useMemo(() => (data && visible ? filterNodes(data.nodes, filter) : []), [data, visible, filter]);
  const byName = useMemo(() => new Map(shown.map(n => [n.name, n])), [shown]);
  const draw = useMemo((): DrawNode[] => {
    const out = shown.map((n): DrawNode => {
      const [lat, lng] = worldToLatLng(n.x, n.y, bounds);
      const d: DrawNode = { id: n.name, lat, lng, kind: n.kind, purity: n.purity, token: resourceToken(n.resource), label: labelOf(n.resource).short, changed: !!n.original };
      const on = extractors?.get(n.name);
      if (on) d.extractor = extractorTag(on, extractorLabel);
      return d;
    });
    // Cores first, so their satellites are drawn on top.
    return out.sort((a, b) => Number(b.kind === 'core') - Number(a.kind === 'core'));
  }, [shown, bounds, labelOf, extractors, extractorLabel]);

  const [hover, setHover] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const active = pinned ?? hover;
  const nodesRef = useRef(draw);
  const activeRef = useRef(active);
  const layerRef = useRef<NodeCanvasLayer | null>(null);

  useEffect(() => {
    if (!visible) return;
    const layer = new NodeCanvasLayer(() => nodesRef.current, () => activeRef.current);
    layer.addTo(map);
    layerRef.current = layer;
    const container = map.getContainer();
    let frame = 0;
    let point: L.Point | null = null;
    const onMove = (e: L.LeafletMouseEvent) => {
      point = e.containerPoint;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const id = point ? layer.pick(point.x, point.y) : null;
        container.classList.toggle(HOVER_CLASS, id !== null);
        setHover(id);
      });
    };
    const onOut = () => {
      point = null;
      container.classList.remove(HOVER_CLASS);
      setHover(null);
    };
    const onClick = (e: L.LeafletMouseEvent) => setPinned(layer.pick(e.containerPoint.x, e.containerPoint.y));
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPinned(null); };
    map.on('mousemove', onMove);
    map.on('mouseout', onOut);
    map.on('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      map.off('mousemove', onMove);
      map.off('mouseout', onOut);
      map.off('click', onClick);
      document.removeEventListener('keydown', onKey);
      cancelAnimationFrame(frame);
      container.classList.remove(HOVER_CLASS);
      layer.remove();
      layerRef.current = null;
      setHover(null);
      setPinned(null);
    };
  }, [map, visible]);

  // Before paint, so the layer never draws a frame with stale nodes.
  useLayoutEffect(() => {
    nodesRef.current = draw;
    activeRef.current = active;
    layerRef.current?.redraw();
  }, [draw, active]);

  const node = active === null ? undefined : byName.get(active);
  if (!visible || !node) return null;
  return <NodeInfo node={node} extractors={extractors?.get(node.name)} label={labelOf} pinned={pinned !== null} ctx={ctx} />;
}

/**
 * The map's tag for a node's extractors: the first one's short name (buildings before portable miners), with
 * `×n` when all n are of that kind or `+` when others stand there too; the Power Shards of all of them.
 */
export function extractorTag(list: readonly ExtractorInfo[], short: (kind: ExtractorInfo['kind']) => string): DrawExtractor {
  const first = list[0]!;
  const same = list.every(e => e.kind === first.kind);
  const suffix = list.length === 1 ? '' : same ? `×${list.length}` : '+';
  return { label: short(first.kind) + suffix, shards: list.reduce((n, e) => n + (e.shards ?? 0), 0) };
}

/** Follows its node while the map moves (a pinned box stays while panning). */
function NodeInfo({ node, extractors, label, pinned, ctx }: {
  node: ResourceNode; extractors: readonly ExtractorInfo[] | undefined; label: (id: string) => ResourceLabel; pinned: boolean; ctx: WorldCtx;
}) {
  const { t, i18n } = useTranslation();
  const map = useMap();
  const [, setTick] = useState(0);
  useEffect(() => {
    const update = () => setTick(n => n + 1);
    map.on('move zoomend', update);
    return () => { map.off('move zoomend', update); };
  }, [map]);
  const [lat, lng] = worldToLatLng(node.x, node.y, ctx.index.ds.bounds);
  const p = map.latLngToContainerPoint([lat, lng]);
  const size = map.getSize();
  const metres = new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 0 });
  const m = (units: number) => metres.format(units / UNITS_PER_METER);
  const res = label(node.resource);
  // Right of the node, or left of it near the right edge; clamped vertically by CSS translate.
  const right = p.x < size.x - 240;
  return (
    <div
      role={pinned ? 'dialog' : 'tooltip'}
      aria-label={res.name}
      data-testid="node-info"
      className="pointer-events-none absolute z-[800] w-max max-w-60 rounded border border-line bg-panel/95 px-2 py-1.5 text-xs text-fg shadow"
      style={{ left: right ? p.x + BOX_OFFSET : undefined, right: right ? undefined : size.x - p.x + BOX_OFFSET, top: p.y, transform: 'translateY(-50%)' }}
    >
      <div className="flex items-center gap-1.5 font-semibold">
        <ResourceSwatch token={resourceToken(node.resource)} hollow={node.kind === 'core'} />
        <span>{res.name}</span>
      </div>
      <div className="text-muted">{t(`resourceNodes.kinds.${node.kind}`)}</div>
      {node.purity !== null && (
        <div className="flex items-center gap-1.5">
          <PurityPips purity={node.purity} />
          <span>{t(`resourceNodes.purity.${node.purity}`)}</span>
        </div>
      )}
      <div className="tabular-nums">{t('item.coords', { x: m(node.x), y: m(node.y), z: m(node.z) })}</div>
      {node.original && (
        <div className="mt-1 border-t border-line pt-1 text-muted">
          {t('resourceNodes.fromSave', {
            resource: label(node.original.resource).name,
            purity: node.original.purity === null ? '–' : t(`resourceNodes.purity.${node.original.purity}`),
          })}
        </div>
      )}
      {extractors && extractors.length > 0 && (
        <div className="mt-1 border-t border-line pt-1">
          <ExtractorList extractors={extractors} />
        </div>
      )}
    </div>
  );
}
