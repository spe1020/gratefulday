/**
 * Local, client-side moderation for the tagged gratitude feed: the viewer can
 * hide an individual note or mute an author so their notes stop appearing.
 *
 * This is a personal preference for this browser (not published to relays and
 * not keyed by account) — the simplest thing that gives the user control over
 * an open, arbitrary public feed. Stored as namespaced localStorage arrays;
 * reads tolerate corruption by degrading to empty.
 */

const HIDDEN_NOTES_KEY = 'gratefulday:hidden-notes:v1';
const MUTED_PUBKEYS_KEY = 'gratefulday:muted-pubkeys:v1';

function readList(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function addToList(key: string, value: string): void {
  try {
    const next = new Set(readList(key));
    next.add(value);
    localStorage.setItem(key, JSON.stringify([...next]));
  } catch {
    // localStorage unavailable (private mode, quota) — the choice just won't
    // persist across sessions; the in-memory filter still applies this session.
  }
}

function removeFromList(key: string, value: string): void {
  try {
    const next = new Set(readList(key));
    next.delete(value);
    localStorage.setItem(key, JSON.stringify([...next]));
  } catch {
    // See addToList.
  }
}

export function getHiddenNoteIds(): Set<string> {
  return new Set(readList(HIDDEN_NOTES_KEY));
}

export function hideNote(id: string): void {
  addToList(HIDDEN_NOTES_KEY, id);
}

export function getMutedPubkeys(): Set<string> {
  return new Set(readList(MUTED_PUBKEYS_KEY));
}

export function mutePubkey(pubkey: string): void {
  addToList(MUTED_PUBKEYS_KEY, pubkey);
}

export function unmutePubkey(pubkey: string): void {
  removeFromList(MUTED_PUBKEYS_KEY, pubkey);
}
