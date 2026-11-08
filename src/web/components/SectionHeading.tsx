import type { ReactNode } from 'react';

/** The heading look of a section: condensed capitals in the muted grey, a short orange bar in front. */
export const SECTION_HEADING = 'flex min-w-0 items-center gap-2 font-display text-sm font-semibold tracking-[0.1em] text-muted uppercase';

/**
 * The short orange bar in front of a section heading (also usable before a custom heading, e.g. a fold button);
 * `muted` greys it out (a folded panel), turning orange again on the hover of a `group` around it; `lg` is for page
 * titles.
 */
export function SectionMarker({ muted = false, size = 'sm', className = '' }: { muted?: boolean; size?: 'sm' | 'lg'; className?: string }) {
  const box = size === 'lg' ? 'h-5 w-1' : 'h-3 w-[3px]';
  return <span aria-hidden="true" className={`${box} shrink-0 ${muted ? 'bg-edge group-hover:bg-accent' : 'bg-accent'} ${className}`} />;
}

export interface SectionHeadingProps {
  children: ReactNode;
  /** The heading level; h2 by default. */
  as?: 'h2' | 'h3' | 'h4';
  id?: string;
  /** Right-aligned extra (a count, a small action) after a hairline that fills the row. */
  end?: ReactNode;
  className?: string;
}

/**
 * A section heading as in the game's panels: `▍ TITLE ───── end`. For blocks inside a panel or window (the item
 * panel's sections, a group in a form); a window's own title goes in its title bar (`Window`).
 */
export function SectionHeading({ children, as: Tag = 'h2', id, end, className = '' }: SectionHeadingProps) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Tag id={id} className={SECTION_HEADING}><SectionMarker />{children}</Tag>
      <span aria-hidden="true" className="h-px min-w-3 flex-1 bg-line" />
      {end !== undefined && <span className="shrink-0 text-sm text-muted tabular-nums">{end}</span>}
    </div>
  );
}
