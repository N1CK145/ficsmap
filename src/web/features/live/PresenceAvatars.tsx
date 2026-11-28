import { useTranslation } from 'react-i18next';
import type { WorldCtx } from '../../app/feature.js';
import { usePresentIds } from './presence.js';

const MAX_FACES = 3;

/**
 * The other members who have the world open right now, next to the live dot: up to three avatars (initials without
 * one) and "+n" for the rest; the names are in the tooltip and for screen readers. Nothing while the user is alone.
 * Hidden below 640 px, where the header is full; the activity panel lists them there.
 */
export function PresenceAvatars({ ctx }: { ctx: WorldCtx }) {
  const { t } = useTranslation();
  const ids = usePresentIds(ctx.worldId);
  const others = ctx.world.members.filter(m => m.userId !== ctx.me.id && ids.includes(m.userId));
  if (others.length === 0) return null;
  const label = t('live.alsoHere', { names: others.map(m => m.displayName).join(', ') });
  const rest = others.length - MAX_FACES;
  return (
    <span title={label} className="inline-flex shrink-0 items-center max-sm:hidden">
      <span className="sr-only">{label}</span>
      <span aria-hidden="true" className="flex -space-x-1.5">
        {others.slice(0, MAX_FACES).map(m => m.avatarUrl
          ? <img key={m.userId} src={m.avatarUrl} alt="" width={20} height={20} className="size-5 rounded-full ring-2 ring-panel" />
          : (
            <span key={m.userId} className="flex size-5 items-center justify-center rounded-full bg-line text-[10px] font-semibold text-fg ring-2 ring-panel">
              {m.displayName.slice(0, 1).toUpperCase()}
            </span>
          ))}
      </span>
      {rest > 0 && <span aria-hidden="true" className="ml-1 text-xs text-muted">+{rest}</span>}
    </span>
  );
}
