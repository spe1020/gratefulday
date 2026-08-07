import { AutocompleteTextarea, type AutocompleteTextareaHandle } from './AutocompleteTextarea';
import { useState, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
import { Globe, Loader2, Lock, Pencil, Plus, Save, Sparkles, Share2, Trash2, X } from 'lucide-react';
import type { DayInfo } from '@/lib/gratitudeUtils';
import { getQuoteForDay, getAffirmationForDay, formatDisplayDate } from '@/lib/gratitudeUtils';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useNostrPublish, SignerTimeoutError } from '@/hooks/useNostrPublish';
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
import { useToast } from '@/hooks/useToast';
import LoginDialog from './auth/LoginDialog';
import { nip19 } from 'nostr-tools';

interface DayDetailDialogProps {
  day: DayInfo | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * One note in the editor. `published` means "matches the version currently
 * stored on relays"; `draft` means "unsaved edits." The whole day is one
 * replaceable event, so Save republishes every note as a single entry — status
 * is a display concern, never per-note publishing. The stable `id` keys the
 * list so add/remove/edit don't shuffle DOM (and editor focus) by index.
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

// The per-entry privacy default is now durable + synced via useAppSettings
// (NIP-78), with the same localStorage key kept as its cache layer.
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

export function DayDetailDialog({ day, open, onOpenChange }: DayDetailDialogProps) {
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
  // seeding N cards on open never steals focus.
  const pendingFocusIdRef = useRef<number | null>(null);
  const [showLoginDialog, setShowLoginDialog] = useState(false);
  const [isPrivate, setIsPrivate] = useState(false);
  const [isEncrypting, setIsEncrypting] = useState(false);
  const [showNip44Hint, setShowNip44Hint] = useState(false);
  const [showShareGuard, setShowShareGuard] = useState(false);
  const { user } = useCurrentUser();
  const { supported: nip44Supported } = useNip44Support();
  const { settings: appSettings, updateSettings: updateAppSettings } = useAppSettings();
  // Snapshot of the synced privacy default, read non-reactively when the dialog
  // opens (mirrors the previous stored-value read) so a relay reconcile arriving
  // mid-edit can't flip the user's in-progress toggle.
  const privacyDefaultRef = useRef(appSettings.privacyDefault);
  privacyDefaultRef.current = appSettings.privacyDefault;
  const { mutate: createEvent, isPending } = useNostrPublish();
  const { mutate: publishNote, isPending: isPublishingNote } = useNostrPublish();
  const { mutate: deleteEntry, isPending: isDeleting } = useDeleteGratitudeEntry();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // Fetch existing entry for this day (only for display in past days, not for editing)
  const { data: existingEntry } = useGratitudeEntry(
    user?.pubkey,
    day?.dateString || ''
  );
  const {
    content: entryContent,
    isEncrypted: entryIsEncrypted,
    isDecrypting,
    decryptError,
  } = useDecryptedEntry(existingEntry);

  // Seed the editor from the existing entry exactly once per open-session for a
  // given entry id. We never re-seed after the user has started typing (the
  // latch blocks re-fires when, e.g., a background refetch toggles isDecrypting),
  // and we never seed plaintext over an entry we couldn't decrypt: a decrypt
  // failure leaves the editor empty AND save/share disabled, so a blank box can
  // never silently overwrite content the user can't currently read.
  const seededKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      seededKeyRef.current = null;
      return;
    }

    const key = `${day?.dateString ?? ''}:${existingEntry?.id ?? 'none'}`;
    if (seededKeyRef.current === key) return;

    if (!existingEntry) {
      // No saved entry: a single fresh empty draft box (seeded once).
      setNotes([makeNote('', 'draft')]);
      seededKeyRef.current = key;
      return;
    }

    // Wait for decryption to settle before seeding — don't latch yet.
    if (isDecrypting) return;

    if (decryptError) {
      // Fail-closed: couldn't read it, so don't seed plaintext. Latch to stop
      // re-firing; the locked UI + disabled save/share guard the rest.
      setNotes([makeNote('', 'draft')]);
      seededKeyRef.current = key;
      return;
    }

    // Successful decrypt or plaintext passthrough: stored notes seed as
    // published cards (one per note); empty entry falls back to a draft box.
    const seeded = splitNotes(entryContent);
    setNotes(
      seeded.length > 0
        ? seeded.map((text) => makeNote(text, 'published'))
        : [makeNote('', 'draft')]
    );
    seededKeyRef.current = key;
    // Keyed on existingEntry?.id, not the object: a background refetch that
    // returns an identity-changed-but-same entry must not re-fire seeding.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, day?.dateString, existingEntry?.id, isDecrypting, decryptError, entryContent]);

  // Focus the box for the pending note id once it has mounted as a draft.
  // Runs after every commit (cheap ref check); Add and Edit set the target id,
  // so seeding N cards on open never steals focus.
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
    if (!open) return;

    if (!user || !canEncrypt) {
      setIsPrivate(false);
    } else if (existingEntry) {
      setIsPrivate(isEncryptedEntry(existingEntry));
    } else {
      setIsPrivate(privacyDefaultRef.current ?? (nip44Supported === true));
    }
  }, [open, day, existingEntry, user, canEncrypt, nip44Supported]);

  // One-time hint when the signer can't encrypt at all.
  useEffect(() => {
    if (open && user && nip44Supported === false && !day?.isPast) {
      setShowNip44Hint(takeNip44HintSlot(user.pubkey));
    } else {
      setShowNip44Hint(false);
    }
  }, [open, user, nip44Supported, day]);

  if (!day) return null;

  const quote = getQuoteForDay(day.dayOfYear);
  const affirmation = getAffirmationForDay(day.dayOfYear);
  const isPastDay = day.isPast;

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
  const filledNoteCount = notes.filter((note) => note.text.trim().length > 0).length;
  const readOnlyNotes = splitNotes(entryContent);

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
  // event mid-propagation and reseed stale content). Only the list cache is
  // touched, never ['gratitude-entry', …]: that single-entry query feeds the
  // editor, and for a Private save its ciphertext would trigger a re-decrypt.
  // dedupeEntriesByDTag enforces the same latest-created_at-wins invariant the
  // hooks use, so a stale same-day duplicate can never win.
  // NOTE: this list cache is a presence/metadata source and MAY hold ciphertext
  // (Private entries) — consumers must read content via useDecryptedEntry,
  // never event.content directly.
  const cacheSavedEntry = (event: NostrEvent) => {
    if (!user) return;
    queryClient.setQueryData<NostrEvent[]>(
      ['gratitude-entries', user.pubkey],
      (prev) => dedupeEntriesByDTag([...(prev ?? []), event])
    );
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
    if (!user || !day) throw new Error('Not ready');

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
    // Always reassure: a fail-closed save keeps the editor open with every note
    // intact, so the user can retry or switch to Public without retyping.
    const reassure = 'Nothing was saved — your notes are still here.';
    if (error instanceof Nip44UnsupportedError) {
      return `Your signer doesn't support NIP-44 encryption. ${reassure} Switch to Public to save with this signer.`;
    }
    if (error instanceof EncryptTimeoutError) {
      return `Your signer did not respond in time. ${reassure} Try again or switch to Public.`;
    }
    return `Encryption failed: ${error instanceof Error ? error.message : 'unknown error'}. ${reassure}`;
  };

  const describeSaveError = (error: unknown): string => {
    if (error instanceof SignerTimeoutError) {
      return 'Your signer did not respond — nothing was saved. Your notes are still here; check your signer app and try again.';
    }
    return 'Nothing was saved — your notes are still here. Please try again.';
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
        toast({
          title: isPrivate ? 'Private reflection saved 🔒' : 'Reflection saved! ✨',
          description: isPrivate
            ? 'Encrypted so only you can read it.'
            : 'Your reflection has been saved.',
        });
        // Whole entry is now committed — every note becomes a published card.
        markEntryPublished(savedContent, data.id);
        // Instant streak/calendar/heatmap/milestone refresh (no refetch).
        cacheSavedEntry(data);
      },
      onError: (error) => {
        toast({
          title: 'Failed to save',
          description: describeSaveError(error),
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
          // The journal entry is committed — reflect published cards now (the
          // separate kind 1 share below doesn't affect the entry's state).
          markEntryPublished(trimmedText, data.id);
          // Instant streak/calendar/heatmap/milestone refresh (no refetch).
          cacheSavedEntry(data);

          // After saving kind 36669, post as kind 1 note
          // Rotate through day emojis based on day number
          const dayEmojis = ["☀️", "🌿", "🌅", "🌞", "🌻", "⭐️"];
          const dayEmoji = dayEmojis[(day.dayOfYear - 1) % dayEmojis.length];

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
        onError: (error) => {
          toast({
            title: 'Failed to save',
            description: describeSaveError(error),
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
    if (isPrivate) {
      setShowShareGuard(true);
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
        onOpenChange(false);
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
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[600px]">
          <DialogHeader>
            <DialogTitle className="text-2xl font-bold">
              Capture Your Gratitude
            </DialogTitle>
            <DialogDescription className="text-base">
              Day {day.dayOfYear} of 365 · {formatDisplayDate(day.date)}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-8 sm:space-y-10 py-4">
            {/* Quote Section */}
            <div className="p-6 rounded-lg bg-gradient-to-br from-amber-50 to-orange-50 dark:from-amber-950/20 dark:to-orange-950/20 border border-amber-200 dark:border-amber-800">
              <div className="flex items-start gap-3">
                <Sparkles className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-1" />
                <div className="space-y-2">
                  <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
                    Daily Wisdom
                  </p>
                  <p className="text-base italic text-amber-800 dark:text-amber-200">
                    "{quote.text}"
                  </p>
                  <p className="text-sm text-amber-700 dark:text-amber-300">
                    — {quote.author}
                  </p>
                </div>
              </div>
            </div>

            {/* Affirmation Section */}
            <div className="p-5 rounded-lg bg-gradient-to-br from-rose-50 to-pink-50 dark:from-rose-950/20 dark:to-pink-950/20 border border-rose-200 dark:border-rose-800">
              <p className="text-sm font-medium text-rose-900 dark:text-rose-100 mb-2">
                Daily Affirmation
              </p>
              <p className="text-base italic text-rose-800 dark:text-rose-200">
                "{affirmation}"
              </p>
            </div>

            {/* Gratitude Entry */}
            {isPastDay ? (
              /* Past Day - Read Only View */
              <div className="space-y-3">
                <div className="p-4 rounded-lg bg-muted/50 border border-border/50">
                  <div className="flex items-start gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <p className="text-sm font-medium text-foreground">
                          {existingEntry ? 'Your Reflection' : 'No Reflection'}
                        </p>
                        {entryIsEncrypted && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300">
                            <Lock className="h-3 w-3" />
                            Private
                          </span>
                        )}
                      </div>
                      {existingEntry ? (
                        <div className="space-y-2">
                          {isDecrypting ? (
                            <p className="flex items-center gap-2 text-sm text-muted-foreground">
                              <Loader2 className="h-4 w-4 animate-spin" />
                              Decrypting…
                            </p>
                          ) : decryptError ? (
                            <p className="text-sm text-muted-foreground italic">
                              🔒 Encrypted entry — your current signer can't
                              decrypt it.
                            </p>
                          ) : (
                            /* Committed past entry — same published-card look as
                               today, one card per note, read-only (no Edit). */
                            <div className="space-y-3">
                              {readOnlyNotes.map((note, i) => (
                                <PublishedNoteCard key={i} text={note} />
                              ))}
                            </div>
                          )}
                          <p className="text-xs text-muted-foreground">
                            Last updated: {new Date(existingEntry.created_at * 1000).toLocaleString()}
                          </p>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground italic">
                          No reflection was recorded for this day.
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              /* Today - Editable */
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
                      Login to save your reflection
                    </p>
                  )}
                </div>
                {entrySeeding ? (
                  /* Existing entry still decrypting — don't seed or allow save yet. */
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
            )}

            {/* Whole-day visibility — one control for the ENTIRE entry, sitting
                with the save action, never beside an individual note. */}
            {!isPastDay && !blockSaveShare && (
              <div className="space-y-2">
                {user && canEncrypt && (
                  <div className="rounded-lg border border-border/60 bg-muted/30 p-3 flex items-start justify-between gap-3">
                    <div className="space-y-0.5">
                      <p className="text-sm font-medium text-foreground">
                        This day's entry
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Private encrypts the whole day so only you can read it.
                        Public posts it to your relays. The date stays visible.
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
            {isPastDay ? (
              /* Past Day - Close (and Delete when an entry exists) */
              <div className="flex items-center gap-3">
                {deleteEntryButton}
                <Button
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  className="ml-auto"
                >
                  Close
                </Button>
              </div>
            ) : (
              /* Today - Full Action Buttons */
              <div className="flex flex-col sm:flex-row gap-3 justify-end">
                {deleteEntryButton && (
                  <div className="order-4 sm:order-first sm:mr-auto">
                    {deleteEntryButton}
                  </div>
                )}
                <Button
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                  className="flex-1 sm:flex-initial order-2 sm:order-1"
                >
                  Close
                </Button>
                <Button
                  onClick={handleSave}
                  disabled={isEncrypting || isPending || isPublishingNote || blockSaveShare || !hasContent}
                  className="min-w-[100px] order-1 sm:order-2"
                >
                  {isEncrypting || isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      {isEncrypting ? 'Encrypting…' : 'Saving entry…'}
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
                  className="bg-amber-600 hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-600 order-3"
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
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

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
            description: 'You can now save your reflections.',
          });
        }}
      />
    </>
  );
}
