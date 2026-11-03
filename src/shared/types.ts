export type CollectibleTypeId =
  | 'slug_blue' | 'slug_yellow' | 'slug_purple'
  | 'somersloop' | 'mercer_sphere' | 'hard_drive';
export type Locale = 'en' | 'de';
export interface LocalizedName { en: string; de: string }
export interface WorldBounds { minX: number; minY: number; maxX: number; maxY: number }
export interface Vec3 { x: number; y: number; z: number }
