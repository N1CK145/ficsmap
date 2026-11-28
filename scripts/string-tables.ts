import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The game's string tables as the extractor writes them (`--string-tables-out <dir>`: `en-US.json` and `de.json`,
 * from `FactoryGame/Content/Localization/AllStringTables/<culture>/AllStringTables.locres`), shaped
 * `{"<table id>": {"<key>": "<text>"}}`. Besides the Docs they are the only German source in the paks; see
 * data-src/extractor/README.md, "String tables".
 */
export type StringTables = Record<string, Record<string, string>>;

export interface LocalizedStringTables {
  en: StringTables;
  de: StringTables;
}

/** Reads `en-US.json` and `de.json` from the extractor's string table folder; throws when one is missing. */
export function readStringTables(dir: string): LocalizedStringTables {
  const read = (culture: string): StringTables => {
    const path = join(dir, `${culture}.json`);
    if (!existsSync(path)) throw new Error(`${path} not found (extractor --string-tables-out)`);
    return JSON.parse(readFileSync(path, 'utf8')) as StringTables;
  };
  return { en: read('en-US'), de: read('de') };
}

/** One entry's text, or undefined when the table or key does not exist. */
export function stringTableText(tables: StringTables, table: string, key: string): string | undefined {
  return Object.hasOwn(tables, table) && Object.hasOwn(tables[table]!, key) ? tables[table]![key] : undefined;
}
