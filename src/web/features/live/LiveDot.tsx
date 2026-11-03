import { useTranslation } from 'react-i18next';
import { useLiveStatus, type LiveStatus } from './useWorldEvents.js';

const DOT: Record<LiveStatus, string> = {
  live: 'bg-fg',
  connecting: 'bg-muted motion-safe:animate-pulse',
  offline: 'bg-conflict',
};

/** "● Live" in the header: whether changes of other members arrive right now. */
export function LiveDot() {
  const { t } = useTranslation();
  const status = useLiveStatus(s => s.status);
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm ${status === 'live' ? 'text-fg' : 'text-muted'}`}>
      <span aria-hidden="true" className={`size-2 rounded-full ${DOT[status]}`} />
      {t(`live.${status}`)}
    </span>
  );
}
