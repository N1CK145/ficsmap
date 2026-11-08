/**
 * Matching and ranking for the header search, independent of where the entries come from.
 *
 * Text is compared normalised: lower case, accents removed ("Dünenwüste" = "dunenwuste"), ß as ss,
 * whitespace collapsed. A query matches an entry when one of its terms (label, IDs, other names)
 * contains the whole query, or, for a query of several words, when every word starts a word in some term.
 * Lower scores rank first:
 *
 *   0  the query is a whole term (an exact ID, an exact name)
 *   2  a term starts with the query, which ends at a word end ("dune" in "Dune Desert")
 *   3  a term starts with the query ("bp_wat13" in "BP_WAT139")
 *   4  the query starts at a word in a term and ends at a word end ("dune desert 3" in "Slug · Dune Desert 3")
 *   5  the query starts at a word in a term ("dune desert 3" in "Slug · Dune Desert 31")
 *   6  the query lies inside a word, ending at a word end
 *   7  the query lies inside a word
 *   8  every word of the query starts a word somewhere in the terms ("slug dune")
 *
 * Words inside other words do not count for queries of several words: "dune 3" would otherwise
 * find every item whose ID contains a 3.
 *
 * Equal scores go by the entry's weight (kind of result), then by label in natural order ("2" before "10").
 */

/** Queries shorter than this (normalised) match nothing: one letter would match almost everything. */
export const MIN_QUERY_LENGTH = 2;

export function normalize(s: string): string {
  return s.normalize('NFKD').replace(/\p{M}/gu, '').replace(/ß/g, 'ss').toLowerCase().replace(/\s+/g, ' ').trim();
}

const WORD_CHAR = /[\p{L}\p{N}]/u;
const isWordChar = (c: string | undefined): boolean => c !== undefined && WORD_CHAR.test(c);

/** The best score of `q` inside one term, or null when the term does not contain it. */
function termScore(term: string, q: string): number | null {
  if (term === q) return 0;
  let best: number | null = null;
  for (let i = term.indexOf(q); i !== -1; i = term.indexOf(q, i + 1)) {
    const start = i === 0 ? 1 : isWordChar(term[i - 1]) ? 3 : 2;
    const end = isWordChar(term[i + q.length]) ? 1 : 0;
    const s = start * 2 + end;
    if (best === null || s < best) best = s;
    if (best === 2) break;
  }
  return best;
}

/** Whether `token` starts a word in `term`. */
function startsWord(term: string, token: string): boolean {
  for (let i = term.indexOf(token); i !== -1; i = term.indexOf(token, i + 1)) {
    if (i === 0 || !isWordChar(term[i - 1])) return true;
  }
  return false;
}

export interface Searchable { label: string; terms: readonly string[]; weight?: number }

/** An entry with its terms normalised once, so typing does not normalise ~2000 entries per key. */
export interface Prepared<E> { entry: E; terms: readonly string[] }

export function prepare<E extends Searchable>(entries: readonly E[]): Prepared<E>[] {
  return entries.map(entry => ({ entry, terms: [...new Set([entry.label, ...entry.terms].map(normalize).filter(t => t !== ''))] }));
}

/** The score of one prepared entry for a normalised query (see the table above), or null for no match. */
export function scoreEntry(terms: readonly string[], q: string): number | null {
  let best: number | null = null;
  for (const term of terms) {
    const s = termScore(term, q);
    if (s !== null && (best === null || s < best)) best = s;
    if (best === 0) return 0;
  }
  if (best !== null) return best;
  const tokens = q.split(' ');
  if (tokens.length < 2) return null;
  return tokens.every(tok => terms.some(term => startsWord(term, tok))) ? 8 : null;
}

export interface Ranked<E> { entry: E; score: number }

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/** Every matching entry, best first. Empty for a query shorter than MIN_QUERY_LENGTH. */
export function rank<E extends Searchable>(prepared: readonly Prepared<E>[], query: string): Ranked<E>[] {
  const q = normalize(query);
  if (q.length < MIN_QUERY_LENGTH) return [];
  const out: Ranked<E>[] = [];
  for (const p of prepared) {
    const score = scoreEntry(p.terms, q);
    if (score !== null) out.push({ entry: p.entry, score });
  }
  return out.sort((a, b) => a.score - b.score
    || (a.entry.weight ?? 0) - (b.entry.weight ?? 0)
    || collator.compare(a.entry.label, b.entry.label));
}
