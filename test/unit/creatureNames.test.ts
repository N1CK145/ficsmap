import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import en from '../../src/web/app/i18n/en.json';
import de from '../../src/web/app/i18n/de.json';
import { applyCreatureNames, CREATURE_NAME_KEYS, creatureNames } from '../../scripts/creature-names.js';
import { readStringTables, stringTableText, type StringTables } from '../../scripts/string-tables.js';

const tables = (entries: Record<string, string>): StringTables => ({ World_Data: { ...entries } });

describe('string tables', () => {
  it('reads en-US.json and de.json of the extractor (--string-tables-out) and looks entries up', () => {
    const dir = mkdtempSync(join(tmpdir(), 'string-tables-'));
    writeFileSync(join(dir, 'en-US.json'), JSON.stringify({ World_Data: { 'Creatures/Hog/Alpha': 'Alpha Hog' } }));
    writeFileSync(join(dir, 'de.json'), JSON.stringify({ World_Data: { 'Creatures/Hog/Alpha': 'Alpha-Keiler' } }));
    const t = readStringTables(dir);
    expect(stringTableText(t.en, 'World_Data', 'Creatures/Hog/Alpha')).toBe('Alpha Hog');
    expect(stringTableText(t.de, 'World_Data', 'Creatures/Hog/Alpha')).toBe('Alpha-Keiler');
    expect(stringTableText(t.de, 'World_Data', 'Creatures/Nope')).toBeUndefined();
    expect(stringTableText(t.de, 'Nope', 'Creatures/Hog/Alpha')).toBeUndefined();
  });

  it('fails when a culture is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'string-tables-'));
    writeFileSync(join(dir, 'en-US.json'), '{}');
    expect(() => readStringTables(dir)).toThrow(/de\.json/);
  });
});

describe('creature names from the game string tables', () => {
  const allKeys = Object.fromEntries(Object.values(CREATURE_NAME_KEYS).filter((k): k is string => k !== null).map(k => [k, `en:${k}`]));
  const allKeysDe = Object.fromEntries(Object.keys(allKeys).map(k => [k, `de:${k}`]));

  it('maps every keyed class to its World_Data entry and leaves classes without a key out', () => {
    const names = creatureNames({ en: tables(allKeys), de: tables(allKeysDe) });
    expect(names.en.Char_AlphaHog_C).toBe('en:Creatures/Hog/Alpha');
    expect(names.de.Char_NuclearHog_C).toBe('de:Creatures/Hog/Cliff/Radioactive');
    expect(names.en).not.toHaveProperty('Char_Beetle_C');
    expect(Object.keys(names.de)).toEqual(Object.keys(names.en));
  });

  it('fails listing every key the tables do not have', () => {
    const { 'Creatures/Hog/Alpha': _, ...withoutAlpha } = allKeysDe;
    expect(() => creatureNames({ en: tables(allKeys), de: tables(withoutAlpha) })).toThrow(/de: World_Data::Creatures\/Hog\/Alpha \(Char_AlphaHog_C\)/);
  });

  it('writes the names into creatures.names and reports what changed, keeping hand-written ones', () => {
    const file = { other: 1, creatures: { title: 'x', names: { Char_AlphaHog_C: 'old', Char_Beetle_C: 'Beetle' } } };
    const { json, changed } = applyCreatureNames(file, { Char_AlphaHog_C: 'Alpha Hog', Char_Hog_C: 'Fluffy-Tailed Hog' });
    expect(json.creatures.names).toEqual({ Char_AlphaHog_C: 'Alpha Hog', Char_Beetle_C: 'Beetle', Char_Hog_C: 'Fluffy-Tailed Hog' });
    expect(json.other).toBe(1);
    expect(changed).toEqual(['Char_AlphaHog_C: "old" -> "Alpha Hog"', 'Char_Hog_C: (none) -> "Fluffy-Tailed Hog"']);
    expect(file.creatures.names.Char_AlphaHog_C).toBe('old');
  });

  it('covers exactly the creature classes the UI names', () => {
    const classes = Object.keys(CREATURE_NAME_KEYS).sort();
    expect(Object.keys(en.creatures.names).sort()).toEqual(classes);
    expect(Object.keys(de.creatures.names).sort()).toEqual(classes);
  });
});
