import { useMutation } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { CreatedUploadTokenDto, UploadTokenDto } from '../../../shared/api.js';
import { MAX_UPLOAD_TOKEN_LABEL } from '../../../shared/saveUpload.js';
import { ApiClientError } from '../../app/api.js';
import type { WorldCtx } from '../../app/feature.js';
import { queryKeys } from '../../app/queryKeys.js';
import { Badge } from '../../components/Badge.js';
import { Button } from '../../components/Button.js';
import { ConfirmDialog } from '../../components/ConfirmDialog.js';
import { FIELD_LABEL, fieldClass, NumberField } from '../../components/Field.js';
import { ReadonlyCopyField } from '../../components/ReadonlyCopyField.js';
import { SectionHeading } from '../../components/SectionHeading.js';
import { SegmentedControl } from '../../components/SegmentedControl.js';
import { SettingsBlock } from '../sharing/SettingsPage.js';
import { createUploadToken, revokeUploadToken, useUploadTokens } from './api.js';
import {
  configProblems, POLL_DEFAULT, POLL_MAX, POLL_MIN, runSteps, watcherDownload, WATCH_PLATFORMS,
  type UploadMode, type WatchConfig, type WatchPlatform,
} from './generate.js';
import { PRESETS_FOR, SAVE_PRESETS, type SavePreset } from './paths.js';

/** Hands a file to the browser's download (a link to a Blob URL, clicked once). */
export function downloadFile(fileName: string, mime: string, data: Uint8Array): void {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A block of code (a command, a snippet) with a Copy button. */
function CodeBlock({ label, code }: { label: string; code: string }) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const labelId = useId();
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
    } catch {
      // No clipboard access: the text stays selectable.
    }
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-end justify-between gap-2">
        <span id={labelId} className={FIELD_LABEL}>{label}</span>
        <Button size="sm" variant="ghost" onClick={() => void copy()} aria-describedby={labelId}>{copied ? t('saveWatcher.copied') : t('saveWatcher.copy')}</Button>
      </div>
      <pre aria-labelledby={labelId} tabIndex={0} className="overflow-x-auto chamfer border border-line bg-bg p-3 font-mono text-xs whitespace-pre text-fg focus-ring max-[899px]:text-sm">{code}</pre>
    </div>
  );
}

function TokenRow({ token, onRevoke }: { token: UploadTokenDto; onRevoke(): void }) {
  const { t, i18n } = useTranslation();
  const fmt = (ms: number) => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(ms);
  return (
    <li aria-label={token.label} className="flex items-center gap-3 border-b border-line py-2 last:border-b-0">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="truncate font-medium">{token.label}</span>
          {token.anySession && <Badge tone="power">{t('saveWatcher.tokens.anySessionBadge')}</Badge>}
        </div>
        <span className="text-xs text-muted max-[899px]:text-sm">
          {t('saveWatcher.tokens.created', { date: fmt(token.createdAt), name: token.createdBy ?? '—' })}
          {' · '}
          {token.lastUsedAt === null ? t('saveWatcher.tokens.neverUsed') : t('saveWatcher.tokens.lastUsed', { date: fmt(token.lastUsedAt) })}
        </span>
      </div>
      <Button size="sm" variant="secondary" onClick={onRevoke} aria-label={t('saveWatcher.tokens.revokeNamed', { name: token.label })}>
        {t('saveWatcher.tokens.revoke')}
      </Button>
    </li>
  );
}

/** Step 1: create, show once, list and revoke upload tokens. */
function TokensPart({ ctx, created, onCreated }: { ctx: WorldCtx; created: CreatedUploadTokenDto | null; onCreated(c: CreatedUploadTokenDto | null): void }) {
  const { t } = useTranslation();
  const { worldId, queryClient, toast } = ctx;
  const tokens = useUploadTokens(worldId);
  const [label, setLabel] = useState('');
  const [anySession, setAnySession] = useState(false);
  const [revoking, setRevoking] = useState<UploadTokenDto | null>(null);
  const labelId = useId();
  const anyId = useId();
  const anyHintId = useId();
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.uploadTokens(worldId) });

  const create = useMutation({
    mutationFn: () => createUploadToken(worldId, { label: label.trim(), anySession }),
    onSuccess: async c => {
      onCreated(c);
      setLabel('');
      setAnySession(false);
      await refresh();
    },
    onError: err => toast.show({
      message: err instanceof ApiClientError && err.code === 'limit_reached' ? t('saveWatcher.tokens.limit') : t('saveWatcher.tokens.createFailed'),
    }),
  });

  const revoke = useMutation({
    mutationFn: (id: number) => revokeUploadToken(worldId, id),
    onSuccess: async (_v, id) => {
      setRevoking(null);
      if (created?.token.id === id) onCreated(null);
      toast.show({ message: t('saveWatcher.tokens.revoked') });
      await refresh();
    },
    onError: () => {
      setRevoking(null);
      toast.show({ message: t('saveWatcher.tokens.revokeFailed') });
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (label.trim() && !create.isPending) create.mutate();
  }

  const list = tokens.data ?? [];
  return (
    <div className="flex flex-col gap-3">
      <SectionHeading as="h4" end={list.length > 0 ? list.length : undefined}>{t('saveWatcher.tokens.title')}</SectionHeading>
      {tokens.isError && <p role="alert" className="text-sm text-conflict">{t('saveWatcher.tokens.loadFailed')}</p>}
      {tokens.isSuccess && list.length === 0 && <p className="text-sm text-muted">{t('saveWatcher.tokens.none')}</p>}
      {list.length > 0 && <ul aria-label={t('saveWatcher.tokens.title')} className="flex flex-col">{list.map(tok => <TokenRow key={tok.id} token={tok} onRevoke={() => setRevoking(tok)} />)}</ul>}

      {created && (
        <div role="status" className="flex flex-col gap-2 chamfer border border-accent/50 bg-accent/8 p-3">
          <p className="text-sm font-semibold">{t('saveWatcher.tokens.createdTitle', { name: created.token.label })}</p>
          <ReadonlyCopyField
            label={t('saveWatcher.tokens.secretLabel')}
            value={created.secret}
            copyLabel={t('saveWatcher.copy')}
            copiedLabel={t('saveWatcher.copied')}
            hint={t('saveWatcher.tokens.secretHint')}
          />
        </div>
      )}

      <form onSubmit={submit} className="flex flex-col gap-2">
        <label htmlFor={labelId} className={FIELD_LABEL}>{t('saveWatcher.tokens.label')}</label>
        <div className="flex flex-wrap gap-2">
          <input
            id={labelId}
            value={label}
            maxLength={MAX_UPLOAD_TOKEN_LABEL}
            placeholder={t('saveWatcher.tokens.labelPlaceholder')}
            onChange={e => setLabel(e.target.value)}
            className={fieldClass({}, 'min-w-0 flex-1 basis-48')}
          />
          <Button type="submit" variant={created ? 'secondary' : 'primary'} disabled={!label.trim() || create.isPending}>{t('saveWatcher.tokens.create')}</Button>
        </div>
        <div className="flex items-start gap-2">
          <input id={anyId} type="checkbox" checked={anySession} onChange={e => setAnySession(e.target.checked)} aria-describedby={anyHintId} className="mt-0.5 size-4 shrink-0 accent-accent focus-ring max-[899px]:size-5" />
          <div className="flex flex-col">
            <label htmlFor={anyId} className="text-sm">{t('saveWatcher.tokens.anySession')}</label>
            <span id={anyHintId} className="text-xs text-muted max-[899px]:text-sm">{t('saveWatcher.tokens.anySessionHint')}</span>
          </div>
        </div>
      </form>

      <ConfirmDialog
        open={revoking !== null}
        danger
        busy={revoke.isPending}
        message={t('saveWatcher.tokens.revokeConfirm', { name: revoking?.label ?? '' })}
        confirmLabel={t('saveWatcher.tokens.revokeAction')}
        onConfirm={() => { if (revoking) revoke.mutate(revoking.id); }}
        onCancel={() => setRevoking(null)}
      />
    </div>
  );
}

const PLATFORM_DEFAULT = (p: WatchPlatform): string => SAVE_PRESETS[PRESETS_FOR[p][0]!];
const PRESET_VALUES = new Set(Object.values(SAVE_PRESETS));

/** Step 2: configure and download the script, and how to run it. */
function GeneratorPart({ ctx, secret }: { ctx: WorldCtx; secret: string | undefined }) {
  const { t } = useTranslation();
  const { worldId, world } = ctx;
  const [platform, setPlatform] = useState<WatchPlatform>('powershell');
  const [saveDir, setSaveDir] = useState(PLATFORM_DEFAULT('powershell'));
  const [session, setSession] = useState(world.lastImport?.sessionName ?? '');
  const [poll, setPoll] = useState(String(POLL_DEFAULT));
  const [mode, setMode] = useState<UploadMode>('newest');
  const [typedToken, setTypedToken] = useState('');
  const [downloaded, setDownloaded] = useState(false);
  // A freshly created token fills the field; a token typed in by hand wins.
  const [seenSecret, setSeenSecret] = useState(secret);
  if (seenSecret !== secret) {
    setSeenSecret(secret);
    if (secret) setTypedToken(secret);
  }
  const ids = { token: useId(), dir: useId(), preset: useId(), session: useId(), hint: useId(), warn: useId(), problems: useId() };

  function choosePlatform(p: WatchPlatform) {
    setPlatform(p);
    // Keep a folder the user typed; swap a preset for the new platform's default.
    if (PRESET_VALUES.has(saveDir.trim()) || saveDir.trim() === '') setSaveDir(PLATFORM_DEFAULT(p));
    setDownloaded(false);
  }

  const config: WatchConfig = {
    serverUrl: window.location.origin,
    worldId,
    token: typedToken.trim(),
    saveDir,
    sessionFilter: session.trim(),
    pollSeconds: Number(poll),
    mode,
  };
  const problems = configProblems(config);
  const presets = PRESETS_FOR[platform];

  function download() {
    if (problems.length > 0) return;
    const file = watcherDownload(platform, config);
    downloadFile(file.fileName, file.mime, file.data);
    setDownloaded(true);
  }

  const platformLabel: Record<WatchPlatform, string> = {
    docker: t('saveWatcher.platform.docker'), bash: t('saveWatcher.platform.bash'), powershell: t('saveWatcher.platform.powershell'),
  };

  return (
    <div className="flex flex-col gap-3">
      <SectionHeading as="h4">{t('saveWatcher.script.title')}</SectionHeading>
      <div className="flex flex-col gap-1">
        <span className={FIELD_LABEL}>{t('saveWatcher.platform.label')}</span>
        <div className="max-w-full overflow-x-auto">
          <SegmentedControl label={t('saveWatcher.platform.label')} options={WATCH_PLATFORMS.map(p => ({ value: p, label: platformLabel[p] }))} value={platform} onChange={choosePlatform} />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={ids.token} className={FIELD_LABEL}>{t('saveWatcher.script.token')}</label>
        <input
          id={ids.token}
          value={typedToken}
          onChange={e => setTypedToken(e.target.value)}
          spellCheck={false}
          autoComplete="off"
          placeholder="fsm_…"
          aria-invalid={typedToken !== '' && problems.includes('token')}
          aria-describedby={`${ids.token}-hint`}
          className={fieldClass({}, 'min-w-0 font-mono text-sm')}
        />
        <p id={`${ids.token}-hint`} className="text-xs text-muted max-[899px]:text-sm">{secret ? t('saveWatcher.script.tokenFromNew') : t('saveWatcher.script.tokenHint')}</p>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={ids.dir} className={FIELD_LABEL}>{platform === 'docker' ? t('saveWatcher.script.folderDocker') : t('saveWatcher.script.folder')}</label>
        <input
          id={ids.dir}
          value={saveDir}
          onChange={e => setSaveDir(e.target.value)}
          spellCheck={false}
          aria-describedby={ids.hint}
          aria-invalid={problems.includes('saveDir')}
          className={fieldClass({}, 'min-w-0 font-mono text-sm')}
        />
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={ids.preset} className="text-xs text-muted max-[899px]:text-sm">{t('saveWatcher.script.presets')}</label>
          <select
            id={ids.preset}
            value={presets.find(p => SAVE_PRESETS[p] === saveDir.trim()) ?? ''}
            onChange={e => { if (e.target.value) setSaveDir(SAVE_PRESETS[e.target.value as SavePreset]); }}
            className={fieldClass({ size: 'sm' }, 'min-w-0 max-w-full')}
          >
            <option value="">{t('saveWatcher.script.presetOwn')}</option>
            {presets.map(p => <option key={p} value={p}>{t(`saveWatcher.presets.${p}`)}</option>)}
          </select>
        </div>
        <p id={ids.hint} className="text-xs text-muted max-[899px]:text-sm">{t('saveWatcher.script.folderHint')}</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label htmlFor={ids.session} className={FIELD_LABEL}>{t('saveWatcher.script.session')}</label>
          <input id={ids.session} value={session} onChange={e => setSession(e.target.value)} aria-describedby={`${ids.session}-hint`} className={fieldClass({}, 'min-w-0')} />
          <p id={`${ids.session}-hint`} className="text-xs text-muted max-[899px]:text-sm">{t('saveWatcher.script.sessionHint')}</p>
        </div>
        <NumberField
          label={t('saveWatcher.script.poll')}
          unit={t('saveWatcher.script.seconds')}
          hint={t('saveWatcher.script.pollHint', { min: POLL_MIN, max: POLL_MAX })}
          min={POLL_MIN}
          max={POLL_MAX}
          step={1}
          value={poll}
          onChange={e => setPoll(e.target.value)}
          aria-invalid={problems.includes('pollSeconds')}
          boxClassName="max-w-40"
        />
      </div>

      <fieldset className="flex flex-col gap-1">
        <legend className={`${FIELD_LABEL} mb-1`}>{t('saveWatcher.script.mode')}</legend>
        {(['newest', 'all'] as const).map(m => (
          <label key={m} className="flex items-start gap-2 text-sm">
            <input type="radio" name="save-watcher-mode" value={m} checked={mode === m} onChange={() => setMode(m)} className="mt-0.5 size-4 shrink-0 accent-accent focus-ring max-[899px]:size-5" />
            <span className="flex flex-col">
              <span>{t(`saveWatcher.script.modes.${m}`)}</span>
              <span className="text-xs text-muted max-[899px]:text-sm">{t(`saveWatcher.script.modes.${m}Hint`)}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <p id={ids.warn} className="flex gap-2 chamfer border border-power/50 bg-power/8 p-3 text-sm">
        <span aria-hidden="true" className="font-bold text-power">!</span>
        <span>{t('saveWatcher.script.warning')}</span>
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={download} disabled={problems.length > 0} aria-describedby={`${ids.warn}${problems.length > 0 ? ` ${ids.problems}` : ''}`}>
          {t('saveWatcher.script.download', { file: platform === 'docker' ? 'ficsmap-watch.zip' : platform === 'bash' ? 'ficsmap-watch.sh' : 'ficsmap-watch.ps1' })}
        </Button>
        {problems.length > 0 && (
          <span id={ids.problems} className="text-sm text-muted">{t(`saveWatcher.problems.${problems.includes('token') ? 'token' : problems[0]}`)}</span>
        )}
        {downloaded && <span role="status" className="text-sm text-free">{t('saveWatcher.script.downloaded')}</span>}
      </div>

      <div className="flex flex-col gap-3">
        <SectionHeading as="h4">{t('saveWatcher.run.title')}</SectionHeading>
        {runSteps(platform, config).map(step => (
          <CodeBlock key={step.id} label={t(`saveWatcher.run.${platform}.${step.id}`)} code={step.code} />
        ))}
        <p className="text-xs text-muted max-[899px]:text-sm">{t(`saveWatcher.run.${platform}.note`)}</p>
      </div>
    </div>
  );
}

/**
 * World settings → "Automatic upload" (owner): upload tokens for the save watcher and its script generator. A script
 * on the player's PC or server watches the save folder and uploads every new save; the server parses it like an
 * import (`POST /api/worlds/:id/saves`).
 */
export function SaveWatcherSection({ ctx }: { ctx: WorldCtx }) {
  const { t } = useTranslation();
  const [created, setCreated] = useState<CreatedUploadTokenDto | null>(null);
  return (
    <SettingsBlock title={t('saveWatcher.title')}>
      <p className="text-sm text-muted">{t('saveWatcher.intro')}</p>
      <TokensPart ctx={ctx} created={created} onCreated={setCreated} />
      <GeneratorPart ctx={ctx} secret={created?.secret} />
    </SettingsBlock>
  );
}
