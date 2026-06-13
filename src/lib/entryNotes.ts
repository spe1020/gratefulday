/**
 * A day's gratitude entry holds one or more notes inside the single kind 36669
 * event's plain-text content — notes are separated by a blank line, NEVER
 * encoded as JSON. Public entries render raw in the community feed and other
 * Nostr clients, where blank-line-separated paragraphs read naturally and a
 * JSON blob would look broken.
 *
 * Single newlines stay *within* a note (so a note can be multi-line); only a
 * blank line (one or more empty lines) delimits separate notes.
 */

/** The canonical delimiter written between notes. */
const NOTE_SEPARATOR = '\n\n';

/** Matches a run of one or more blank lines (tolerating trailing whitespace). */
const BLANK_LINE = /\n[ \t]*(?:\n[ \t]*)+/;

/**
 * Split entry content into individual notes: trimmed, non-empty, in order.
 * Empty or whitespace-only content yields `[]`.
 *
 * Newlines are normalized to `\n` first so content authored by another client
 * with CRLF (`\r\n`) or lone CR line endings still splits on blank lines.
 */
export function splitNotes(content: string): string[] {
  return content
    .replace(/\r\n?/g, '\n')
    .split(BLANK_LINE)
    .map((note) => note.trim())
    .filter((note) => note.length > 0);
}

/**
 * Join notes back into entry content with a single blank line between each.
 * Trims and drops empties, so `joinNotes(splitNotes(x))` normalizes content and
 * the round-trip is idempotent: `splitNotes(joinNotes(splitNotes(x)))` equals
 * `splitNotes(x)`.
 */
export function joinNotes(notes: string[]): string {
  return notes
    .map((note) => note.trim())
    .filter((note) => note.length > 0)
    .join(NOTE_SEPARATOR);
}

/** Normalize raw editor content to canonical, blank-line-delimited notes. */
export function normalizeNotes(content: string): string {
  return joinNotes(splitNotes(content));
}
