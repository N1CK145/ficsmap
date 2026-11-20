import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { VersionDto } from '../../shared/api.js';
import { api } from './api.js';
import { useMaintenanceSuspicion } from './maintenanceState.js';

/** How many jokes `maintenance.jokes` holds per language (keys "0" … "n-1"). */
export const MAINTENANCE_JOKES = 10;
/** How often the banner asks whether maintenance is over, while it shows (ms). */
const RECHECK_MS = 10_000;
/** The CSS variable full-height pages take the banner's height off (`theme.css`). */
const HEIGHT_VAR = '--app-banner-h';

/**
 * A banner across the top of every page while the server is in maintenance mode (an older version started on newer
 * data; see the version guard): what happened, a way to the details (the server's maintenance page, where an owner
 * confirms the rollback) and a joke from FICSIT's world, picked at random. The app asks `GET /api/version` once on
 * start and again whenever an API call is answered with 503; while the banner shows it asks every 10 s, and when
 * maintenance is over it loads everything again.
 */
export function MaintenanceBanner() {
  const qc = useQueryClient();
  const suspicion = useMaintenanceSuspicion(s => s.seq);
  const version = useQuery({
    queryKey: ['version'],
    queryFn: () => api<VersionDto>('GET', '/api/version'),
    retry: false,
    refetchOnWindowFocus: true,
    refetchInterval: q => (q.state.data?.maintenance ? RECHECK_MS : false),
  });
  const { refetch } = version;
  useEffect(() => {
    if (suspicion > 0) void refetch();
  }, [suspicion, refetch]);

  const active = version.data?.maintenance === true;
  // Over: everything that failed meanwhile loads again.
  const was = useRef(active);
  useEffect(() => {
    if (was.current && !active) void qc.invalidateQueries({ predicate: q => q.queryKey[0] !== 'version' });
    was.current = active;
  }, [active, qc]);

  return active ? <Banner version={version.data!.version} data={version.data!.dataVersion} /> : null;
}

function Banner({ version, data }: { version: string; data: string | undefined }) {
  const { t } = useTranslation();
  const [joke] = useState(() => Math.floor(Math.random() * MAINTENANCE_JOKES));
  const box = useRef<HTMLDivElement>(null);

  // Full-height pages give up the banner's height (it is fixed, so nothing else moves it out of the way).
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const root = document.documentElement;
    const set = () => root.style.setProperty(HEIGHT_VAR, `${el.offsetHeight}px`);
    set();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(set) : null;
    ro?.observe(el);
    return () => {
      ro?.disconnect();
      root.style.removeProperty(HEIGHT_VAR);
    };
  }, []);

  return (
    <div ref={box} role="alert" className="fixed inset-x-0 top-0 z-[10000] border-b border-line bg-raised shadow-lg" data-testid="maintenance-banner">
      <div aria-hidden="true" className="hazard h-1.5" />
      <div className="mx-auto flex max-w-5xl flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-2 text-sm">
        <strong className="font-display text-base font-semibold tracking-wide text-accent uppercase">{t('maintenance.title')}</strong>
        <span className="min-w-0 flex-1">
          {data ? t('maintenance.situation', { data, version }) : t('maintenance.situationUnknown')}
        </span>
        {/* A full page load: the server's own maintenance page, not a page of the app. */}
        <a href="/maintenance" className="font-medium text-accent underline-offset-2 hover:underline focus-ring">{t('maintenance.details')}</a>
        <p className="w-full text-muted italic" data-testid="maintenance-joke">{t(`maintenance.jokes.${joke}`)}</p>
      </div>
    </div>
  );
}
