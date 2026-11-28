import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { readStringTables, stringTableText, type LocalizedStringTables } from './string-tables.js';

/**
 * The creature names of the UI (`creatures.names` in `src/web/app/i18n/en.json` and `de.json`) from the game's
 * string tables, so that they can be regenerated after a game update:
 *
 *   npx tsx scripts/creature-names.ts --string-tables data-src/extractor/<version>/string-tables [--check]
 *
 * The creature blueprints carry no display name (their class defaults have no `mDisplayName`, checked on 1.2.5.1),
 * so the key of each class is kept here by hand; the texts come only from the table `World_Data`. Classes with
 * `null` have no entry there (the red forest spitters, the beetle, the large crab hatcher); their names in the i18n
 * files are hand-written and left as they are.
 */
export const CREATURE_NAME_KEYS: Record<string, string | null> = {
  Char_Hog_C: 'Creatures/Hog/Fluffytailed',
  Char_AlphaHog_C: 'Creatures/Hog/Alpha',
  Char_CliffHog_C: 'Creatures/Hog/Cliff',
  Char_NuclearHog_C: 'Creatures/Hog/Cliff/Radioactive',
  Char_SpitterForestSmall_C: 'Creatures/Spitter/Forest/Small',
  Char_SpitterForestAlpha_C: 'Creatures/Spitter/Forest/Alpha',
  Char_SpitterForestRedSmall_C: null,
  Char_SpitterForestRedAlpha_C: null,
  Char_SpitterDesertSmall_C: 'Creatures/Spitter/Desert/Small',
  Char_SpitterDesertAlpha_C: 'Creatures/Spitter/Desert/Alpha',
  Char_SpitterAquaticSmall_C: 'Creatures/Spitter/Aquatic/Small',
  Char_SpitterAquaticAlpha_C: 'Creatures/Spitter/Aquatic/Alpha',
  Char_Stinger_Child_C: 'Creatures/Stinger/Small',
  Char_Stinger_C: 'Creatures/Stinger/Alpha',
  Char_EliteStinger_C: 'Creatures/Stinger/Gas',
  Char_SpaceRabbit_C: 'Creatures/LizardDoggo',
  Char_SpaceGiraffe_C: 'Creatures/SpaceGiraffe',
  Char_NonFlyingBird_C: 'Creatures/NonflyingBirb',
  Char_Beetle_C: null,
  Char_CrabHatcher_C: 'Creatures/CrabHatcher/Tropical',
  Char_BigCrabHatcher_C: null,
};

const TABLE = 'World_Data';

/** class -> name per language for every class with a key; throws listing every key a table lacks. */
export function creatureNames(tables: LocalizedStringTables): { en: Record<string, string>; de: Record<string, string> } {
  const out = { en: {} as Record<string, string>, de: {} as Record<string, string> };
  const missing: string[] = [];
  for (const [cls, key] of Object.entries(CREATURE_NAME_KEYS)) {
    if (key === null) continue;
    for (const lang of ['en', 'de'] as const) {
      const text = stringTableText(tables[lang], TABLE, key);
      if (text === undefined) missing.push(`${lang}: ${TABLE}::${key} (${cls})`);
      else out[lang][cls] = text;
    }
  }
  if (missing.length) throw new Error(`Creature names missing in the string tables:\n- ${missing.join('\n- ')}`);
  return out;
}

interface I18nFile { creatures: { names: Record<string, string> } }

/** A copy of an i18n file with `names` written into `creatures.names`, and a line per changed name. */
export function applyCreatureNames<T extends I18nFile>(file: T, names: Record<string, string>): { json: T; changed: string[] } {
  const json = structuredClone(file);
  const changed: string[] = [];
  for (const [cls, name] of Object.entries(names)) {
    const old = json.creatures.names[cls];
    if (old === name) continue;
    changed.push(`${cls}: ${old === undefined ? '(none)' : JSON.stringify(old)} -> ${JSON.stringify(name)}`);
    json.creatures.names[cls] = name;
  }
  return { json, changed };
}

function main(): void {
  const { values: v } = parseArgs({ options: { 'string-tables': { type: 'string' }, check: { type: 'boolean', default: false } } });
  if (!v['string-tables']) throw new Error('usage: npx tsx scripts/creature-names.ts --string-tables <extractor>/string-tables [--check]');
  const names = creatureNames(readStringTables(resolve(v['string-tables'])));
  let stale = false;
  for (const [lang, file] of [['en', 'src/web/app/i18n/en.json'], ['de', 'src/web/app/i18n/de.json']] as const) {
    const { json, changed } = applyCreatureNames(JSON.parse(readFileSync(file, 'utf8')) as I18nFile, names[lang]);
    for (const line of changed) console.log(`${file}: ${line}`);
    if (changed.length === 0) continue;
    stale = true;
    if (!v.check) writeFileSync(file, JSON.stringify(json, null, 2) + '\n');
  }
  if (!stale) console.log('Creature names match the string tables.');
  else if (v.check) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
