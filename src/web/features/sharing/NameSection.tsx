import { useMutation } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { WorldCtx } from '../../app/feature.js';
import { api } from '../../app/api.js';
import { queryKeys } from '../../app/queryKeys.js';
import { Button } from '../../components/Button.js';
import { fieldClass } from '../../components/Field.js';
import { SettingsBlock } from './SettingsPage.js';

const MAX_NAME = 80;

/** Rename the world (owner and admins): 1-80 characters after trimming. */
export function NameSection({ ctx }: { ctx: WorldCtx }) {
  const { t } = useTranslation();
  const { worldId, world, queryClient, toast } = ctx;
  const [draft, setDraft] = useState(world.name);
  // A rename from elsewhere shows up in the field unless the user is in the middle of editing it.
  const [seen, setSeen] = useState(world.name);
  if (seen !== world.name) {
    setSeen(world.name);
    if (draft === seen) setDraft(world.name);
  }
  const name = draft.trim();
  const valid = name.length >= 1 && name.length <= MAX_NAME;

  const rename = useMutation({
    mutationFn: () => api('PATCH', `/api/worlds/${encodeURIComponent(worldId)}`, { name }),
    onSuccess: async () => {
      toast.show({ message: t('settings.name.saved') });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.world(worldId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.worlds() }),
      ]);
      setDraft(name);
    },
    onError: () => toast.show({ message: t('settings.name.failed') }),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (valid && name !== world.name && !rename.isPending) rename.mutate();
  }

  return (
    <SettingsBlock title={t('settings.name.title')}>
      <form onSubmit={submit} className="flex gap-2">
        <input
          aria-label={t('settings.name.label')}
          value={draft}
          maxLength={MAX_NAME + 20}
          onChange={e => setDraft(e.target.value)}
          className={fieldClass({}, 'min-w-0 flex-1')}
        />
        <Button type="submit" variant="primary" disabled={!valid || name === world.name || rename.isPending}>{t('settings.name.save')}</Button>
      </form>
    </SettingsBlock>
  );
}
