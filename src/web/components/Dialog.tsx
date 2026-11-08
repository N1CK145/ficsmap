import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CloseIcon } from './icons.js';
import { IconButton } from './IconButton.js';
import { WINDOW_FRAME, WindowTitleBar } from './Window.js';

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
      className={`m-auto w-[calc(100%-2rem)] max-w-md p-0 ${WINDOW_FRAME} backdrop:bg-bg/75 backdrop:backdrop-blur-[2px]`}
    >
      {open && (
        <>
          {title
            ? <WindowTitleBar title={title} titleId={titleId} onClose={onClose} />
            : (
              <div className="flex justify-end border-t-2 border-t-accent py-1.5 pr-1.5">
                <IconButton aria-label={t('common.close')} size="sm" onClick={onClose}><CloseIcon /></IconButton>
              </div>
            )}
          <div className={title ? 'p-4' : 'px-4 pb-4'}>{children}</div>
          {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line bg-bg/50 px-4 py-3">{footer}</div>}
        </>
      )}
    </dialog>
  );
}
