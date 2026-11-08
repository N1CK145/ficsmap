import { useId, type ReactNode } from 'react';
import { SectionHeading } from './SectionHeading.js';

/** A titled block in the sidebar or item panel: a `SectionHeading` over the content, a hairline under it. */
export function Panel({ title, end, children, className = '' }: { title?: ReactNode; end?: ReactNode; children: ReactNode; className?: string }) {
  const titleId = useId();
  return (
    <section aria-labelledby={title ? titleId : undefined} className={`border-b border-line p-3 ${className}`}>
      {title && <SectionHeading id={titleId} end={end} className="mb-2">{title}</SectionHeading>}
      {children}
    </section>
  );
}
