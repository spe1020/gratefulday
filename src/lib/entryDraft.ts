/**
 * Local backup for an in-progress gratitude entry, so a login round-trip
 * (Amber can reload the page), a tab discard, or an accidental navigation
 * doesn't lose what the user typed before it was ever posted.
 *
 * Privacy posture: the draft is plaintext, but it never leaves this device —
 * localStorage only, a single current-day draft, expired after 24 hours, and
 * cleared the moment the entry posts or the user discards it.
 */

const DRAFT_KEY = 'gratefulday:entry-draft:v1';
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

interface StoredDraft {
  /** The day the draft belongs to (the entry's `d` tag, YYYY-MM-DD). */
  date: string;
  /** Draft note texts, in editor order. */
  notes: string[];
  /** Unix ms when last written; the 24h expiry counts from here. */
  savedAt: number;
}

function parseDraft(raw: string | null): StoredDraft | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const draft = parsed as Partial<StoredDraft>;
    if (
      typeof draft.date !== 'string' ||
      typeof draft.savedAt !== 'number' ||
      !Array.isArray(draft.notes)
    ) {
      return null;
    }
    return {
      date: draft.date,
      savedAt: draft.savedAt,
      notes: draft.notes.filter((n): n is string => typeof n === 'string'),
    };
  } catch {
    return null;
  }
}

export function clearEntryDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // localStorage unavailable — there was never a draft to clear.
  }
}

/**
 * Read the backed-up draft notes for a given day. A draft for a different
 * day, an expired draft, or a corrupt record reads as empty AND is purged,
 * so stale text can never resurface later.
 */
export function readEntryDraft(dateString: string, now = Date.now()): string[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(DRAFT_KEY);
  } catch {
    return [];
  }
  if (raw === null) return [];

  const draft = parseDraft(raw);
  if (!draft || draft.date !== dateString || now - draft.savedAt > DRAFT_TTL_MS) {
    clearEntryDraft();
    return [];
  }
  const notes = draft.notes.filter((n) => n.trim().length > 0);
  if (notes.length === 0) clearEntryDraft();
  return notes;
}

/**
 * Persist the current draft notes for a day. Empty input clears the backup
 * (nothing worth keeping = nothing lingering on the device).
 */
export function writeEntryDraft(
  dateString: string,
  notes: string[],
  now = Date.now()
): void {
  const kept = notes.filter((n) => n.trim().length > 0);
  if (kept.length === 0) {
    clearEntryDraft();
    return;
  }
  const draft: StoredDraft = { date: dateString, notes: kept, savedAt: now };
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // localStorage unavailable — the in-memory editor is the only copy.
  }
}
