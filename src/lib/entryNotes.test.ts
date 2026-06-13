import { describe, it, expect } from 'vitest';
import { splitNotes, joinNotes, normalizeNotes } from './entryNotes';

describe('splitNotes', () => {
  it('returns a single note when there is no blank line', () => {
    expect(splitNotes('grateful for coffee')).toEqual(['grateful for coffee']);
  });

  it('splits notes separated by a blank line', () => {
    expect(splitNotes('first note\n\nsecond note')).toEqual([
      'first note',
      'second note',
    ]);
  });

  it('keeps single newlines inside a note', () => {
    expect(splitNotes('line one\nline two\n\nsecond note')).toEqual([
      'line one\nline two',
      'second note',
    ]);
  });

  it('collapses runs of multiple blank lines into one delimiter', () => {
    expect(splitNotes('a\n\n\n\nb')).toEqual(['a', 'b']);
  });

  it('trims notes and drops empty ones', () => {
    expect(splitNotes('  a  \n\n   \n\n  b ')).toEqual(['a', 'b']);
  });

  it('tolerates blank lines that contain whitespace', () => {
    expect(splitNotes('a\n \t \nb')).toEqual(['a', 'b']);
  });

  it('returns [] for empty or whitespace-only content', () => {
    expect(splitNotes('')).toEqual([]);
    expect(splitNotes('   \n\n   ')).toEqual([]);
  });
});

describe('joinNotes', () => {
  it('joins notes with a single blank line', () => {
    expect(joinNotes(['a', 'b', 'c'])).toBe('a\n\nb\n\nc');
  });

  it('trims notes and drops empties', () => {
    expect(joinNotes(['  a ', '', '   ', 'b'])).toBe('a\n\nb');
  });

  it('returns one note unchanged', () => {
    expect(joinNotes(['only'])).toBe('only');
  });

  it('returns empty string for no notes', () => {
    expect(joinNotes([])).toBe('');
  });
});

describe('round-trip stability', () => {
  const cases = [
    'single',
    'first\n\nsecond',
    'a\nstill a\n\nb',
    '  messy  \n\n\n\n  spacing  ',
    '',
    '   \n\n  ',
  ];

  it('split -> join -> split is idempotent', () => {
    for (const input of cases) {
      const once = splitNotes(input);
      const twice = splitNotes(joinNotes(once));
      expect(twice).toEqual(once);
    }
  });

  it('drops empty boxes so they never create phantom notes', () => {
    // An "Add another moment" box left blank must not persist on save.
    expect(joinNotes(['a moment', ''])).toBe('a moment');
    expect(joinNotes(['first', '', 'second'])).toBe('first\n\nsecond');
    expect(joinNotes(['', '   ', ''])).toBe('');
    // Trailing blank lines within a single note's content normalize away too.
    expect(normalizeNotes('first\n\nsecond\n\n')).toBe('first\n\nsecond');
  });

  it('normalizeNotes is idempotent', () => {
    for (const input of cases) {
      const once = normalizeNotes(input);
      const twice = normalizeNotes(once);
      expect(twice).toBe(once);
    }
  });
});
