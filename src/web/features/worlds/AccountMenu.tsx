import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../app/api.js';
import { Link } from 'react-router';
import { Button, buttonClass } from '../../components/Button.js';
import { IconButton } from '../../components/IconButton.js';
import { LanguageSwitch } from '../../components/LanguageSwitch.js';
import { POPOVER } from '../../components/Window.js';
import { useMe } from './queries.js';
import { APP_VERSION, RELEASE_URL, REPO_URL } from '../../app/version.js';

/**
 * Avatar button in the header with the signed-in account, a link to the worlds (on a phone the top bar has no mark
 * inside a world), a link to the profile settings (`/profile`), the language switch (also on the profile page),
 * [Sign out], and this build's version (its release page) and the source repository: inside a world there is no
 * footer, so they live here.
 */
export function AccountMenu() {
  const { t } = useTranslation();
  const me = useMe().data;
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    // preventDefault: this Esc is used up, so page-wide Esc handlers (item panel) leave it alone.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!me) return null;

  async function signOut() {
    setBusy(true);
    try {
      await api('POST', '/auth/logout', {});
    } finally {
      // Also after a failed request: the login page shows whether the session is still there.
      window.location.assign('/login');
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <IconButton
        aria-label={t('account.menu')}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        size="sm"
        onClick={() => setOpen(o => !o)}
      >
        {me.avatarUrl
          ? <img src={me.avatarUrl} alt="" className="size-7 rounded-full ring-1 ring-line" />
          : <span aria-hidden="true" className="font-display text-lg font-bold">{me.displayName.slice(0, 1).toUpperCase()}</span>}
      </IconButton>
      {open && (
        <div id={menuId} className={`absolute top-full right-0 z-[1400] mt-2 flex w-[min(17rem,calc(100vw-1rem))] flex-col gap-3 p-3 ${POPOVER}`}>
          <p className="font-display text-lg leading-tight font-semibold">{me.displayName}</p>
          {me.email && <p className="-mt-2 text-sm text-muted [overflow-wrap:anywhere]">{t('account.signedInAs', { email: me.email })}</p>}
          <Link to="/?list=1" onClick={() => setOpen(false)} className={buttonClass({ variant: 'secondary', size: 'sm' }, 'w-full')}>{t('worlds.title')}</Link>
          <Link to="/profile" onClick={() => setOpen(false)} className={buttonClass({ variant: 'secondary', size: 'sm' }, 'w-full')}>{t('profile.title')}</Link>
          <div className="flex items-center justify-between gap-2 border-y border-line py-2">
            <span className="text-sm text-muted">{t('language.label')}</span>
            <LanguageSwitch />
          </div>
          <Button disabled={busy} onClick={() => void signOut()}>{t('account.signOut')}</Button>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line pt-2 font-display text-xs tracking-wider text-muted uppercase max-[899px]:text-sm">
            <a href={RELEASE_URL} target="_blank" rel="noreferrer" className="rounded focus-ring hover:text-accent">{t('app.name')} v{APP_VERSION}</a>
            <span aria-hidden="true">·</span>
            <a href={REPO_URL} target="_blank" rel="noreferrer" className="rounded focus-ring hover:text-accent">{t('footer.source')}</a>
          </p>
        </div>
      )}
    </div>
  );
}
