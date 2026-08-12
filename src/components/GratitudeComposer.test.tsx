import { describe, it, expect, vi, beforeEach } from 'vitest';
import { forwardRef, useImperativeHandle } from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import type { NostrEvent } from '@nostrify/nostrify';
import type { DayInfo } from '@/lib/gratitudeUtils';
import type { DecryptedEntry } from '@/hooks/useDecryptedEntry';

// The data-loss guard depends only on the decrypt state + existence of an
// entry, so we mock the data hooks and assert the rendered guard directly.
const mockDecrypted = vi.fn<() => DecryptedEntry>();
const mockExistingEntry = vi.fn<() => { data: NostrEvent | null }>();
const mockUser = vi.fn<() => { user: unknown }>();
const mockNip44 = vi.fn<() => { supported: boolean | 'unknown' }>();
// Both useNostrPublish() calls (36669 + kind 1) route through this one spy, so
// "not called" proves neither the entry nor a kind 1 note was published.
const publish = vi.fn();
const toast = vi.fn();
// Back-compat aliases for existing assertions.
const createEvent = publish;
const publishNote = publish;
// Query client spies — assert optimistic cache writes without a refetch.
const setQueryData = vi.fn();
const setQueriesData = vi.fn();
const invalidateQueries = vi.fn();
// Saving a public entry ends on the Community tab via the search params.
const setSearchParams = vi.fn();

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQueryClient: () => ({ setQueryData, setQueriesData, invalidateQueries }),
  };
});

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>();
  return {
    ...actual,
    useSearchParams: () => [new URLSearchParams(), setSearchParams],
  };
});

vi.mock('@/hooks/useDecryptedEntry', () => ({
  useDecryptedEntry: () => mockDecrypted(),
}));
vi.mock('@/hooks/useGratitudeEntries', () => ({
  useGratitudeEntry: () => mockExistingEntry(),
}));
vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => mockUser(),
}));
vi.mock('@/hooks/useNip44Support', () => ({
  useNip44Support: () => mockNip44(),
  cacheNip44Support: vi.fn(),
}));
vi.mock('@/hooks/useNostrPublish', () => ({
  useNostrPublish: () => ({ mutate: publish, isPending: false }),
}));
const updateAppSettings = vi.fn();
vi.mock('@/hooks/useAppSettings', () => ({
  useAppSettings: () => ({
    settings: { celebratedMilestones: [] },
    updateSettings: updateAppSettings,
    isLoading: false,
  }),
}));
vi.mock('@/hooks/useDeleteGratitudeEntry', () => ({
  useDeleteGratitudeEntry: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ toast }),
}));
// Editor + login dialog are irrelevant to this guard and pull in providers.
vi.mock('./AutocompleteTextarea', () => ({
  // Controlled stub so the box reflects the current note state (the real editor
  // syncs value->DOM; defaultValue would not update after the seed effect).
  AutocompleteTextarea: forwardRef<
    { focus: () => void },
    { value: string; onChange: (value: string) => void }
  >(({ value, onChange }, ref) => {
    useImperativeHandle(ref, () => ({ focus: () => {} }));
    return (
      <textarea
        data-testid="editor"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    );
  }),
}));
vi.mock('./auth/LoginDialog', () => ({ default: () => null }));

import { GratitudeComposer } from './GratitudeComposer';
import { readEntryDraft, clearEntryDraft } from '@/lib/entryDraft';

const TODAY: DayInfo = {
  dayOfYear: 164,
  date: new Date('2026-06-13T00:00:00Z'),
  dateString: '2026-06-13',
  isToday: true,
  isFuture: false,
  isPast: false,
  isUnlocked: true,
};

const encryptedEntry: NostrEvent = {
  id: 'evt-encrypted',
  pubkey: 'pk-self',
  kind: 36669,
  content: 'BASE64-CIPHERTEXT',
  created_at: 1_700_000_000,
  sig: 'sig',
  tags: [
    ['d', '2026-06-13'],
    ['day', '164'],
    ['published_at', '1700000000'],
    ['encrypted', 'nip44'],
  ],
};

/** Apply every recorded setSearchParams call to a fresh param set. */
function resolvedSearchParams(): URLSearchParams {
  let params = new URLSearchParams();
  for (const [arg] of setSearchParams.mock.calls) {
    params = typeof arg === 'function' ? arg(params) : new URLSearchParams(arg);
  }
  return params;
}

describe('GratitudeComposer — decrypt-failure data-loss guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearEntryDraft();
    // Defaults: logged-in, signer without NIP-44 (toggle hidden, Public).
    mockUser.mockReturnValue({
      user: { pubkey: 'pk-self', method: 'extension', signer: {} },
    });
    mockNip44.mockReturnValue({ supported: false });
  });

  it('locks Save and Share (no blank-overwrite path) when an existing private entry fails to decrypt', () => {
    mockExistingEntry.mockReturnValue({ data: encryptedEntry });
    mockDecrypted.mockReturnValue({
      content: '',
      isEncrypted: true,
      isDecrypting: false,
      decryptError: new Error("signer can't decrypt"),
    });

    render(<GratitudeComposer day={TODAY} />);

    // Editor is replaced by a lock message — never a blank textarea to overwrite with.
    expect(screen.queryByTestId('editor')).not.toBeInTheDocument();
    expect(screen.getByText(/can't\s+decrypt it/i)).toBeInTheDocument();

    // Both write actions are disabled, so no save can fire over unseen content.
    expect(screen.getByRole('button', { name: /save entry/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /share to nostr/i })).toBeDisabled();
    expect(createEvent).not.toHaveBeenCalled();
    expect(publishNote).not.toHaveBeenCalled();
    // No editor affordances when locked — nothing to add a note to.
    expect(
      screen.queryByRole('button', { name: /add another moment/i })
    ).not.toBeInTheDocument();
  });

  it('opens an existing multi-note entry as published cards (one indicator, no boxes)', async () => {
    const plaintextMultiNote: NostrEvent = {
      ...encryptedEntry,
      id: 'evt-plain-multi',
      content: 'first moment\n\nsecond moment',
      tags: [
        ['d', '2026-06-13'],
        ['day', '164'],
        ['published_at', '1700000000'],
      ],
    };
    mockExistingEntry.mockReturnValue({ data: plaintextMultiNote });
    mockDecrypted.mockReturnValue({
      content: 'first moment\n\nsecond moment',
      isEncrypted: false,
      isDecrypting: false,
      decryptError: null,
    });

    render(<GratitudeComposer day={TODAY} />);

    // Each saved note is a read-only published card with its own Edit control —
    // no draft editor boxes on open.
    expect(await screen.findByText('first moment')).toBeInTheDocument();
    expect(screen.getByText('second moment')).toBeInTheDocument();
    expect(screen.queryByTestId('editor')).not.toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: /edit this moment/i })
    ).toHaveLength(2);
    expect(screen.getByText(/2 moments/i)).toBeInTheDocument();
    // The entry is committed and unchanged — Save is disarmed as "Saved ✓".
    expect(screen.getByRole('button', { name: /saved/i })).toBeDisabled();
  });

  it('Edit turns a published card into a draft box seeded with its text', async () => {
    const oneNote: NostrEvent = {
      ...encryptedEntry,
      id: 'evt-edit',
      content: 'editable moment',
      tags: [
        ['d', '2026-06-13'],
        ['day', '164'],
        ['published_at', '1700000000'],
      ],
    };
    mockExistingEntry.mockReturnValue({ data: oneNote });
    mockDecrypted.mockReturnValue({
      content: 'editable moment',
      isEncrypted: false,
      isDecrypting: false,
      decryptError: null,
    });

    render(<GratitudeComposer day={TODAY} />);

    fireEvent.click(await screen.findByRole('button', { name: /edit this moment/i }));

    // The card becomes a draft editor box holding the same text.
    expect(screen.getByTestId('editor')).toHaveValue('editable moment');
    // It's no longer a published card (no Edit control for it).
    expect(
      screen.queryByRole('button', { name: /edit this moment/i })
    ).not.toBeInTheDocument();
  });

  it('a successful Public save flips drafts back to published cards', async () => {
    // Make the publish mock resolve so the optimistic flip runs (echo the
    // event so onSuccess sees a full NostrEvent, as the real signer returns).
    publish.mockImplementation((event, opts) =>
      opts?.onSuccess?.({ ...event, id: 'evt-published-new', pubkey: 'pk-self', created_at: 2_000_000_000, sig: 'x' })
    );
    mockExistingEntry.mockReturnValue({ data: null });
    mockDecrypted.mockReturnValue({
      content: '',
      isEncrypted: false,
      isDecrypting: false,
      decryptError: null,
    });

    render(<GratitudeComposer day={TODAY} />);

    // New day → one draft box. Type into it, then save the whole entry.
    fireEvent.change(await screen.findByTestId('editor'), {
      target: { value: 'a brand new moment' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save entry/i }));

    // The save handler awaits buildEntryEvent, so the optimistic flip settles a
    // microtask after the click; let it flush before asserting.
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    expect(publish.mock.calls[0][0]).toMatchObject({
      kind: 36669,
      content: 'a brand new moment',
    });

    // After success the entry shows as a published card and the box is gone.
    expect(await screen.findByText('a brand new moment')).toBeInTheDocument();
    expect(screen.queryByTestId('editor')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /edit this moment/i })
    ).toBeInTheDocument();
  });

  it('optimistically upserts the saved entry into the entries-list and community caches', async () => {
    publish.mockImplementation((event, opts) =>
      opts?.onSuccess?.({
        ...event,
        id: 'evt-new',
        pubkey: 'pk-self',
        created_at: 2_000_000_000,
        sig: 'x',
      })
    );
    mockExistingEntry.mockReturnValue({ data: null });
    mockDecrypted.mockReturnValue({
      content: '',
      isEncrypted: false,
      isDecrypting: false,
      decryptError: null,
    });

    render(<GratitudeComposer day={TODAY} />);
    fireEvent.change(await screen.findByTestId('editor'), {
      target: { value: 'today gratitude' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save entry/i }));

    await waitFor(() => expect(setQueryData).toHaveBeenCalled());

    // Wrote the entries-LIST cache for this pubkey…
    const call = setQueryData.mock.calls.find(
      ([key]) => Array.isArray(key) && key[0] === 'gratitude-entries'
    );
    expect(call).toBeTruthy();
    expect(call![0]).toEqual(['gratitude-entries', 'pk-self']);

    // …with an updater that upserts the saved event for its d tag (latest-wins).
    const updater = call![1] as (prev: NostrEvent[]) => NostrEvent[];
    const result = updater([]);
    expect(result).toHaveLength(1);
    expect(result[0].tags.find(([n]) => n === 'd')?.[1]).toBe('2026-06-13');

    // The single-entry cache (which seeds the editor) is refreshed too, so a
    // refetch inside its 60s staleTime can't seed the PRE-save event and drop
    // the note just added.
    const entryCall = setQueryData.mock.calls.find(
      ([key]) => Array.isArray(key) && key[0] === 'gratitude-entry'
    );
    expect(entryCall).toBeTruthy();
    expect(entryCall![0]).toEqual(['gratitude-entry', 'pk-self', '2026-06-13']);

    // A public save is placed at the top of the community feed caches, so the
    // Community tab already shows the new entry when the redirect lands.
    const feedCall = setQueriesData.mock.calls.find(
      ([filters]) => filters?.queryKey?.[0] === 'community-gratitude'
    );
    expect(feedCall).toBeTruthy();
    const feedUpdater = feedCall![1] as (prev: NostrEvent[]) => NostrEvent[];
    const feed = feedUpdater([]);
    expect(feed[0].content).toBe('today gratitude');

    // The community feed itself is never invalidated — a refetch racing relay
    // propagation could make the just-saved entry vanish from the wall.
    expect(
      invalidateQueries.mock.calls.some(
        ([f]) => f?.queryKey?.[0] === 'community-gratitude'
      )
    ).toBe(false);
  });

  it('switches to the Community tab after a successful public save', async () => {
    publish.mockImplementation((event, opts) =>
      opts?.onSuccess?.({
        ...event,
        id: 'evt-new',
        pubkey: 'pk-self',
        created_at: 2_000_000_000,
        sig: 'x',
      })
    );
    mockExistingEntry.mockReturnValue({ data: null });
    mockDecrypted.mockReturnValue({
      content: '',
      isEncrypted: false,
      isDecrypting: false,
      decryptError: null,
    });

    render(<GratitudeComposer day={TODAY} />);
    fireEvent.change(await screen.findByTestId('editor'), {
      target: { value: 'done for today' },
    });
    fireEvent.click(screen.getByRole('button', { name: /save entry/i }));

    // Saving ends on the Community tab, where the new note is visible in
    // context (the optimistic feed upsert has already placed it there).
    await waitFor(() => expect(setSearchParams).toHaveBeenCalled());
    expect(resolvedSearchParams().get('tab')).toBe('community');
  });

  it('defaults a new entry to the last-used choice, falling back to Private when encryption is confirmed', async () => {
    mockNip44.mockReturnValue({ supported: true });
    mockExistingEntry.mockReturnValue({ data: null });
    mockDecrypted.mockReturnValue({
      content: '',
      isEncrypted: false,
      isDecrypting: false,
      decryptError: null,
    });

    render(<GratitudeComposer day={TODAY} />);

    // No stored privacyDefault in the mock — confirmed NIP-44 support seeds
    // Private, mirroring DayDetailDialog's behavior.
    expect(
      await screen.findByRole('button', { name: /visibility: private/i })
    ).toBeInTheDocument();
  });

  it('"Add another moment" adds an empty draft box and reveals remove controls', async () => {
    mockExistingEntry.mockReturnValue({ data: null });
    mockDecrypted.mockReturnValue({
      content: '',
      isEncrypted: false,
      isDecrypting: false,
      decryptError: null,
    });

    render(<GratitudeComposer day={TODAY} />);

    expect(await screen.findAllByTestId('editor')).toHaveLength(1);
    expect(
      screen.queryByRole('button', { name: /remove this moment/i })
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /add another moment/i }));

    expect(await screen.findAllByTestId('editor')).toHaveLength(2);
    expect(
      screen.getAllByRole('button', { name: /remove this moment/i })
    ).toHaveLength(2);
  });

  it('shows a loading state and disables Save/Share while an existing entry is still decrypting', () => {
    mockExistingEntry.mockReturnValue({ data: encryptedEntry });
    mockDecrypted.mockReturnValue({
      content: '',
      isEncrypted: true,
      isDecrypting: true,
      decryptError: null,
    });

    render(<GratitudeComposer day={TODAY} />);

    expect(screen.queryByTestId('editor')).not.toBeInTheDocument();
    expect(screen.getByText(/loading your entry/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save entry/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /share to nostr/i })).toBeDisabled();
  });
});

describe('GratitudeComposer — committed ("saved") state', () => {
  const committedEntry: NostrEvent = {
    ...encryptedEntry,
    id: 'evt-committed',
    content: 'already saved moment',
    tags: [
      ['d', '2026-06-13'],
      ['day', '164'],
      ['published_at', '1700000000'],
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    clearEntryDraft();
    mockUser.mockReturnValue({
      user: { pubkey: 'pk-self', method: 'extension', signer: {} },
    });
    mockNip44.mockReturnValue({ supported: false });
    mockExistingEntry.mockReturnValue({ data: committedEntry });
    mockDecrypted.mockReturnValue({
      content: 'already saved moment',
      isEncrypted: false,
      isDecrypting: false,
      decryptError: null,
    });
  });

  it('shows a Saved badge, caption, and a disarmed "Saved ✓" button for a committed entry', async () => {
    render(<GratitudeComposer day={TODAY} />);

    expect(await screen.findByText('already saved moment')).toBeInTheDocument();
    // Header badge + explanatory caption make the state legible up front.
    expect(screen.getByText(/^saved$/i)).toBeInTheDocument();
    expect(
      screen.getByText(/never duplicates your journal/i)
    ).toBeInTheDocument();
    // Save is disarmed — there is nothing new to save.
    expect(screen.getByRole('button', { name: /saved/i })).toBeDisabled();
    expect(publish).not.toHaveBeenCalled();
  });

  it('re-arms Save as soon as a moment is edited', async () => {
    render(<GratitudeComposer day={TODAY} />);

    fireEvent.click(await screen.findByRole('button', { name: /edit this moment/i }));
    fireEvent.change(screen.getByTestId('editor'), {
      target: { value: 'already saved moment, plus more' },
    });

    const save = screen.getByRole('button', { name: /save entry/i });
    expect(save).not.toBeDisabled();
    // Committed affordances are gone while there are unsaved changes.
    expect(screen.queryByText(/never duplicates your journal/i)).not.toBeInTheDocument();
  });

  it('re-arms Save when only the visibility toggle changes (same text, re-encrypt)', async () => {
    // Making a committed public entry Private is a saveable change even
    // though the text is identical.
    mockNip44.mockReturnValue({ supported: true });

    render(<GratitudeComposer day={TODAY} />);
    await screen.findByText('already saved moment');
    expect(screen.getByRole('button', { name: /saved/i })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /visibility: public/i }));

    expect(screen.getByRole('button', { name: /save entry/i })).not.toBeDisabled();
  });

  it('interposes a confirm before re-sharing a committed entry (kind 1 would duplicate)', async () => {
    render(<GratitudeComposer day={TODAY} />);
    await screen.findByText('already saved moment');

    fireEvent.click(screen.getByRole('button', { name: /share to nostr/i }));

    // Nothing published yet — the guard interposes first.
    expect(publish).not.toHaveBeenCalled();
    const guard = await screen.findByRole('alertdialog');
    expect(within(guard).getByText(/second copy/i)).toBeInTheDocument();

    fireEvent.click(within(guard).getByRole('button', { name: /share again/i }));
    await waitFor(() => expect(publish).toHaveBeenCalled());
    expect(publish.mock.calls[0][0]).toMatchObject({ kind: 36669 });
  });

  it('cancelling the re-share confirm publishes nothing', async () => {
    render(<GratitudeComposer day={TODAY} />);
    await screen.findByText('already saved moment');

    fireEvent.click(screen.getByRole('button', { name: /share to nostr/i }));
    const guard = await screen.findByRole('alertdialog');
    fireEvent.click(within(guard).getByRole('button', { name: /cancel/i }));

    expect(publish).not.toHaveBeenCalled();
  });
});

describe('GratitudeComposer — local draft backup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearEntryDraft();
    mockUser.mockReturnValue({
      user: { pubkey: 'pk-self', method: 'extension', signer: {} },
    });
    mockNip44.mockReturnValue({ supported: false });
    mockExistingEntry.mockReturnValue({ data: null });
    mockDecrypted.mockReturnValue({
      content: '',
      isEncrypted: false,
      isDecrypting: false,
      decryptError: null,
    });
  });

  it('backs up typed text locally and restores it after a remount (login/reload round-trip)', async () => {
    const { unmount } = render(<GratitudeComposer day={TODAY} />);

    fireEvent.change(await screen.findByTestId('editor'), {
      target: { value: 'nearly lost forever' },
    });
    expect(readEntryDraft(TODAY.dateString)).toEqual(['nearly lost forever']);

    // Simulate the page coming back after a login round-trip or tab discard.
    unmount();
    render(<GratitudeComposer day={TODAY} />);

    expect(await screen.findByTestId('editor')).toHaveValue('nearly lost forever');
  });

  it('keeps typed text when the entry re-seeds after login resolves it', async () => {
    // Logged out: the user types before any entry can load.
    mockUser.mockReturnValue({ user: null });
    const { rerender } = render(<GratitudeComposer day={TODAY} />);
    fireEvent.change(await screen.findByTestId('editor'), {
      target: { value: 'typed while logged out' },
    });

    // Login resolves and the user's existing entry arrives — the re-seed that
    // follows must merge the draft back in, not wipe it.
    mockUser.mockReturnValue({
      user: { pubkey: 'pk-self', method: 'extension', signer: {} },
    });
    mockExistingEntry.mockReturnValue({
      data: {
        ...encryptedEntry,
        id: 'evt-after-login',
        content: 'already saved note',
        tags: [
          ['d', '2026-06-13'],
          ['day', '164'],
          ['published_at', '1700000000'],
        ],
      },
    });
    mockDecrypted.mockReturnValue({
      content: 'already saved note',
      isEncrypted: false,
      isDecrypting: false,
      decryptError: null,
    });
    rerender(<GratitudeComposer day={TODAY} />);

    expect(await screen.findByText('already saved note')).toBeInTheDocument();
    expect(screen.getByTestId('editor')).toHaveValue('typed while logged out');
  });

  it('clears the backup after a successful save', async () => {
    publish.mockImplementation((event, opts) =>
      opts?.onSuccess?.({
        ...event,
        id: 'evt-posted',
        pubkey: 'pk-self',
        created_at: 2_000_000_000,
        sig: 'x',
      })
    );

    render(<GratitudeComposer day={TODAY} />);
    fireEvent.change(await screen.findByTestId('editor'), {
      target: { value: 'saved moment' },
    });
    expect(readEntryDraft(TODAY.dateString)).toEqual(['saved moment']);

    fireEvent.click(screen.getByRole('button', { name: /save entry/i }));

    await waitFor(() => expect(publish).toHaveBeenCalled());
    expect(readEntryDraft(TODAY.dateString)).toEqual([]);
  });

  it('Discard (after confirming) clears both the editor and the backup', async () => {
    render(<GratitudeComposer day={TODAY} />);
    fireEvent.change(await screen.findByTestId('editor'), {
      target: { value: 'second thoughts' },
    });
    expect(readEntryDraft(TODAY.dateString)).toEqual(['second thoughts']);

    fireEvent.click(screen.getByRole('button', { name: /^discard$/i }));
    // The guard interposes; confirm inside it (the page button is still there).
    const guard = await screen.findByRole('alertdialog');
    fireEvent.click(within(guard).getByRole('button', { name: /^discard$/i }));

    await waitFor(() =>
      expect(screen.getByTestId('editor')).toHaveValue('')
    );
    expect(readEntryDraft(TODAY.dateString)).toEqual([]);
  });
});

describe('GratitudeComposer — failed-save data safety', () => {
  // A signer that advertises NIP-44 but rejects every encrypt call, so a
  // Private save fails closed through the real privacyUtils path.
  const failingSigner = {
    nip44: {
      encrypt: () => Promise.reject(new Error('signer refused to encrypt')),
      decrypt: () => Promise.reject(new Error('signer refused to decrypt')),
    },
  };

  // A plaintext entry seeds a published card; the user edits it into a draft,
  // switches the whole day to Private, then saves.
  const plaintextEntry: NostrEvent = {
    ...encryptedEntry,
    id: 'evt-plain',
    content: 'my unsaved thoughts',
    tags: [
      ['d', '2026-06-13'],
      ['day', '164'],
      ['published_at', '1700000000'],
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    clearEntryDraft();
    mockNip44.mockReturnValue({ supported: true });
    mockUser.mockReturnValue({
      user: { pubkey: 'pk-self', method: 'extension', signer: failingSigner },
    });
    mockExistingEntry.mockReturnValue({ data: plaintextEntry });
    mockDecrypted.mockReturnValue({
      content: 'my unsaved thoughts',
      isEncrypted: false,
      isDecrypting: false,
      decryptError: null,
    });
  });

  async function editSwitchPrivateThenClick(buttonName: RegExp) {
    render(<GratitudeComposer day={TODAY} />);
    // Edit the seeded published card into a draft box (now an unsaved edit).
    fireEvent.click(await screen.findByRole('button', { name: /edit this moment/i }));
    expect(screen.getByTestId('editor')).toHaveValue('my unsaved thoughts');
    // Flip the whole-day control to Private (it seeds Public for a plaintext entry).
    fireEvent.click(screen.getByRole('button', { name: /visibility: public/i }));
    fireEvent.click(screen.getByRole('button', { name: buttonName }));
  }

  it('keeps the note and fires no event when a Private handleSave fails closed', async () => {
    await editSwitchPrivateThenClick(/save entry/i);

    // The encryption rejection surfaces as a reassuring, fail-closed toast.
    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'destructive' })
      )
    );
    expect(toast.mock.calls.some(([t]) => /still here/i.test(t.description))).toBe(
      true
    );
    // Nothing was published, and the note is still in the editor.
    expect(publish).not.toHaveBeenCalled();
    expect(screen.getByTestId('editor')).toHaveValue('my unsaved thoughts');
  });

  it('keeps the note and fires NO kind 1 when a Private share fails closed', async () => {
    // Share of a Private entry routes through the confirm guard first.
    await editSwitchPrivateThenClick(/share to nostr/i);
    fireEvent.click(await screen.findByRole('button', { name: /share publicly/i }));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'destructive' })
      )
    );
    expect(toast.mock.calls.some(([t]) => /still here/i.test(t.description))).toBe(
      true
    );
    // Encryption failed before any publish: neither the 36669 nor a kind 1 fired.
    expect(publish).not.toHaveBeenCalled();
    expect(screen.getByTestId('editor')).toHaveValue('my unsaved thoughts');
  });
});
