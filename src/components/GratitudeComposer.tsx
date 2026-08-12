import { AutocompleteTextarea, type AutocompleteTextareaHandle } from './AutocompleteTextarea';
import { useState, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Check, Globe, Loader2, Lock, Pencil, Plus, Save, Share2, Trash2, X } from 'lucide-react';
import type { DayInfo } from '@/lib/gratitudeUtils';
import { getQuoteForDay, getAffirmationForDay, formatDisplayDate } from '@/lib/gratitudeUtils';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish } from '@/hooks/useNostrPublish';
import { useGratitudeEntry } from '@/hooks/useGratitudeEntries';
import { useDeleteGratitudeEntry } from '@/hooks/useDeleteGratitudeEntry';
import { useNip44Support, cacheNip44Support } from '@/hooks/useNip44Support';
import { useAppSettings } from '@/hooks/useAppSettings';
import { useDecryptedEntry } from '@/hooks/useDecryptedEntry';
import {
  ENCRYPTED_ALT,
  ENCRYPTED_TAG,
  Nip44UnsupportedError,
  encryptEntryContent,
  isEncryptedEntry,
} from '@/lib/privacyUtils';
import type { NostrEvent, NostrSigner } from '@nostrify/nostrify';
import { dedupeEntriesByDTag } from '@/lib/streakUtils';
import { joinNotes, splitNotes } from '@/lib/entryNotes';
import { readEntryDraft, writeEntryDraft, clearEntryDraft } from '@/lib/entryDraft';
import { useToast } from '@/hooks/useToast';
import LoginDialog from './auth/LoginDialog';
import { nip19 } from 'nostr-tools';

interface GratitudeComposerProps {
  /** Today. The composer only ever edits the current day's entry. */
  day: DayInfo;
}

/**
 * One note in the editor. `published` means "matches the version currently
 * stored on relays"; `draft` means "unsaved edits." The whole day is one
 * replaceable event, so Save republishes every note as a single entry —
 * status is a display concern, never per-note publishing. The stable `id`
 * keys the list so add/remove/edit don't shuffle DOM (and editor focus) by
 * index.
 */
type NoteStatus = 'published' | 'draft';
interface NoteState {
  id: number;
  text: string;
  status: NoteStatus;
}

/** A saved note rendered read-only as a committed card; `onEdit` flips it to a draft. */
function PublishedNoteCard({
  text,
  onEdit,
}: {
  text: string;
  onEdit?: () => void;
}) {
  return (
    <div className="relative rounded-lg border border-border/60 bg-muted/40 p-3">
      <p className="text-base text-foreground whitespace-pre-wrap break-words pr-8">
        {text}
      </p>
      {onEdit && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onEdit}
          aria-label="Edit this moment"
          className="absolute top-1.5 right-1.5 h-7 w-7 text-muted-foreground hover:text-foreground"
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

/** Pubkeys that have already seen the "signer can't encrypt" hint. */
const NIP44_HINT_KEY = 'gratefulday:nip44-hint-shown:v1';

function readJsonRecord(key: string): Record<string, boolean> {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeJsonRecord(key: string, record: Record<string, boolean>): void {
  try {
    localStorage.setItem(key, JSON.stringify(record));
  } catch {
    // Persistence unavailable — defaults just won't stick across sessions.
  }
}

function takeNip44HintSlot(pubkey: string): boolean {
  const record = readJsonRecord(NIP44_HINT_KEY);
  if (record[pubkey]) return false;
  record[pubkey] = true;
  writeJsonRecord(NIP44_HINT_KEY, record);
  return true;
}

const ENCRYPT_TIMEOUT_MS = 20_000;

class EncryptTimeoutError extends Error {
  constructor() {
    super('Encryption timed out');
    this.name = 'EncryptTimeoutError';
  }
}

/**
 * Encrypt with a hard timeout. Bunker signers round-trip over relays and can
 * hang far longer than a user will wait; a timeout is NOT treated as a
 * capability signal — the save simply fails closed.
 */
async function encryptWithTimeout(
  signer: NostrSigner,
  pubkey: string,
  plaintext: string
): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      encryptEntryContent(signer, pubkey, plaintext),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new EncryptTimeoutError()), ENCRYPT_TIMEOUT_MS);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Extracts all mentioned pubkeys from text containing nostr:npub... mentions
 * Returns an array of unique pubkeys
 */
function extractMentionedPubkeys(text: string): string[] {
  const mentionRegex = /nostr:(npub1[a-z0-9]{58,})/g;
  const pubkeys = new Set<string>();
  let match: RegExpExecArray | null;

  while ((match = mentionRegex.exec(text)) !== null) {
    try {
      const npub = match[1];
      const decoded = nip19.decode(npub);
      if (decoded.type === 'npub') {
        pubkeys.add(decoded.data as string);
      }
    } catch {
      // Invalid npub, skip
    }
  }

  return Array.from(pubkeys);
}

/**
 * Inline compose card for today's entry — the top of the calendar view, so
 * arriving at the app lands directly on a writable editor with no dialog
 * step. Past days stay in the (now read-only) DayDetailDialog.
 */
export function GratitudeComposer({ day }: GratitudeComposerProps) {
  // Each note is its own item (published card or draft box); the day still
  // saves as one 36669. Stable ids key the list and target focus.
  const [notes, setNotes] = useState<NoteState[]>([
    { id: 0, text: '', status: 'draft' },
  ]);
  const nextIdRef = useRef(1);
  const makeNote = (text: string, status: NoteStatus): NoteState => ({
    id: nextIdRef.current++,
    text,
    status,
  });
  // Draft editor handles by note id (a Map, not an array, so removing a note
  // never reassigns another note's ref).
  const editorRefs = useRef<Map<number, AutocompleteTextareaHandle | null>>(
    new Map()
  );
  // Id of a note to focus once its draft box mounts — set by Add and Edit so
  // seeding N cards never steals focus.
  const pendingFocusIdRef = useRef<number | null>(null);
  const [showLoginDialog, setShowLoginDialog] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [isEncrypting, setIsEncrypting] = useState(false);
  const [showNip44Hint, setShowNip44Hint] = useState(false);
  const [showShareGuard, setShowShareGuard] = useState(false);
  const [showShareAgainGuard, setShowShareAgainGuard] = useState(false);
  const [showDiscardGuard, setShowDiscardGuard] = useState(false);
  const { user } = useCurrentUser();
  const { supported: nip44Supported } = useNip44Support();
  const { settings: appSettings, updateSettings: updateAppSettings } = useAppSettings();
  // Snapshot of the synced privacy default, read non-reactively when the
  // privacy toggle seeds (mirrors DayDetailDialog's previous behavior) so a
  // relay reconcile arriving mid-edit can't flip the user's in-progress toggle.
  const privacyDefaultRef = useRef(appSettings.privacyDefault);
  privacyDefaultRef.current = appSettings.privacyDefault;
  const { mutate: createEvent, isPending } = useNostrPublish();
  const { mutate: publishNote, isPending: isPublishingNote } = useNostrPublish();
  const { mutate: deleteEntry, isPending: isDeleting } = useDeleteGratitudeEntry();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setSearchParams] = useSearchParams();

  // Fetch the existing entry for today (the composer edits it in place).
  const { data: existingEntry } = useGratitudeEntry(
    user?.pubkey,
    day.dateString
  );
  const {
    content: entryContent,
    isDecrypting,
    decryptError,
  } = useDecryptedEntry(existingEntry);

  // Seed the editor from the existing entry exactly once per entry id (and per
  // day — the key rolls over at midnight). We never re-seed after the user has
  // started typing (the latch blocks re-fires when, e.g., a background refetch
  // toggles isDecrypting), and we never seed plaintext over an entry we
  // couldn't decrypt: a decrypt failure leaves the editor empty AND saving
  // disabled, so a blank box can never silently overwrite content the user
  // can't currently read.
  //
  // Locally backed-up draft notes are merged in after the published cards, so
  // text typed before a login round-trip (or a page reload) comes back instead
  // of being wiped by the re-seed that follows the entry arriving.
  const seededKeyRef = useRef<string | null>(null);
  // Bumped (as state, not a ref) each time seeding commits, so the persist
  // effect below can tell seeded note state apart from the initial mount
  // state within the same commit — a ref would already read as "seeded"
  // while `notes` still holds the pre-seed placeholder.
  const [seedEpoch, setSeedEpoch] = useState(0);
  useEffect(() => {
    const key = `${day.dateString}:${existingEntry?.id ?? 'none'}`;
    if (seededKeyRef.current === key) return;

    const seedWith = (publishedTexts: string[]) => {
      const published = publishedTexts.map((text) => makeNote(text, 'published'));
      const drafts = readEntryDraft(day.dateString)
        // A draft identical to a published note is the note, already saved.
        .filter((text) => !publishedTexts.includes(text))
        .map((text) => makeNote(text, 'draft'));
      const seeded = [...published, ...drafts];
      setNotes(seeded.length > 0 ? seeded : [makeNote('', 'draft')]);
      seededKeyRef.current = key;
      setSeedEpoch((epoch) => epoch + 1);
    };

    if (!existingEntry) {
      seedWith([]);
      return;
    }

    // Wait for decryption to settle before seeding — don't latch yet.
    if (isDecrypting) return;

    if (decryptError) {
      // Fail-closed: couldn't read it, so don't seed plaintext. Latch to stop
      // re-firing; the locked UI + disabled save guard the rest.
      seedWith([]);
      return;
    }

    seedWith(splitNotes(entryContent));
    // Keyed on existingEntry?.id, not the object: a background refetch that
    // returns an identity-changed-but-same entry must not re-fire seeding.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day.dateString, existingEntry?.id, isDecrypting, decryptError, entryContent]);

  // Back up unposted draft text locally on every edit (plaintext, this device
  // only, 24h expiry — see entryDraft.ts). This is what makes a "save → oh,
  // you're not logged in → login" round-trip lossless even if the page
  // reloads along the way.
  useEffect(() => {
    if (seedEpoch === 0) return; // never persist (or clear) pre-seed state
    writeEntryDraft(
      day.dateString,
      notes.filter((note) => note.status === 'draft').map((note) => note.text)
    );
  }, [notes, seedEpoch, day.dateString]);

  // Focus the box for the pending note id once it has mounted as a draft.
  // Runs after every commit (cheap ref check); Add and Edit set the target id,
  // so seeding N cards never steals focus.
  useEffect(() => {
    const id = pendingFocusIdRef.current;
    if (id === null) return;
    const handle = editorRefs.current.get(id);
    if (handle) {
      pendingFocusIdRef.current = null;
      handle.focus();
    }
  });

  // Toggle is shown when the signer supports NIP-44 — or optimistically for
  // bunkers ('unknown'), where support is only discoverable by attempting.
  const canEncrypt = nip44Supported === true || nip44Supported === 'unknown';

  // Seed the privacy toggle: an existing entry dictates its own state;
  // otherwise the last-used choice, defaulting Private only when support is
  // confirmed (bunker-'unknown' defaults Public until proven). When the
  // signer can't encrypt at all, force Public even for an entry that is
  // currently encrypted — the toggle is hidden in that state, and seeding
  // Private would trap the user in fail-closed saves with no way out.
  useEffect(() => {
    if (!user || !canEncrypt) {
      setIsPrivate(false);
    } else if (existingEntry) {
      setIsPrivate(isEncryptedEntry(existingEntry));
    } else {
      setIsPrivate(privacyDefaultRef.current ?? (nip44Supported === true));
    }
  }, [day, existingEntry, user, canEncrypt, nip44Supported]);

  // One-time hint when the signer can't encrypt at all.
  useEffect(() => {
    if (user && nip44Supported === false) {
      setShowNip44Hint(takeNip44HintSlot(user.pubkey));
    } else {
      setShowNip44Hint(false);
    }
  }, [user, nip44Supported]);

  // Editing an existing entry: the editor mustn't accept a save until the entry
  // has been decrypted and seeded. While decrypting we show a loading state;
  // when decryption failed we lock the editor entirely (no blank-overwrite path).
  const hasExistingEntry = !!existingEntry;
  const entrySeeding = hasExistingEntry && isDecrypting;
  const entryLocked = hasExistingEntry && !!decryptError;
  const blockSaveShare = entrySeeding || entryLocked;

  // A day can hold multiple notes inside the one entry. The saved content is
  // the non-empty notes joined; empty draft boxes are dropped by joinNotes.
  const joinedNotes = joinNotes(notes.map((note) => note.text));
  const hasContent = joinedNotes.length > 0;

  // Unsaved work = the editor's text differs from what's committed on relays.
  const hasUnsavedChanges = joinedNotes !== joinNotes(splitNotes(entryContent));

  // Flipping the visibility toggle is a saveable change even with identical
  // text — the same entry gets republished encrypted (or decrypted). Without
  // this, making a committed public entry Private would find Save disarmed.
  const privacyChanged =
    !!existingEntry && isPrivate !== isEncryptedEntry(existingEntry);
  const hasSaveableChanges = hasUnsavedChanges || privacyChanged;

  // Committed = today's entry is saved and the editor matches it exactly.
  // Coming back to this page after saving must not look like an unsaved
  // draft: Save reads "Saved ✓" (and is disarmed), and re-sharing warns that
  // it would put a second note on the community feed. Any edit re-arms Save —
  // resaving updates the same replaceable event, never a journal duplicate.
  const isCommitted = hasExistingEntry && !hasSaveableChanges && !blockSaveShare;

  const filledNoteCount = notes.filter((note) => note.text.trim().length > 0).length;

  const updateNote = (id: number, value: string) => {
    setNotes((prev) =>
      prev.map((note) => (note.id === id ? { ...note, text: value } : note))
    );
  };

  const addNote = () => {
    const note = makeNote('', 'draft');
    pendingFocusIdRef.current = note.id;
    setNotes((prev) => [...prev, note]);
  };

  const removeNote = (id: number) => {
    // Never drop to zero notes — keep one empty draft box to write into.
    setNotes((prev) => {
      const next = prev.filter((note) => note.id !== id);
      return next.length > 0 ? next : [makeNote('', 'draft')];
    });
  };

  // Editing a published note turns it back into a draft box (focus lands in it).
  // It stays draft until the next save republishes the whole entry.
  const editNote = (id: number) => {
    pendingFocusIdRef.current = id;
    setNotes((prev) =>
      prev.map((note) =>
        note.id === id ? { ...note, status: 'draft' } : note
      )
    );
  };

  // Discarding resets the editor to what's committed on relays (or an empty
  // box) and drops the local backup — the user asked for the text to go away.
  const resetToPublished = () => {
    clearEntryDraft();
    const committed = splitNotes(entryContent);
    setNotes(
      committed.length > 0
        ? committed.map((text) => makeNote(text, 'published'))
        : [makeNote('', 'draft')]
    );
  };

  const handleDiscard = () => {
    if (hasUnsavedChanges && !entryLocked) {
      setShowDiscardGuard(true);
      return;
    }
    resetToPublished();
  };

  // After a successful publish the editor matches what's on relays: show every
  // saved note as a published card. Publishing doesn't invalidate the entry
  // query, so we flip optimistically and advance the seed latch to the new
  // event id (a later refetch with that id then won't re-seed).
  const markEntryPublished = (savedContent: string, newEventId: string) => {
    const published = splitNotes(savedContent).map((text) =>
      makeNote(text, 'published')
    );
    setNotes(published.length > 0 ? published : [makeNote('', 'draft')]);
    seededKeyRef.current = `${day.dateString}:${newEventId}`;
  };

  // Optimistically insert the just-saved event into the entries-LIST cache so
  // useStreaks, the calendar dot, the heatmap, and milestone detection refresh
  // instantly — without an invalidate/refetch (which could return the pre-save
  // event mid-propagation and reseed stale content). A public save is also
  // upserted into every community-feed cache window, so switching to the
  // Community tab right after saving shows the new entry immediately — relay
  // propagation lag can't make the just-saved note invisible.
  // NOTE: these caches are presence/metadata sources and MAY hold ciphertext
  // (Private entries in the personal list) — consumers must read content via
  // useDecryptedEntry, never event.content directly.
  const cacheSavedEntry = (event: NostrEvent) => {
    if (!user) return;
    queryClient.setQueryData<NostrEvent[]>(
      ['gratitude-entries', user.pubkey],
      (prev) => dedupeEntriesByDTag([...(prev ?? []), event])
    );
    // The single-entry cache feeds this editor and has a 60s staleTime;
    // without this, a refetch inside that window would seed from the PRE-save
    // event and silently drop the note just added.
    queryClient.setQueryData<NostrEvent | null>(
      ['gratitude-entry', user.pubkey, day.dateString],
      event
    );
    // Community feed upsert (public entries only — ciphertext never renders
    // in the feed). Latest-wins per author + d tag, newest first.
    if (!event.tags.some(([name]) => name === 'encrypted')) {
      queryClient.setQueriesData<NostrEvent[]>(
        { queryKey: ['community-gratitude'] },
        (prev) => {
          if (!prev) return prev;
          const rest = prev.filter(
            (e) =>
              !(
                e.pubkey === event.pubkey &&
                e.tags.find(([name]) => name === 'd')?.[1] === day.dateString
              )
          );
          return [event, ...rest].sort((a, b) => b.created_at - a.created_at);
        }
      );
    }
  };

  // Saving a public entry ends on the Community tab, where the new note is
  // visible in context (the upsert above has already placed it there). The
  // tagged-notes half of the feed refetches so the rest of the wall is fresh.
  const goToCommunity = () => {
    queryClient.invalidateQueries({ queryKey: ['tagged-gratitude'] });
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set('tab', 'community');
      return next;
    });
  };

  /**
   * Build the 36669 event for the current editor state. For private entries
   * the content is NIP-44 ciphertext encrypted to the user's own pubkey, the
   * alt tag is generic, and no tag derives from the plaintext. Throws on any
   * encryption failure — the caller must fail closed, never publish plaintext
   * the user marked private.
   */
  const buildEntryEvent = async (): Promise<{
    kind: number;
    content: string;
    tags: string[][];
  }> => {
    if (!user) throw new Error('Not ready');

    // All of the day's notes live inside the single 36669, blank-line
    // delimited — one event per day stays the architecture. joinNotes drops
    // empty boxes, so a freshly added moment left blank never persists.
    const trimmedText = joinedNotes;
    const timestamp = Math.floor(day.date.getTime() / 1000);
    const baseTags = [
      ['d', day.dateString],
      ['published_at', String(timestamp)],
      ['day', String(day.dayOfYear)],
    ];

    if (!isPrivate) {
      return {
        kind: 36669,
        content: trimmedText,
        tags: [
          ...baseTags,
          ['alt', `Daily reflection entry for ${formatDisplayDate(day.date)} (Day ${day.dayOfYear})`],
        ],
      };
    }

    setIsEncrypting(true);
    try {
      const ciphertext = await encryptWithTimeout(user.signer, user.pubkey, trimmedText);

      // A definitive success resolves a bunker's 'unknown' capability
      // permanently. Timeouts and errors cache nothing: a timeout is not a
      // capability signal, and NIP-46 error strings are free-form — too
      // unreliable to confidently identify "method unsupported".
      if (user.method === 'bunker') {
        cacheNip44Support(user.pubkey, true);
      }

      return {
        kind: 36669,
        content: ciphertext,
        tags: [...baseTags, [...ENCRYPTED_TAG], ['alt', ENCRYPTED_ALT]],
      };
    } finally {
      setIsEncrypting(false);
    }
  };

  const describeEncryptError = (error: unknown): string => {
    // Always reassure: a fail-closed save keeps the editor intact (and the
    // draft backed up locally), so the user can retry or switch to Public
    // without retyping.
    const reassure = 'Nothing was saved — your notes are still here.';
    if (error instanceof Nip44UnsupportedError) {
      return `Your signer doesn't support NIP-44 encryption. ${reassure} Switch to Public to save with this signer.`;
    }
    if (error instanceof EncryptTimeoutError) {
      return `Your signer did not respond in time. ${reassure} Try again or switch to Public.`;
    }
    return `Encryption failed: ${error instanceof Error ? error.message : 'unknown error'}. ${reassure}`;
  };

  const handleSave = async () => {
    if (!user) {
      setShowLoginDialog(true);
      return;
    }

    // Never save while an existing entry is still decrypting or failed to
    // decrypt — an empty/partial editor could overwrite content not yet seen.
    if (blockSaveShare) return;

    if (!hasContent) {
      toast({
        title: 'Empty entry',
        description: 'Please write something before saving.',
        variant: 'destructive',
      });
      return;
    }

    let entryEvent;
    try {
      entryEvent = await buildEntryEvent();
    } catch (error) {
      // Fail closed: the user chose Private; plaintext must never go out.
      toast({
        title: 'Could not encrypt your entry',
        description: describeEncryptError(error),
        variant: 'destructive',
      });
      return;
    }

    updateAppSettings({ privacyDefault: isPrivate });

    // The plaintext we just committed (used to reflect published cards even for
    // a Private save, where the event content is ciphertext).
    const savedContent = joinedNotes;

    createEvent(entryEvent, {
      onSuccess: (data) => {
        // Saved for real — the local backup has served its purpose.
        clearEntryDraft();
        toast({
          title: isPrivate ? 'Private reflection saved 🔒' : 'Reflection saved! ✨',
          description: isPrivate
            ? 'Encrypted so only you can read it.'
            : 'Your reflection has been saved.',
        });
        // Whole entry is now committed — every note becomes a published card.
        markEntryPublished(savedContent, data.id);
        // Instant streak/calendar/heatmap/milestone/feed refresh (no refetch).
        cacheSavedEntry(data);
        // Saving a public entry ends on the Community tab so the new note is
        // seen in context. A private entry never appears there, so the
        // calendar (with its committed cards) is the honest landing place.
        if (!isPrivate) {
          goToCommunity();
        }
      },
      onError: () => {
        toast({
          title: 'Failed to save',
          description:
            'Nothing was saved — your notes are still here. Please try again.',
          variant: 'destructive',
        });
      },
    });
  };

  const handleShareToNostr = async () => {
    if (!user) {
      setShowLoginDialog(true);
      return;
    }

    if (blockSaveShare) return;

    if (!hasContent) {
      toast({
        title: 'No reflection to share',
        description: 'Please write something before sharing.',
        variant: 'destructive',
      });
      return;
    }

    // Share posts all of the day's notes (blank-line separated) — NoteContent
    // renders them as paragraphs in the feed and other clients.
    const trimmedText = joinedNotes;

    // First, save as kind 36669 (encrypted when Private is selected — the
    // kind 1 note below still shares the plaintext by explicit user action).
    let entryEvent;
    try {
      entryEvent = await buildEntryEvent();
    } catch (error) {
      // Fail closed: no journal save, no public note.
      toast({
        title: 'Could not encrypt your entry',
        description: describeEncryptError(error),
        variant: 'destructive',
      });
      return;
    }

    updateAppSettings({ privacyDefault: isPrivate });

    createEvent(
      entryEvent,
      {
        onSuccess: (data) => {
          // Saved for real — the local backup has served its purpose.
          clearEntryDraft();
          // The journal entry is committed — reflect published cards now (the
          // separate kind 1 share below doesn't affect the entry's state).
          markEntryPublished(trimmedText, data.id);
          // Instant streak/calendar/heatmap/milestone/feed refresh (no refetch).
          cacheSavedEntry(data);

          // After saving kind 36669, post as kind 1 note
          // Rotate through day emojis based on day number
          const dayEmojis = ["☀️", "🌿", "🌅", "🌞", "🌻", "⭐️"];
          const dayEmoji = dayEmojis[(day.dayOfYear - 1) % dayEmojis.length];

          const quote = getQuoteForDay(day.dayOfYear);
          const affirmation = getAffirmationForDay(day.dayOfYear);

          // Each note gets its own 🙏 prefix (not just the first).
          const notesBlock = splitNotes(trimmedText)
            .map((note) => `🙏 ${note}`)
            .join('\n\n');

          // Format the content for the kind 1 note
          const noteContent = `Day ${day.dayOfYear} ${dayEmoji}

✨ "${quote.text}"
— ${quote.author}

💫 "${affirmation}"

${notesBlock}

https://gratefulday.space`;

          // Extract mentioned pubkeys and add p tags for proper mention parsing
          const mentionedPubkeys = extractMentionedPubkeys(trimmedText);
          const tags: string[][] = [
            ['t', 'gratefulday'],
            ['t', 'gratefuldayspace'],
            ['d', day.dateString],
            ['day', String(day.dayOfYear)],
            // Add p tags for each mentioned user (required by NIP-27)
            ...mentionedPubkeys.map(pubkey => ['p', pubkey] as [string, string]),
          ];

          publishNote(
            {
              kind: 1,
              content: noteContent,
              tags,
            },
            {
              onSuccess: () => {
                toast({
                  title: 'Shared to Nostr! 🌟',
                  description: 'Your reflection has been saved and posted to gratefulday.space.',
                });
                goToCommunity();
              },
              onError: (error) => {
                toast({
                  title: 'Saved but failed to share',
                  description: error.message || 'Your reflection was saved but could not be posted.',
                  variant: 'destructive',
                });
              },
            }
          );
        },
        onError: () => {
          toast({
            title: 'Failed to save',
            description:
              'Nothing was saved — your notes are still here. Please try again.',
            variant: 'destructive',
          });
        },
      }
    );
  };

  const handleShareClick = () => {
    if (!user) {
      setShowLoginDialog(true);
      return;
    }
    if (blockSaveShare) return;
    if (!hasContent) {
      toast({
        title: 'No reflection to share',
        description: 'Please write something before sharing.',
        variant: 'destructive',
      });
      return;
    }

    // Sharing a private entry posts its text publicly as a kind 1 —
    // interpose an explicit confirm before any plaintext leaves the editor.
    // (This outranks the share-again guard: exposure beats duplication.)
    if (isPrivate) {
      setShowShareGuard(true);
      return;
    }

    // Sharing an already-committed entry again duplicates the kind 1 note on
    // the community feed (only the journal entry is replaceable) — confirm.
    if (isCommitted) {
      setShowShareAgainGuard(true);
      return;
    }

    handleShareToNostr();
  };

  const handleDeleteEntry = () => {
    if (!existingEntry) return;

    deleteEntry(existingEntry, {
      onSuccess: () => {
        toast({
          title: 'Deletion requested',
          description:
            'Your relays were asked to remove this entry. Removal is best-effort and copies may persist.',
        });
        // The deletion hook tombstones the entry and clears its caches; the
        // editor drops back to one fresh box (the seed effect re-latches on
        // the entry going away).
        clearEntryDraft();
        setNotes([makeNote('', 'draft')]);
      },
      onError: (error) => {
        toast({
          title: 'Failed to request deletion',
          description: error.message || 'Please try again.',
          variant: 'destructive',
        });
      },
    });
  };

  const canDelete = !!existingEntry && !!user && existingEntry.pubkey === user.pubkey;

  const deleteEntryButton = canDelete ? (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          disabled={isDeleting}
          className="text-destructive hover:text-destructive hover:bg-destructive/10"
        >
          {isDeleting ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4 mr-2" />
          )}
          {isDeleting ? 'Deleting…' : 'Delete entry'}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this entry?</AlertDialogTitle>
          <AlertDialogDescription>
            This sends a deletion request to your relays. Most relays honor it,
            but deletion on a decentralized network is best-effort and copies
            may persist.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleDeleteEntry}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Request deletion
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  ) : null;

  return (
    <>
      <div className="w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 mb-6 sm:mb-8">
        <Card className="border-2 border-amber-200 dark:border-amber-800 shadow-2xl bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm">
          <CardHeader className="pb-2">
            <CardTitle className="text-2xl font-bold flex items-center gap-2 flex-wrap">
              Capture Today's Gratitude
              {isCommitted && (
                <span className="inline-flex items-center gap-1 rounded-full border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">
                  <Check className="h-3 w-3" />
                  Saved
                </span>
              )}
            </CardTitle>
            <CardDescription className="text-base">
              Day {day.dayOfYear} of 365 · {formatDisplayDate(day.date)}
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-6 pt-2">
            {/* Gratitude Entry */}
            <div className="space-y-3">
              <div className="space-y-1">
                <label className="text-sm font-medium text-foreground block">
                  Write your moments of gratitude from today.
                </label>
                <p className="text-sm text-muted-foreground">
                  A person, a moment, or something simple. Leave a blank line
                  to add another.
                </p>
                {!user && (
                  <p className="text-xs text-muted-foreground">
                    Login to save your reflection — what you write is kept on
                    this device until you do.
                  </p>
                )}
              </div>
              {entrySeeding ? (
                /* Existing entry still decrypting — don't seed or allow saving yet. */
                <p className="flex items-center gap-2 text-sm text-muted-foreground p-3 border rounded-md min-h-[80px]">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading your entry…
                </p>
              ) : entryLocked ? (
                /* Couldn't decrypt — lock editing so a blank box can't overwrite it. */
                <p className="text-sm text-muted-foreground italic p-3 border rounded-md bg-muted/50">
                  🔒 This entry is encrypted and your current signer can't
                  decrypt it. Editing is disabled so you don't overwrite
                  content you can't see — switch to a signer that supports
                  NIP-44 to edit it.
                </p>
              ) : (
                <>
                  <div className="space-y-3">
                    {notes.map((note) =>
                      note.status === 'published' ? (
                        /* Committed: matches the version on relays. Edit
                           republishes the whole entry on the next save. */
                        <PublishedNoteCard
                          key={note.id}
                          text={note.text}
                          onEdit={() => editNote(note.id)}
                        />
                      ) : (
                        /* Draft: unsaved edits. */
                        <div key={note.id} className="relative">
                          {notes.length > 1 && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() => removeNote(note.id)}
                              aria-label="Remove this moment"
                              className="absolute top-1.5 right-1.5 z-10 h-6 w-6 text-muted-foreground hover:text-destructive"
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          <AutocompleteTextarea
                            ref={(el) => {
                              if (el) editorRefs.current.set(note.id, el);
                              else editorRefs.current.delete(note.id);
                            }}
                            value={note.text}
                            onChange={(value) => updateNote(note.id, value)}
                          />
                        </div>
                      )
                    )}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={addNote}
                    className="gap-1.5 h-8 text-muted-foreground -ml-1"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add another moment
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    {filledNoteCount > 1 && `${filledNoteCount} moments · `}
                    {joinedNotes.length} characters
                  </p>
                </>
              )}
            </div>

            {/* Whole-day visibility — one control for the ENTIRE entry, sitting
                with the save action, never beside an individual note. */}
            {!blockSaveShare && (
              <div className="space-y-2">
                {user && canEncrypt && (
                  <div className="rounded-lg border border-border/60 bg-muted/30 p-3 flex items-start justify-between gap-3">
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium text-foreground">
                        This day's entry
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {isPrivate
                          ? 'Private encrypts the whole day so only you can read it. The date stays visible.'
                          : 'Public shows this in the Community section and posts it to your relays.'}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setIsPrivate((p) => !p)}
                      aria-pressed={isPrivate}
                      aria-label={isPrivate ? 'Visibility: Private' : 'Visibility: Public'}
                      className="gap-1.5 h-8 shrink-0"
                    >
                      {isPrivate ? (
                        <>
                          <Lock className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                          Private
                        </>
                      ) : (
                        <>
                          <Globe className="h-3.5 w-3.5" />
                          Public
                        </>
                      )}
                    </Button>
                  </div>
                )}
                {showNip44Hint && (
                  <p className="text-xs text-muted-foreground">
                    Your signer doesn't support encryption (NIP-44). Entries
                    will be saved publicly.
                  </p>
                )}
              </div>
            )}

            {/* Action Buttons */}
            {isCommitted && (
              <p className="text-sm text-muted-foreground">
                Today's entry is saved. Edit a moment or add another — saving
                again updates this same entry, it never duplicates your journal.
              </p>
            )}
            <div className="flex flex-col sm:flex-row gap-3 justify-end">
              {deleteEntryButton && (
                <div className="order-4 sm:order-first sm:mr-auto">
                  {deleteEntryButton}
                </div>
              )}
              <Button
                onClick={handleSave}
                disabled={isEncrypting || isPending || isPublishingNote || blockSaveShare || !hasContent || !hasSaveableChanges}
                className="min-w-[100px] order-1 sm:order-2"
              >
                {isEncrypting || isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {isEncrypting ? 'Encrypting…' : 'Saving entry…'}
                  </>
                ) : isCommitted ? (
                  <>
                    <Check className="h-4 w-4 mr-2" />
                    Saved ✓
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    Save entry
                  </>
                )}
              </Button>
              <Button
                onClick={handleShareClick}
                disabled={isEncrypting || isPending || isPublishingNote || blockSaveShare || !hasContent}
                variant="default"
                className="bg-amber-600 hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-600 order-2 sm:order-3"
              >
                {isEncrypting || isPending || isPublishingNote ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {isEncrypting ? 'Encrypting…' : isPending ? 'Saving...' : 'Sharing...'}
                  </>
                ) : (
                  <>
                    <Share2 className="h-4 w-4 mr-2" />
                    Share to Nostr
                  </>
                )}
              </Button>
              <Button
                variant="destructive"
                onClick={handleDiscard}
                disabled={!hasUnsavedChanges || entryLocked}
                className="flex-1 sm:flex-initial order-5 sm:order-4"
              >
                Discard
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Discard guard: unsaved text must never disappear without a confirm */}
      <AlertDialog open={showDiscardGuard} onOpenChange={setShowDiscardGuard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard what you've written?</AlertDialogTitle>
            <AlertDialogDescription>
              This reflection hasn't been saved yet. Discarding throws it away.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep writing</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowDiscardGuard(false);
                resetToPublished();
              }}
            >
              Discard
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Share-again guard: the journal entry is replaceable, but each Share
          posts a fresh kind 1 note — sharing a committed entry twice puts a
          second copy on the community feed. */}
      <AlertDialog open={showShareAgainGuard} onOpenChange={setShowShareAgainGuard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Share this entry again?</AlertDialogTitle>
            <AlertDialogDescription>
              This entry is already saved. Sharing posts another note to the
              community feed — your journal entry itself is just updated, but
              the feed will show a second copy.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowShareAgainGuard(false);
                handleShareToNostr();
              }}
            >
              Share again
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Share guard for private entries */}
      <AlertDialog open={showShareGuard} onOpenChange={setShowShareGuard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Share this private entry?</AlertDialogTitle>
            <AlertDialogDescription>
              Sharing posts this text publicly on Nostr. Your journal copy
              stays encrypted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setShowShareGuard(false);
                handleShareToNostr();
              }}
            >
              Share publicly
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <LoginDialog
        isOpen={showLoginDialog}
        onClose={() => setShowLoginDialog(false)}
        onLogin={() => {
          setShowLoginDialog(false);
          toast({
            title: 'Welcome! 👋',
            description: 'Your note is still here — you can save it now.',
          });
        }}
      />
    </>
  );
}
