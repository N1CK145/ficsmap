import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { IconButton } from './IconButton.js';

export interface DialogProps {
  open: boolean;
  onClose(): void;
  title?: ReactNode;
  /** Id of the element that names the dialog when there is no title. */
  labelledBy?: string;
  children: ReactNode;
  footer?: ReactNode;
}

/** Modal on the native <dialog> (focus trap, Esc, top layer). Content is only mounted while open. */
export function Dialog({ open, onClose, title, labelledBy, children, footer }: DialogProps) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    // jsdom has no showModal/close; the attribute keeps tests working.
    if (open && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    } else if (!open && d.open) {
      if (typeof d.close === 'function') d.close();
      else d.removeAttribute('open');
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={title ? titleId : labelledBy}
      // Esc: the parent decides. A close the browser forces anyway (or a form method=dialog) is reported too.
      onCancel={e => { e.preventDefault(); onClose(); }}
      onClose={() => { if (open) onClose(); }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded border border-line bg-panel p-0 text-fg backdrop:bg-bg/70"
    >
      {open && (
        <>
          <div className={`flex items-center gap-2 py-2 pr-2 pl-4 ${title ? 'justify-between border-b border-line' : 'justify-end'}`}>
            {title && <h2 id={titleId} className="font-display text-xl font-semibold">{title}</h2>}
            <IconButton aria-label={t('common.close')} size="sm" onClick={onClose}>
              <span aria-hidden="true">×</span>
            </IconButton>
          </div>
          <div className={title ? 'p-4' : 'px-4 pb-4'}>{children}</div>
          {footer && <div className="flex justify-end gap-2 border-t border-line px-4 py-3">{footer}</div>}
        </>
      )}
    </dialog>
  );
}
