import { describe, expect, it } from 'vitest';
import { dateLocale, dateTimeFormat } from '../../src/web/app/dates.js';
import { cleanPrefs } from '../../src/shared/prefs.js';

const at = new Date(2026, 10, 9, 23, 5).getTime();
const numeric = { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' } as const;

describe('date format preference', () => {
  it('European in an English page: dots and 24 hours for numbers, British English with month names', () => {
    expect(dateTimeFormat('en', 'eu', numeric).format(at)).toBe('09.11.2026, 23:05');
    expect(dateTimeFormat('en', 'eu', { day: '2-digit', month: '2-digit' }).format(at)).toBe('09.11.');
    expect(dateTimeFormat('en', 'eu', { dateStyle: 'medium', timeStyle: 'short' }).format(at)).toBe('9 Nov 2026, 23:05');
    expect(dateLocale('de', 'eu', { dateStyle: 'medium' })).toBe('de-DE');
  });

  it('American and "like the language"', () => {
    expect(dateTimeFormat('de', 'us', numeric).format(at)).toBe('11/09/2026, 11:05 PM');
    expect(dateTimeFormat('en', 'auto', numeric).format(at)).toBe('11/09/2026, 11:05 PM');
    expect(dateTimeFormat('de', 'auto', numeric).format(at)).toBe('09.11.2026, 23:05');
  });

  it('keeps only known formats in stored preferences', () => {
    expect(cleanPrefs({ dateFormat: 'eu', wheelSpeed: 2 })).toEqual({ dateFormat: 'eu', wheelSpeed: 2 });
    expect(cleanPrefs({ dateFormat: 'iso' })).toEqual({});
  });
});
