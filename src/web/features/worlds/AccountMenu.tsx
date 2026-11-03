import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { api } from '../../app/api.js';
import { Button } from '../../components/Button.js';
import { IconButton } from '../../components/IconButton.js';
import { useMe } from './queries.js';
import { APP_VERSION, RELEASE_URL } from '../../app/version.js';

/** Avatar button in the header with the signed-in account and [Sign out]. */
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
        onClick={() => setOpen(o => !o)}
      >
        {me.avatarUrl
          ? <img src={me.avatarUrl} alt="" className="size-8 rounded-full" />
          : <span aria-hidden="true" className="font-display text-lg font-bold">{me.displayName.slice(0, 1).toUpperCase()}</span>}
      </IconButton>
      {open && (
        <div id={menuId} className="absolute top-full right-0 z-[1400] mt-1 flex w-64 flex-col gap-2 rounded border border-line bg-panel p-3 shadow-lg">
          <p className="font-semibold">{me.displayName}</p>
          {me.email && <p className="text-sm break-all text-muted">{t('account.signedInAs', { email: me.email })}</p>}
          <Button disabled={busy} onClick={() => void signOut()}>{t('account.signOut')}</Button>
          <a href={RELEASE_URL} target="_blank" rel="noreferrer" className="self-start rounded text-xs text-muted focus-ring hover:underline">
            ficsmap v{APP_VERSION}
          </a>
        </div>
      )}
    </div>
  );
}
