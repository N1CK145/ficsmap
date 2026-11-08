import { SatisfactorySaveHeader, SaveReader } from '@etothepii/satisfactory-file-parser';
import { saveTimeFromTicks } from '../../shared/extract.js';

export interface SaveHeaderInfo {
  sessionName: string;
  /** Unix ms, truncated like a stored snapshot's `save_time`. */
  saveTime: number;
  build: number;
}

/**
 * The save header if these bytes start with a readable one, else null. Cheap (the header is a few hundred bytes and
 * not compressed), so the upload route reads it on the event loop to check the session and duplicates before a parse.
 * Same rules as the browser's `readSaveHeader` and `extractFactory`'s save time.
 */
export function readSaveHeader(buffer: ArrayBuffer): SaveHeaderInfo | null {
  try {
    const h = SatisfactorySaveHeader.Parse(new SaveReader(buffer));
    if (typeof h.sessionName !== 'string' || !Number.isFinite(h.buildVersion)) return null;
    const raw = Number(h.saveDateTime);
    // Parser 4.1.2 already converts the header's ticks to unix ms; accept raw ticks too.
    const saveTime = Math.trunc(raw > 1e15 ? saveTimeFromTicks(String(h.saveDateTime)) : raw);
    if (!Number.isFinite(saveTime) || saveTime < 0) return null;
    return { sessionName: h.sessionName.slice(0, 255), saveTime, build: h.buildVersion };
  } catch {
    return null;
  }
}
