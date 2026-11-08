import { useId, type ReactNode, type Ref } from 'react';
import { useTranslation } from 'react-i18next';
import { CloseIcon } from './icons.js';
import { IconButton } from './IconButton.js';

/**
 * The frame of every window-like box: the item panel, dialogs, floating boxes over the map. Gunmetal panel, a hairline
 * edge, two cut corners and a drop shadow. Popovers (menus) use `POPOVER`, the same frame with an orange top edge.
 */
export const WINDOW_FRAME = 'chamfer-window border border-line bg-panel text-fg shadow-[0_10px_30px_rgb(0_0_0/0.45)]';
export const POPOVER = `${WINDOW_FRAME} border-t-2 border-t-accent`;

export interface WindowTitleBarProps {
  title: ReactNode;
  /** The title's id, for the window's aria-labelledby. */
  titleId?: string;
  /**
   * A ref to the title. With it the title can take the focus from a script (tabIndex -1), so a window opened from a
   * button can move the focus into itself.
   */
  titleRef?: Ref<HTMLHeadingElement>;
  /** Heading level of the title; h2 by default. */
  level?: 2 | 3;
  /** A picture or icon before the title (decorative). */
  icon?: ReactNode;
  /** A second line under the title in normal case (a place, a count). */
  subtitle?: ReactNode;
  /** Buttons before the close button. */
  actions?: ReactNode;
  /** Shows the × button. */
  onClose?: () => void;
  closeLabel?: string;
  /** The rule on top: the accent, or the conflict colour for a window about destroying something. */
  tone?: 'accent' | 'danger';
}

/**
 * The title bar of a window: an orange rule on top, the title in condensed capitals, optional icon, subtitle and
 * actions, and the × on the right. Dialogs and the item panel use it; `Window` puts it on a frame.
 */
export function WindowTitleBar({ title, titleId, titleRef, level = 2, icon, subtitle, actions, onClose, closeLabel, tone = 'accent' }: WindowTitleBarProps) {
  const { t } = useTranslation();
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <div className={`flex shrink-0 items-center gap-2.5 border-t-2 border-b border-b-line bg-raised py-1.5 pr-1.5 pl-3 ${tone === 'danger' ? 'border-t-conflict' : 'border-t-accent'}`}>
      {icon !== undefined && <span aria-hidden="true" className="flex shrink-0 items-center">{icon}</span>}
      <div className="min-w-0 flex-1 py-0.5">
        <Heading id={titleId} ref={titleRef} tabIndex={titleRef ? -1 : undefined} className={`font-display text-lg leading-tight font-semibold tracking-wider [overflow-wrap:anywhere] uppercase ${titleRef ? 'focus:outline-none' : ''}`}>{title}</Heading>
        {subtitle !== undefined && <p className="truncate text-sm text-muted">{subtitle}</p>}
      </div>
      {actions}
      {onClose && (
        <IconButton aria-label={closeLabel ?? t('common.close')} title={closeLabel ?? t('common.close')} size="sm" onClick={onClose}>
          <CloseIcon />
        </IconButton>
      )}
    </div>
  );
}

export interface WindowProps extends Omit<WindowTitleBarProps, 'titleId'> {
  children: ReactNode;
  /** A bar of buttons under the content, right-aligned. */
  footer?: ReactNode;
  /**
   * The landmark or element: `section` (default, named by the title), `aside` for complementary boxes, `article` for a
   * self-contained entry (the machine wiki's), `div`.
   */
  as?: 'section' | 'aside' | 'article' | 'div';
  /** Layout only (width, position, max height). */
  className?: string;
  /** The content's padding and layout; `p-3` by default. */
  bodyClassName?: string;
}

/**
 * A window as in the game: a frame with a title bar, the content, and an optional footer of actions. Named by its
 * title. Use it for boxes that stand on their own (a result card, a floating box, a settings group); a plain block
 * inside a window takes a `SectionHeading` instead.
 */
export function Window({ children, footer, as: Tag = 'section', className = '', bodyClassName = 'p-3', ...bar }: WindowProps) {
  const titleId = useId();
  return (
    <Tag aria-labelledby={titleId} className={`flex flex-col overflow-hidden ${WINDOW_FRAME} ${className}`}>
      <WindowTitleBar {...bar} titleId={titleId} />
      <div className={`min-h-0 flex-1 ${bodyClassName}`}>{children}</div>
      {footer !== undefined && <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-line bg-bg/50 px-3 py-2">{footer}</div>}
    </Tag>
  );
}
