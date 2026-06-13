import { describe, it, expect, vi, beforeEach } from 'vitest';
import { forwardRef, useImperativeHandle } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
const invalidateQueries = vi.fn();

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return { ...actual, useQueryClient: () => ({ setQueryData, invalidateQueries }) };
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

import { DayDetailDialog } from './DayDetailDialog';

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

describe('DayDetailDialog — decrypt-failure data-loss guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    render(<DayDetailDialog day={TODAY} open onOpenChange={() => {}} />);

    // Editor is replaced by a lock message — never a blank textarea to overwrite with.
    expect(screen.queryByTestId('editor')).not.toBeInTheDocument();
    expect(screen.getByText(/can't\s+decrypt it/i)).toBeInTheDocument();

    // Both write actions are disabled, so no save can fire over unseen content.
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
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

    render(<DayDetailDialog day={TODAY} open onOpenChange={() => {}} />);

    // Each saved note is a read-only published card with its own Edit control —
    // no draft editor boxes on open.
    expect(await screen.findByText('first moment')).toBeInTheDocument();
    expect(screen.getByText('second moment')).toBeInTheDocument();
    expect(screen.queryByTestId('editor')).not.toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: /edit this moment/i })
    ).toHaveLength(2);
    expect(screen.getByText(/2 moments/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save entry/i })).not.toBeDisabled();
  });

  it('opens a one-note day as exactly one published card with no moment count', async () => {
    const oneNote: NostrEvent = {
      ...encryptedEntry,
      id: 'evt-one',
      content: 'just one moment',
      tags: [
        ['d', '2026-06-13'],
        ['day', '164'],
        ['published_at', '1700000000'],
      ],
    };
    mockExistingEntry.mockReturnValue({ data: oneNote });
    mockDecrypted.mockReturnValue({
      content: 'just one moment',
      isEncrypted: false,
      isDecrypting: false,
      decryptError: null,
    });

    render(<DayDetailDialog day={TODAY} open onOpenChange={() => {}} />);

    expect(await screen.findByText('just one moment')).toBeInTheDocument();
    expect(screen.queryByTestId('editor')).not.toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: /edit this moment/i })
    ).toHaveLength(1);
    // No multi-note count for a single note.
    expect(screen.queryByText(/moments ·/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save entry/i })).not.toBeDisabled();
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

    render(<DayDetailDialog day={TODAY} open onOpenChange={() => {}} />);

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

    render(<DayDetailDialog day={TODAY} open onOpenChange={() => {}} />);

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

  it('optimistically upserts the saved entry into the entries-list cache without a refetch', async () => {
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

    render(<DayDetailDialog day={TODAY} open onOpenChange={() => {}} />);
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

    // No single-entry cache write (would re-decrypt a Private save) and no refetch.
    expect(
      setQueryData.mock.calls.some(([key]) => key?.[0] === 'gratitude-entry')
    ).toBe(false);
    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it('"Add another moment" adds an empty draft box and reveals remove controls', async () => {
    mockExistingEntry.mockReturnValue({ data: null });
    mockDecrypted.mockReturnValue({
      content: '',
      isEncrypted: false,
      isDecrypting: false,
      decryptError: null,
    });

    render(<DayDetailDialog day={TODAY} open onOpenChange={() => {}} />);

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

  it('removing a draft box drops it and hides the remove control at one box', async () => {
    mockExistingEntry.mockReturnValue({ data: null });
    mockDecrypted.mockReturnValue({
      content: '',
      isEncrypted: false,
      isDecrypting: false,
      decryptError: null,
    });

    render(<DayDetailDialog day={TODAY} open onOpenChange={() => {}} />);

    // Build two draft boxes via Add, then remove one.
    fireEvent.click(await screen.findByRole('button', { name: /add another moment/i }));
    expect(await screen.findAllByTestId('editor')).toHaveLength(2);

    fireEvent.click(
      screen.getAllByRole('button', { name: /remove this moment/i })[0]
    );

    expect(await screen.findAllByTestId('editor')).toHaveLength(1);
    expect(
      screen.queryByRole('button', { name: /remove this moment/i })
    ).not.toBeInTheDocument();
  });

  it('renders a past-day multi-note entry as published cards with no Edit', () => {
    const pastDay: DayInfo = { ...TODAY, isToday: false, isPast: true };
    const plaintextMultiNote: NostrEvent = {
      ...encryptedEntry,
      id: 'evt-past-multi',
      content: 'grateful one\n\ngrateful two',
      tags: [
        ['d', '2026-06-13'],
        ['day', '164'],
        ['published_at', '1700000000'],
      ],
    };
    mockExistingEntry.mockReturnValue({ data: plaintextMultiNote });
    mockDecrypted.mockReturnValue({
      content: 'grateful one\n\ngrateful two',
      isEncrypted: false,
      isDecrypting: false,
      decryptError: null,
    });

    render(<DayDetailDialog day={pastDay} open onOpenChange={() => {}} />);

    // Each note renders in its own card rather than one run-on paragraph.
    const one = screen.getByText('grateful one');
    const two = screen.getByText('grateful two');
    expect(one).toBeInTheDocument();
    expect(two).toBeInTheDocument();
    expect(one).not.toBe(two);
    // No editor and no Edit affordance on a non-editable past day.
    expect(screen.queryByTestId('editor')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /edit this moment/i })
    ).not.toBeInTheDocument();
  });

  it('shows a loading state and disables Save/Share while an existing entry is still decrypting', () => {
    mockExistingEntry.mockReturnValue({ data: encryptedEntry });
    mockDecrypted.mockReturnValue({
      content: '',
      isEncrypted: true,
      isDecrypting: true,
      decryptError: null,
    });

    render(<DayDetailDialog day={TODAY} open onOpenChange={() => {}} />);

    expect(screen.queryByTestId('editor')).not.toBeInTheDocument();
    expect(screen.getByText(/loading your entry/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /share to nostr/i })).toBeDisabled();
  });
});

describe('DayDetailDialog — failed-save data safety', () => {
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
    render(<DayDetailDialog day={TODAY} open onOpenChange={() => {}} />);
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
    // Nothing was published, and the note is still in the still-open editor.
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
