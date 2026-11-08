import type { ReactNode } from 'react';

/**
 * The app's line icons: 16 x 16, drawn in `currentColor`, decorative (hidden from screen readers; the control next to
 * them carries the name). One stroke weight for all, so they read as one set next to the condensed type.
 */
function Icon({ children, size = 16, className = '' }: { children: ReactNode; size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" focusable="false"
      fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
      className={`shrink-0 ${className}`}>
      {children}
    </svg>
  );
}

export interface IconProps { size?: number; className?: string }

export const CloseIcon = (p: IconProps) => <Icon {...p}><path d="M4 4l8 8M12 4l-8 8" /></Icon>;
export const ChevronDownIcon = (p: IconProps) => <Icon {...p}><path d="M3.5 6l4.5 4.5L12.5 6" /></Icon>;
export const BackIcon = (p: IconProps) => <Icon {...p}><path d="M13 8H3.5M7.5 4L3.5 8l4 4" /></Icon>;
export const MenuIcon = (p: IconProps) => <Icon {...p}><path d="M2.5 4h11M2.5 8h11M2.5 12h11" /></Icon>;
export const SidebarIcon = (p: IconProps) => <Icon {...p}><path d="M2.5 3h11v10h-11zM6.5 3v10" /></Icon>;
export const UploadIcon = (p: IconProps) => <Icon {...p}><path d="M8 10.5V2.5M4.75 5.75L8 2.5l3.25 3.25M2.5 10v3.5h11V10" /></Icon>;
export const GearIcon = (p: IconProps) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="2.1" />
    <path d="M8 1.75v1.7M8 12.55v1.7M14.25 8h-1.7M3.45 8h-1.7M12.42 3.58l-1.2 1.2M4.78 11.22l-1.2 1.2M12.42 12.42l-1.2-1.2M4.78 4.78l-1.2-1.2" />
    <circle cx="8" cy="8" r="4.4" />
  </Icon>
);
/** Three sliders (no longer in the top bar; kept for features that want a settings glyph). */
export const SlidersIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2 4h12M2 8h12M2 12h12" opacity="0.55" />
    <circle cx="5" cy="4" r="1.6" fill="currentColor" /><circle cx="11" cy="8" r="1.6" fill="currentColor" /><circle cx="7" cy="12" r="1.6" fill="currentColor" />
  </Icon>
);
/** A cave mouth in a rock face. */
export const CaveIcon = (p: IconProps) => <Icon {...p}><path d="M1.5 13.5L5 4.5l2 2 2-3.5 5.5 10.5zM5.75 13.5c0-2.2 1-3.5 2.25-3.5s2.25 1.3 2.25 3.5" /></Icon>;
/** Contour lines around a summit, as on a topographic map: the height map layer (not a mountain, that is the caves'). */
export const HeightIcon = (p: IconProps) => (
  <Icon {...p}>
    <path d="M2 8.5c0-3.4 2.9-6 6.3-5.8 3.2.2 5.9 2.6 5.7 5.6-.2 3-3 5.2-6.2 5.2C4.6 13.5 2 11.6 2 8.5z" />
    <path d="M5 8.4c0-1.8 1.6-3.1 3.3-3 1.6.1 2.9 1.3 2.8 2.9-.1 1.5-1.5 2.6-3.1 2.6-1.7 0-3-1-3-2.5z" />
    <circle cx="8.2" cy="8.2" r="0.6" fill="currentColor" />
  </Icon>
);
/** A folded map: the map tab. */
export const MapIcon = (p: IconProps) => <Icon {...p}><path d="M1.5 3.75L5.5 2.25l5 2 4-1.5v10l-4 1.5-5-2-4 1.5zM5.5 2.25v10M10.5 4.25v10" /></Icon>;
/** An ore lump on a node: the resource node layer. */
export const OreIcon = (p: IconProps) => <Icon {...p}><path d="M3 10.5l1.5-5 4-2.5 4 2.5 1 5-4.5 3zM4.5 5.5l4 2.5 4.5-2.5M8.5 8v5.5" /></Icon>;
/** A gear on a machine body: the machine wiki. */
export const MachineIcon = (p: IconProps) => <Icon {...p}><path d="M2 13.5V6l3.5 2V6l3.5 2V3.5h5v10z" /><path d="M5 11h1.5M9 11h1.5" /></Icon>;
/** Three boxes joined by lines: the production planner (for the planner's tool). */
export const FlowIcon = (p: IconProps) => <Icon {...p}><path d="M2 2.5h4v3.5H2zM10 2.5h4v3.5h-4zM6 10h4v3.5H6zM4 6v2h8V6M8 8v2" /></Icon>;
/** A truck: the vehicle calculator (for its tool). */
export const TruckIcon = (p: IconProps) => <Icon {...p}><path d="M1.5 4h8v7h-8zM9.5 6.5h3l2 2.5v2h-5" /><circle cx="4.5" cy="12" r="1.4" /><circle cx="11.5" cy="12" r="1.4" /></Icon>;
export const PinIcon = (p: IconProps) => <Icon {...p}><path d="M8 14s4.5-4.2 4.5-7.5a4.5 4.5 0 00-9 0C3.5 9.8 8 14 8 14z" /><circle cx="8" cy="6.5" r="1.5" /></Icon>;
export const CheckIcon = (p: IconProps) => <Icon {...p}><path d="M3 8.5l3 3 7-7" /></Icon>;
export const PlusIcon = (p: IconProps) => <Icon {...p}><path d="M8 3v10M3 8h10" /></Icon>;
export const SearchIcon = (p: IconProps) => <Icon {...p}><circle cx="6.75" cy="6.75" r="4.5" /><path d="M10.25 10.25L14 14" /></Icon>;

/** The ficsmap mark (the favicon's map pin with a nut), in the accent on a dark plate. */
export function BrandMark({ size = 28, className = '' }: IconProps) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} aria-hidden="true" focusable="false" className={`shrink-0 ${className}`}>
      <path d="M0 0h52l12 12v52H12L0 52z" fill="var(--color-raised)" />
      <circle cx="32" cy="25" r="17" fill="var(--color-accent)" />
      <polygon points="46.57,33.76 32,58 17.43,33.76" fill="var(--color-accent)" />
      <polygon points="40.6,25 36.3,32.45 27.7,32.45 23.4,25 27.7,17.55 36.3,17.55" fill="var(--color-raised)" />
      <circle cx="32" cy="25" r="3.6" fill="var(--color-accent)" />
    </svg>
  );
}
