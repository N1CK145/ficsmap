import { useTranslation } from 'react-i18next';
import { useLiveStatus, type LiveStatus } from './useWorldEvents.js';

const DOT: Record<LiveStatus, string> = {
  live: 'bg-free',
  connecting: 'bg-muted motion-safe:animate-pulse',
  offline: 'bg-conflict',
};

/** "● LIVE" in the header: whether changes of other members arrive right now. Below 1280 px only the dot shows (the word stays for screen readers and in the tooltip). */
export function LiveDot() {
  const { t } = useTranslation();
  const status = useLiveStatus(s => s.status);
  return (
    <span title={t(`live.${status}`)} className={`inline-flex shrink-0 items-center gap-1.5 font-display text-xs font-semibold tracking-wider uppercase ${status === 'offline' ? 'text-conflict' : 'text-muted'}`}>
      <span aria-hidden="true" className={`size-2 rounded-full ${DOT[status]}`} />
      <span className="max-[1279px]:sr-only">{t(`live.${status}`)}</span>
    </span>
  );
}
