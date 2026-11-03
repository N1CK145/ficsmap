import { useQueryClient } from '@tanstack/react-query';
import { useId, useRef, useState, type FC, type FormEvent, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import type { WorldDto } from '../../../shared/api.js';
import { api } from '../../app/api.js';
import { queryKeys } from '../../app/queryKeys.js';
import { Button } from '../../components/Button.js';
import { Dialog } from '../../components/Dialog.js';

export const WORLD_NAME_MAX = 80;

export interface CreateFromSaveProps {
  /** Closes the dialog (for example after the world was created and opened). */
  onClose(): void;
}

let fromSaveContent: FC<CreateFromSaveProps> | null = null;

/** The import feature puts its save-file flow into the "From save file" tab here. */
export function setCreateFromSaveContent(c: FC<CreateFromSaveProps> | null): void {
  fromSaveContent = c;
}

/** The "From save file" tab: the registered content, or a placeholder until there is one. */
export function CreateFromSaveSlot(props: CreateFromSaveProps) {
  const { t } = useTranslation();
  const Content = fromSaveContent;
  return Content ? <Content {...props} /> : <p className="text-muted">{t('worlds.create.comingSoon')}</p>;
}

type Tab = 'empty' | 'save';
// From a save first: it is the most useful start (an empty world shows every collectible as open).
const TABS: readonly Tab[] = ['save', 'empty'];

export function CreateWorldDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>('save');
  const baseId = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);

  function onTabKey(e: KeyboardEvent, index: number) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const next = (index + (e.key === 'ArrowRight' ? 1 : -1) + TABS.length) % TABS.length;
    const nextTab = TABS[next];
    if (!nextTab) return;
    setTab(nextTab);
    tabRefs.current[next]?.focus();
  }

  return (
    <Dialog open={open} onClose={onClose} title={t('worlds.create.title')}>
      <div role="tablist" aria-label={t('worlds.create.title')} className="mb-4 flex gap-1 border-b border-line">
        {TABS.map((id, i) => (
          <button
            key={id}
            ref={el => { tabRefs.current[i] = el; }}
            type="button"
            role="tab"
            id={`${baseId}-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`${baseId}-panel`}
            tabIndex={tab === id ? 0 : -1}
            onClick={() => setTab(id)}
            onKeyDown={e => onTabKey(e, i)}
            className={`-mb-px h-10 border-b-2 px-3 text-sm font-medium focus-ring ${tab === id ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg'}`}
          >
            {t(`worlds.create.tab.${id}`)}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${baseId}-panel`} aria-labelledby={`${baseId}-tab-${tab}`}>
        {tab === 'empty' ? <StartEmpty onClose={onClose} /> : <CreateFromSaveSlot onClose={onClose} />}
      </div>
    </Dialog>
  );
}

function StartEmpty({ onClose }: { onClose(): void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const inputId = useId();
  const trimmed = name.trim();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (trimmed.length < 1 || trimmed.length > WORLD_NAME_MAX) return;
    setBusy(true);
    setFailed(false);
    try {
      const world = await api<WorldDto>('POST', '/api/worlds', { name: trimmed });
      void queryClient.invalidateQueries({ queryKey: queryKeys.worlds() });
      onClose();
      navigate(`/w/${world.id}`);
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <form onSubmit={e => void submit(e)} className="flex flex-col gap-3">
      <label htmlFor={inputId} className="text-sm font-medium">{t('worlds.create.name')}</label>
      <input
        id={inputId}
        value={name}
        maxLength={WORLD_NAME_MAX}
        autoComplete="off"
        onChange={e => setName(e.target.value)}
        className="h-10 rounded border border-line bg-bg px-3 text-fg focus-ring"
      />
      {failed && <p role="alert" className="text-sm">{t('worlds.create.failed')}</p>}
      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>{t('common.cancel')}</Button>
        <Button type="submit" variant="primary" disabled={busy || trimmed.length === 0}>{t('worlds.create.submit')}</Button>
      </div>
    </form>
  );
}
