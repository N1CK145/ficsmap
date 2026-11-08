import { useQueryClient } from '@tanstack/react-query';
import { useId, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import type { ImportResultDto, WorldDto } from '../../../shared/api.js';
import type { DatasetIndex } from '../../../shared/dataset.js';
import { api } from '../../app/api.js';
import { queryKeys } from '../../app/queryKeys.js';
import { Button } from '../../components/Button.js';
import { useToast } from '../../components/Toast.js';
import { fieldClass } from '../../components/Field.js';
import { useDatasetQuery } from '../map/useDataset.js';
import { useMe } from '../worlds/queries.js';
import { WORLD_NAME_MAX, type CreateFromSaveProps } from '../worlds/CreateWorldDialog.js';
import { useImportBanner } from './ImportBanner.js';
import { EMPTY_MARKS, importRequest, SaveSummary } from './ImportDialog.js';
import { computePreview } from './preview.js';
import { SaveSource } from './SaveSource.js';
import { datasetUrlFor, useSaveParser } from './useSaveParser.js';

/** "From save file" in the create dialog (spec §7 "World from save", §10): parse, then create the world and import. */
export function CreateFromSave({ onClose }: CreateFromSaveProps) {
  const { t } = useTranslation();
  const me = useMe();
  const dataset = useDatasetQuery(me.data?.datasetVersion);
  if (!me.data || !dataset.data) {
    if (me.isError || dataset.isError) return <p role="alert" className="text-sm">{t('worlds.create.failed')}</p>;
    return <p className="text-muted">{t('common.loading')}</p>;
  }
  return <Flow version={me.data.datasetVersion} index={dataset.data} onClose={onClose} />;
}

function Flow({ version, index, onClose }: { version: string; index: DatasetIndex; onClose(): void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const parser = useSaveParser(datasetUrlFor(version));
  const [fileName, setFileName] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const inputId = useId();
  const result = parser.state.status === 'done' ? parser.state.result : undefined;
  const trimmed = name.trim();

  function pick(file: File) {
    setFileName(file.name);
    setName('');
    setFailed(false);
    parser.start(file);
  }

  // The name is prefilled from the save once it is parsed; the user may change it.
  const [prefilledFor, setPrefilledFor] = useState<typeof result>();
  if (result && prefilledFor !== result) {
    setPrefilledFor(result);
    setName(result.meta.sessionName.trim().slice(0, WORLD_NAME_MAX));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!result || trimmed.length < 1 || trimmed.length > WORLD_NAME_MAX) return;
    setBusy(true);
    setFailed(false);
    let world: WorldDto;
    try {
      world = await api<WorldDto>('POST', '/api/worlds', { name: trimmed });
    } catch {
      setFailed(true);
      setBusy(false);
      return;
    }
    try {
      const out = await api<ImportResultDto>('POST', `/api/worlds/${encodeURIComponent(world.id)}/import`, importRequest(fileName, result));
      useImportBanner.getState().show(world.id, { added: out.newlyChecked, conflicts: out.conflicts });
    } catch {
      toast.show({ message: t('import.createImportFailed') });
    }
    void queryClient.invalidateQueries({ queryKey: queryKeys.worlds() });
    onClose();
    navigate(`/w/${world.id}`);
  }

  if (!result) return <SaveSource parser={parser} onPick={pick} />;
  return (
    <form onSubmit={e => void submit(e)} className="flex flex-col gap-3">
      <SaveSummary result={result} index={index} preview={computePreview(result, EMPTY_MARKS, index)} counts={false} />
      <label htmlFor={inputId} className="text-sm font-medium">{t('worlds.create.name')}</label>
      <input
        id={inputId}
        value={name}
        maxLength={WORLD_NAME_MAX}
        autoComplete="off"
        onChange={e => setName(e.target.value)}
        className={fieldClass()}
      />
      {failed && <p role="alert" className="text-sm">{t('worlds.create.failed')}</p>}
      <div className="flex justify-end gap-2">
        <Button onClick={parser.cancel}>{t('import.chooseAnother')}</Button>
        <Button type="submit" variant="primary" disabled={busy || trimmed.length === 0}>{t('worlds.create.submit')}</Button>
      </div>
    </form>
  );
}
