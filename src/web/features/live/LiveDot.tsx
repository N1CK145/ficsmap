import { useTranslation } from 'react-i18next';
import { useLiveStatus, type LiveStatus } from './useWorldEvents.js';

/** Each state has its own shape, so the colour is never the only cue: a filled dot, a hollow ring, a cross. */
const MARK: Record<LiveStatus, string> = {
  live: 'size-2 rounded-full bg-free',
  connecting: 'size-2 rounded-full border-[1.5px] border-muted motion-safe:animate-pulse',
  offline: 'size-2.5 bg-conflict [clip-path:polygon(20%_0,50%_30%,80%_0,100%_20%,70%_50%,100%_80%,80%_100%,50%_70%,20%_100%,0_80%,30%_50%,0_20%)]',
};

/**
 * "● LIVE" in the header: whether changes of other members arrive right now. Below 1280 px the word shows only while
 * something is wrong (connecting, offline); the normal live state is just its dot there (the word stays for screen
 * readers and in the tooltip). The mark has a shape per state as well as a colour.
 */
export function LiveDot() {
  const { t } = useTranslation();
  const status = useLiveStatus(s => s.status);
  return (
    <span title={t(`live.${status}`)} className={`inline-flex shrink-0 items-center gap-1.5 font-display text-xs font-semibold tracking-wider whitespace-nowrap uppercase ${status === 'offline' ? 'text-conflict' : 'text-muted'}`}>
      <span aria-hidden="true" className={`shrink-0 ${MARK[status]}`} />
      <span className={status === 'live' ? 'max-[1279px]:sr-only' : ''}>{t(`live.${status}`)}</span>
    </span>
  );
}
