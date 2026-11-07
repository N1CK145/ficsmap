import { normalize, prepare, rank, scoreEntry, type Searchable } from '../../src/web/features/search/match.js';

const entry = (label: string, terms: string[] = [], weight?: number): Searchable => ({ label, terms, ...(weight === undefined ? {} : { weight }) });
const labels = (entries: Searchable[], q: string) => rank(prepare(entries), q).map(r => r.entry.label);
const score = (terms: string[], q: string) => scoreEntry(terms.map(normalize), normalize(q));

describe('normalize', () => {
  it('ignores case, accents and extra whitespace, and writes ß as ss', () => {
    expect(normalize('  Dünen\tWÜSTE ')).toBe('dunen wuste');
    expect(normalize('Mercer-Sphäre')).toBe('mercer-sphare');
    expect(normalize('Straße')).toBe('strasse');
  });
});

describe('scoreEntry', () => {
  it.each([
    ['exact term', ['BP_WAT139'], 'bp_wat139', 0],
    ['prefix ending at a word end', ['Dune Desert'], 'dune', 2],
    ['prefix inside a word', ['BP_WAT139'], 'bp_wat13', 3],
    ['word start ending at a word end', ['Blue Power Slug · Dune Desert 3'], 'dune desert 3', 4],
    ['word start inside a word', ['Blue Power Slug · Dune Desert 31'], 'dune desert 3', 5],
    ['after an underscore counts as a word start', ['BP_WAT139'], 'wat139', 4],
    ['inside a word, ending at its end', ['Somersloop'], 'sloop', 6],
    ['inside a word', ['Somersloop'], 'ersl', 7],
    ['every word at a word start, in any order and term', ['Blue Power Slug', 'Dune Desert'], 'dune slug', 8],
  ])('%s', (_name, terms, q, expected) => {
    expect(score(terms, q)).toBe(expected);
  });

  it('is accent-insensitive both ways', () => {
    expect(score(['Dünenwüste'], 'dunenwuste')).toBe(0);
    expect(score(['Dune Desert'], 'Düne')).toBe(2);
  });

  it('does not match when a word is missing', () => {
    expect(score(['Blue Power Slug'], 'blue sloop')).toBeNull();
    expect(score(['Somersloop'], 'mercer')).toBeNull();
    // Words of a longer query must start words: a "3" inside an ID does not count.
    expect(score(['Somersloop · Dune Desert 12', 'BP_WAT13'], 'dune desert 3')).toBeNull();
  });
});

describe('rank', () => {
  const entries = [
    entry('Somersloop · Dune Desert 3', ['BP_WAT13'], 30),
    entry('Somersloop · Dune Desert 12', ['BP_WAT139'], 30),
    entry('Somersloop', ['Somersloops'], 0),
    entry('Dune Desert', ['Dünenwüste'], 10),
    entry('Blue Power Slug · Dune Desert 30', ['BP_Crystal_mk29'], 30),
  ];

  it('puts an exact ID first, then IDs it is the prefix of', () => {
    expect(labels(entries, 'BP_WAT139')).toEqual(['Somersloop · Dune Desert 12']);
    expect(labels(entries, 'bp_wat13')).toEqual(['Somersloop · Dune Desert 3', 'Somersloop · Dune Desert 12']);
  });

  it('puts prefix matches before word matches before inner matches', () => {
    expect(labels(entries, 'dune')).toEqual([
      'Dune Desert',
      'Blue Power Slug · Dune Desert 30', 'Somersloop · Dune Desert 3', 'Somersloop · Dune Desert 12',
    ]);
  });

  it('prefers a whole number to a longer one ("3" before "30")', () => {
    expect(labels(entries, 'dune desert 3')).toEqual(['Somersloop · Dune Desert 3', 'Blue Power Slug · Dune Desert 30']);
  });

  it('breaks ties by weight, then by label in natural order', () => {
    expect(labels(entries, 'somersloop')).toEqual(['Somersloop', 'Somersloop · Dune Desert 3', 'Somersloop · Dune Desert 12']);
  });

  it('finds a name in the other language without accents', () => {
    expect(labels(entries, 'dunenwuste')).toEqual(['Dune Desert']);
  });

  it('matches nothing for a query under two characters', () => {
    expect(labels(entries, 'd')).toEqual([]);
    expect(labels(entries, '  ')).toEqual([]);
  });
});
