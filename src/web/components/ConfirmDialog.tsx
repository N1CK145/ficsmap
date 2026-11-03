import { useId, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from './Button.js';
import { Dialog } from './Dialog.js';

export interface ConfirmDialogProps {
  open: boolean;
  /** Optional: a single question in `message` also names the dialog. */
  title?: ReactNode;
  message: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** Destructive confirmations use the danger button. */
  danger?: boolean;
  busy?: boolean;
  onConfirm(): void;
  onCancel(): void;
}

export function ConfirmDialog(p: ConfirmDialogProps) {
  const { t } = useTranslation();
  const messageId = useId();
  return (
    <Dialog
      open={p.open}
      onClose={p.onCancel}
      title={p.title}
      labelledBy={messageId}
      footer={(
        <>
          <Button onClick={p.onCancel}>{p.cancelLabel ?? t('common.cancel')}</Button>
          <Button variant={p.danger ? 'danger' : 'primary'} disabled={p.busy} onClick={p.onConfirm}>{p.confirmLabel}</Button>
        </>
      )}
    >
      <div id={messageId}>{p.message}</div>
    </Dialog>
  );
}
