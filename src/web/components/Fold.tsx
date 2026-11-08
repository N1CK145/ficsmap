import { useState, type ReactNode } from 'react';
import { ChevronDownIcon } from './icons.js';
import { SECTION_HEADING, SectionMarker } from './SectionHeading.js';

export interface FoldProps {
  /** The heading of the fold, in the section heading look. */
  title: ReactNode;
  /** A short line after the title, in normal case: the values in effect while it is folded. */
  summary?: ReactNode;
  /** Open at first (it remembers being opened or closed on its own afterwards). */
  defaultOpen?: boolean;
  children: ReactNode;
  /** Frame and spacing of the whole fold (e.g. `WINDOW_FRAME` for a box of its own, or a top rule inside a window). */
  className?: string;
  /** Padding of the summary row; `py-2` by default. */
  summaryClassName?: string;
  /** Padding and layout of the content. */
  bodyClassName?: string;
}

/**
 * A block folded away until asked, for settings that are rarely changed: a native `<details>` whose summary looks like
 * a section heading (`▍ TITLE  values in effect  ⌄`, the marker grey while folded) and works with the keyboard as a
 * button (an inset focus ring, so a window's frame does not cut it off). The content stays in the document while
 * folded.
 */
export function Fold({ title, summary, defaultOpen = false, children, className = '', summaryClassName = 'py-2', bodyClassName = '' }: FoldProps) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details open={open} onToggle={e => setOpen(e.currentTarget.open)} className={className}>
      <summary className={`group flex min-h-10 cursor-pointer list-none items-center gap-3 transition-colors hover:bg-raised focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none focus-visible:ring-inset [&::-webkit-details-marker]:hidden ${summaryClassName}`}>
        <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-0.5">
          <span className={`${SECTION_HEADING} group-hover:text-fg`}>
            <SectionMarker muted={!open} />
            {title}
          </span>
          {summary !== undefined && <span className="min-w-0 flex-1 basis-40 text-sm text-muted tabular-nums">{summary}</span>}
        </span>
        <ChevronDownIcon size={14} className={`text-muted group-hover:text-fg motion-safe:transition-transform ${open ? '' : '-rotate-90'}`} />
      </summary>
      <div className={bodyClassName}>{children}</div>
    </details>
  );
}
