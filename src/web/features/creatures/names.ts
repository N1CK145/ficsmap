import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { prettyClass } from '../factory/data.js';

/** The game's picture of a creature (exported by the extractor's map icons into the dataset's `icons/`). */
export function creatureIcon(version: string, cls: string): string {
  return `/data/${encodeURIComponent(version)}/icons/${encodeURIComponent(cls)}.png`;
}

/** A creature class's name (`creatures.names.<class>`), else the class made readable. */
export function useCreatureName(): (cls: string) => string {
  const { t, i18n } = useTranslation();
  return useCallback((cls: string) => {
    const key = `creatures.names.${cls}`;
    return i18n.exists(key) ? t(key) : prettyClass(cls.replace(/^Char_/, ''));
  }, [t, i18n]);
}
