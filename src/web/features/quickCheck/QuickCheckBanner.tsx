import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMap } from 'react-leaflet';
import { useIsMobile } from '../../app/useMediaQuery.js';
import { DOT_ZOOM } from '../map/markerStyle.js';

/**
 * The bar across the map while Quick Check is on; on dots it adds that zooming in is needed (on
 * mobile as a shorter second line, so the bar stays two or three lines high).
 */
export function QuickCheckBanner() {
  const { t } = useTranslation();
  const map = useMap();
  const mobile = useIsMobile();
  const [zoom, setZoom] = useState(() => map.getZoom());
  useEffect(() => {
    const onZoomEnd = () => setZoom(map.getZoom());
    map.on('zoomend', onZoomEnd);
    return () => { map.off('zoomend', onZoomEnd); };
  }, [map]);
  return (
    <p role="status">
      {t('quickCheck.banner')}
      {zoom < DOT_ZOOM && (mobile ? <span className="block">{t('quickCheck.zoomInShort')}</span> : ` · ${t('quickCheck.zoomIn')}`)}
    </p>
  );
}
