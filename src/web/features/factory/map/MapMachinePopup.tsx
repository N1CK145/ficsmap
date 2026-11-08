import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useMap } from 'react-leaflet';
import { mergeHints } from '../../../../shared/factory/lines.js';
import type { WorldCtx } from '../../../app/feature.js';
import { useIsMobile } from '../../../app/useMediaQuery.js';
import { Badge } from '../../../components/Badge.js';
import { IconsContext, useItemIcons } from '../../machineWiki/icons.js';
import { useFactoryFormat } from '../format.js';
import { MachinePopup, type Box } from '../MachinePopup.js';
import { MachineWindow } from '../MachineWindow.js';
import { crateKey, StorageWindow } from '../StorageWindow.js';
import { FLUID_BUFFER_M3 } from '../../../../shared/factory/inventory.js';
import { isMachine, isStorageSelection, useMapData } from './mapData.js';
import { useFactoryMap, type FactorySelection } from './useFactoryMap.js';

/** Map events after which the clicked building may sit elsewhere on the screen. */
const MOVES = 'move zoom zoomend viewreset resize';
/** The anchor's half size around the building's centre, px: at least a dot, at most a large building's. */
const MIN_R = 6;
const MAX_R = 160;

/**
 * The selected machine of the factory map as the game's machine window (`MachineWindow`) in a popup next to it, or
 * the selected storage (container, storage box, fluid buffer, Dimensional Depot uploader) or crate as the game's
 * container window (`StorageWindow`): on the
 * right of the building, else on its left, else above or below, inside the map (and left of the line's card when one
 * is open). It follows the building while the map pans or zooms instead of closing: a pan to see what is around keeps
 * it, so only a click closes it. Clicking anywhere outside it closes it (on the map: empty ground; another machine
 * moves it there), as do Esc (`escapeStepsBack` from the map, the popup's own handler from inside it) and ×. On phones
 * a sheet over the lower map (the map pans the building above it, `FactoryMapLayer`). Opened from a button the focus
 * moves to its title and goes back on close.
 */
export function MapMachinePopup({ ctx }: { ctx: WorldCtx }) {
  const visible = useFactoryMap(s => s.visible);
  const selection = useFactoryMap(s => s.selection);
  if (!visible || (selection?.kind !== 'building' && selection?.kind !== 'crate')) return null;
  return <Popup ctx={ctx} sel={selection} />;
}

function Popup({ ctx, sel }: { ctx: WorldCtx; sel: FactorySelection }) {
  const id = sel.id;
  const { t } = useTranslation();
  const map = useMap();
  const version = ctx.me.datasetVersion;
  const data = useMapData(ctx.worldId, version, ctx.index.ds.bounds, true);
  const icons = useItemIcons(version);
  const fmt = useFactoryFormat();
  const mobile = useIsMobile();
  const pendingFocus = useFactoryMap(s => s.pendingFocus);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const scene = data.scene;
  const sb = sel.kind === 'building' ? scene?.byId.get(id) : undefined;
  const crate = sel.kind === 'crate' ? scene?.crateById.get(id) : undefined;
  const flow = sel.kind === 'building' ? data.current?.analysis.byId.get(id) : undefined;
  const machine = isMachine(data, sel);
  const storage = isStorageSelection(data, sel);

  const subscribe = useCallback((update: () => void) => {
    map.on(MOVES, update);
    return () => { map.off(MOVES, update); };
  }, [map]);

  // Opened from a button: the focus moves to the title.
  useEffect(() => {
    if (!pendingFocus || !titleRef.current) return;
    titleRef.current.focus();
    useFactoryMap.getState().focusHandled();
  }, [pendingFocus, flow, storage]);

  const at = sb ?? crate;
  if (!at || !data.labels) return null;
  if (machine ? !flow || !data.analysis : !storage) return null;
  const labels = data.labels;
  const name = sb ? labels.building(sb.b.cls, fmt.lang) : t(crateKey(crate!.kind));
  const close = () => useFactoryMap.getState().select(null);

  const anchor = (): Box => {
    const rect = map.getContainer().getBoundingClientRect();
    const p = map.latLngToContainerPoint([-at.cy, at.cx]);
    // CRS.Simple: one map unit is 2^zoom px.
    const r = Math.max(MIN_R, Math.min(MAX_R, ((sb?.maxSide ?? 0) / 2) * 2 ** map.getZoom()));
    return { left: rect.left + p.x - r, right: rect.left + p.x + r, top: rect.top + p.y - r, bottom: rect.top + p.y + r };
  };
  const area = (): Box => {
    const rect = map.getContainer().getBoundingClientRect();
    let right = rect.right;
    // The line's card on the right of the map: the popup stays left of it.
    const card = document.querySelector('.ficsmap-factory-info')?.getBoundingClientRect();
    if (card && card.width > 0 && card.left > rect.left + rect.width / 2) right = card.left;
    return { left: rect.left, top: rect.top, right, bottom: rect.bottom };
  };

  // Changes marked: whether it is new and how its productivity changed, as the info window said it.
  const isNew = data.diff?.added.includes(id) ?? false;
  const change = data.diff ? [...data.diff.better, ...data.diff.worse].find(c => c.id === id) : undefined;
  const top = (isNew || change) ? (
    <div className="flex flex-wrap gap-2" data-testid="factory-info-change">
      {isNew && <Badge tone="success">{t('factoryMap.info.newSince', { date: data.compare ? fmt.date(data.compare.meta.saveTime) : '' })}</Badge>}
      {change && (
        <Badge tone={change.delta > 0 ? 'success' : 'danger'}>
          {t('factoryMap.info.change', { before: fmt.pct(change.before), delta: fmt.pointsDelta(change.delta) })}
        </Badge>
      )}
    </div>
  ) : undefined;

  return (
    <IconsContext.Provider value={icons}>
      <MachinePopup
        label={name}
        anchor={anchor}
        area={area}
        subscribe={subscribe}
        prefer="side"
        sheet={mobile}
        // On phones above the timeline's place and the bottom sheet's peek, as the info window.
        sheetClassName="ficsmap-machine-sheet inset-x-2 bottom-[136px] max-h-[min(60%,calc(100%-152px))]"
        openKey={() => useFactoryMap.getState().selection}
        onClose={close}
        escape="inside"
        returnFocus={() => {
          const back = useFactoryMap.getState().returnFocus;
          useFactoryMap.setState({ returnFocus: null });
          return back ?? map.getContainer();
        }}
        strategy="absolute"
        className={`ficsmap-machine-popup z-[1002] ${mobile ? '' : 'w-[min(440px,calc(100%-16px))]'}`}
      >
        {machine && flow && data.analysis ? (
          <MachineWindow
            m={flow} data={data.analysis} labels={labels} fmt={fmt} hints={mergeHints(flow, data.lines)}
            onClose={close} titleRef={titleRef} top={top} building={sb?.b} inventories={scene?.snapshot.meta.inventories === true}
          />
        ) : (
          <StorageWindow
            name={name} picture={sb ? labels.buildingPicture(sb.b.cls) : undefined} inv={sb ? sb.b.inv : crate!.c.inv}
            capacityM3={sb ? FLUID_BUFFER_M3[sb.b.cls] : undefined} labels={labels} fmt={fmt} onClose={close} titleRef={titleRef} top={top}
          />
        )}
      </MachinePopup>
    </IconsContext.Provider>
  );
}
