import { useId, type ReactNode } from 'react';

/** A titled block in the sidebar or item panel. */
export function Panel({ title, children, className = '' }: { title?: ReactNode; children: ReactNode; className?: string }) {
  const titleId = useId();
  return (
    <section aria-labelledby={title ? titleId : undefined} className={`border-b border-line p-3 ${className}`}>
      {title && <h2 id={titleId} className="mb-2 font-display text-sm font-semibold tracking-wider text-muted uppercase">{title}</h2>}
      {children}
    </section>
  );
}
