/**
 * The mobile layout below 900 px (spec §10.11): the world layout renders the sidebar panels in
 * `BottomSheet` and the item panel as `ItemSheet`. The route editor and the import
 * hint adapt themselves with `useIsMobile` (app/useMediaQuery).
 */
export { BottomSheet, type BottomSheetProps } from './BottomSheet.js';
export { ItemSheet } from './ItemSheet.js';
export { nearestSnap, nextSnap, PEEK_PX, snapHeights, SNAPS, type Snap } from './snap.js';
