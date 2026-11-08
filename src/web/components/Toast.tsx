import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button } from './Button.js';

export interface ToastInput {
  message: string;
  action?: { label: string; run(): void };
  /** Default 6000 (spec §10.3). */
  durationMs?: number;
  /**
   * Moves the focus to the action when the toast shows, so keyboard and screen reader users reach it (an Undo after
   * something was cleared). The toast then stays until the focus leaves it.
   */
  focusAction?: boolean;
}

export interface ToastApi { show(t: ToastInput): void }

const DEFAULT_DURATION_MS = 6000;
const ToastContext = createContext<ToastApi | null>(null);

/**
 * Shows one toast at a time; a new one replaces the current one and restarts the timer. The toast
 * sits above the mobile bottom sheet's peek (`--ficsmap-toast-offset`, set by the sheet).
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<(ToastInput & { id: number }) | null>(null);
  const nextId = useRef(0);
  const api = useMemo<ToastApi>(() => ({ show: t => setToast({ ...t, id: ++nextId.current }) }), []);

  return (
    <ToastContext value={api}>
      {children}
      <div
        role="status"
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--ficsmap-toast-offset,0px)+1rem)] z-[1300] flex justify-center px-4"
      >
        {toast && <ToastView key={toast.id} toast={toast} onDone={() => setToast(null)} />}
      </div>
    </ToastContext>
  );
}

/**
 * One toast and its dismiss timer. The timer pauses while the pointer is over the toast or the
 * focus is in it (WCAG 2.2.1), and resumes with the time that was left. With `focusAction` its action takes the focus.
 */
function ToastView({ toast, onDone }: { toast: ToastInput; onDone(): void }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const remaining = useRef(toast.durationMs ?? DEFAULT_DURATION_MS);
  const paused = hovered || focused;
  const done = useRef(onDone);
  useEffect(() => { done.current = onDone; });
  const actionRef = useRef<HTMLButtonElement>(null);
  const focusAction = toast.focusAction === true;
  useEffect(() => {
    if (focusAction) actionRef.current?.focus();
  }, [focusAction]);

  useEffect(() => {
    if (paused) return;
    const started = Date.now();
    const timer = setTimeout(() => done.current(), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current -= Date.now() - started;
    };
  }, [paused]);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false); }}
      className="pointer-events-auto flex max-w-full items-center gap-3 chamfer-window border border-l-[3px] border-line border-l-accent bg-raised py-2 pr-2 pl-4 shadow-[0_10px_30px_rgb(0_0_0/0.45)]"
    >
      <span className="min-w-0">{toast.message}</span>
      {toast.action && (
        <Button ref={actionRef} variant="link-accent" size="sm" onClick={() => { toast.action?.run(); onDone(); }}>
          {toast.action.label}
        </Button>
      )}
    </div>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast must be used inside <ToastProvider>');
  return api;
}
