import { describe, it, expect, vi, beforeEach } from 'vitest';
import { forwardRef, useImperativeHandle, useRef } from 'react';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { NostrEvent } from '@nostrify/nostrify';
import type { DayInfo } from '@/lib/gratitudeUtils';
import type { DecryptedEntry } from '@/hooks/useDecryptedEntry';
import { DAILY_WISDOM } from '@/lib/data/dailyWisdom';
import { getWisdomHistory, recordWisdomInteraction } from '@/lib/wisdomStore';

// The data-loss guard depends only on the decrypt state + existence of an
// entry, so we mock the data hooks and assert the rendered guard directly.
const mockDecrypted = vi.fn<() => DecryptedEntry>();
const mockExistingEntry = vi.fn<() => {
  data: NostrEvent | null | undefined;
  isPending?: boolean;
  isFetching?: boolean;
  isError?: boolean;
  refetch?: () => void;
}>();
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
  SignerTimeoutError: class SignerTimeoutError extends Error {},
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
    const editorRef = useRef<HTMLTextAreaElement>(null);
    useImperativeHandle(ref, () => ({ focus: () => editorRef.current?.focus() }));
    return (
      <textarea
        ref={editorRef}
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

describe('DayDetailDialog — wisdom context', () => {
  const wisdom = DAILY_WISDOM[0];
  const wisdomDay = { ...TODAY, dayOfYear: 255, date: new Date(2026, 8, 12), dateString: '2026-09-12' };
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    publish.mockReset();
    mockUser.mockReturnValue({ user: { pubkey: 'pk-self', method: 'extension', signer: {} } });
    mockNip44.mockReturnValue({ supported: false });
    mockExistingEntry.mockReturnValue({ data: null });
    mockDecrypted.mockReturnValue({ content: '', isEncrypted: false, isDecrypting: false, decryptError: null });
    recordWisdomInteraction('pk-self', wisdom, wisdomDay.dateString, 'added');
  });

  it('shows optional context without writing it into the editor and links only after save success', async () => {
    render(<DayDetailDialog day={wisdomDay} open onOpenChange={() => {}} focusWisdom />);
    expect(screen.getByText(wisdom.prompt!)).toBeVisible();
    expect(screen.getByTestId('editor')).toHaveValue('');
    fireEvent.change(screen.getByTestId('editor'), { target: { value: 'I took time to listen.' } });
    fireEvent.click(screen.getByRole('button', { name: /save entry/i }));
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    const [event, callbacks] = publish.mock.calls[0];
    expect(event.content).toBe('I took time to listen.');
    expect(event.tags.some(([name]: string[]) => name === 'wisdom')).toBe(false);
    expect(getWisdomHistory('pk-self')[0].reflection).toBeUndefined();
    act(() => callbacks.onError(new Error('offline')));
    expect(getWisdomHistory('pk-self')[0].reflection).toBeUndefined();
    expect(screen.getByTestId('editor')).toHaveValue('I took time to listen.');
    fireEvent.click(screen.getByRole('button', { name: /save entry/i }));
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(2));
    act(() => publish.mock.calls[1][1].onSuccess({ ...event, id: 'saved', pubkey: 'pk-self', created_at: 100 }));
    expect(getWisdomHistory('pk-self')[0].reflection?.eventId).toBe('saved');
    expect(localStorage.getItem('gratefulday:wisdom:v1:pk-self')).not.toContain('I took time to listen.');
  });

  it('preserves old writing, adds an empty moment, and keeps context optional', () => {
    mockExistingEntry.mockReturnValue({ data: { ...encryptedEntry, id: 'legacy', tags: [['d', wisdomDay.dateString]] } });
    mockDecrypted.mockReturnValue({ content: 'An existing moment', isEncrypted: false, isDecrypting: false, decryptError: null });
    render(<DayDetailDialog day={wisdomDay} open onOpenChange={() => {}} focusWisdom />);
    expect(screen.getByText('An existing moment')).toBeVisible();
    expect(screen.getByTestId('editor')).toHaveValue('');
    fireEvent.click(screen.getByRole('button', { name: /remove wisdom context/i }));
    expect(screen.queryByText(wisdom.prompt!)).not.toBeInTheDocument();
    expect(screen.getByText('An existing moment')).toBeVisible();
    expect(getWisdomHistory('pk-self')[0].active).toBe(false);
  });

  it('keeps a guest draft and its chosen wisdom when signing in, even if an existing entry arrives later', () => {
    mockUser.mockReturnValue({ user: undefined });
    recordWisdomInteraction(undefined, wisdom, wisdomDay.dateString, 'added');
    const view = render(<DayDetailDialog day={wisdomDay} open onOpenChange={() => {}} focusWisdom />);
    fireEvent.change(screen.getByTestId('editor'), { target: { value: 'My draft before login' } });
    mockUser.mockReturnValue({ user: { pubkey: 'new-account', method: 'extension', signer: {} } });
    view.rerender(<DayDetailDialog day={wisdomDay} open onOpenChange={() => {}} focusWisdom />);
    expect(screen.getByTestId('editor')).toHaveValue('My draft before login');
    expect(getWisdomHistory('new-account')[0].active).toBe(true);
    mockExistingEntry.mockReturnValue({ data: { ...encryptedEntry, id: 'arrived-later', pubkey: 'new-account', tags: [['d', wisdomDay.dateString]] } });
    mockDecrypted.mockReturnValue({ content: 'Already saved earlier', isEncrypted: false, isDecrypting: false, decryptError: null });
    view.rerender(<DayDetailDialog day={wisdomDay} open onOpenChange={() => {}} focusWisdom />);
    expect(screen.getByText('Already saved earlier')).toBeVisible();
    expect(screen.getByTestId('editor')).toHaveValue('My draft before login');
  });

  it('preserves and focuses an empty guest draft when sign-in and the saved entry arrive together', () => {
    mockUser.mockReturnValue({ user: undefined });
    recordWisdomInteraction(undefined, wisdom, wisdomDay.dateString, 'added');
    // This path starts inside the day dialog, without the dashboard focus prop.
    const view = render(<DayDetailDialog day={wisdomDay} open onOpenChange={() => {}} />);
    expect(screen.getByTestId('editor')).toHaveValue('');

    mockUser.mockReturnValue({ user: { pubkey: 'empty-draft-account', method: 'extension', signer: {} } });
    mockExistingEntry.mockReturnValue({ data: { ...encryptedEntry, id: 'already-saved', pubkey: 'empty-draft-account', tags: [['d', wisdomDay.dateString]] } });
    mockDecrypted.mockReturnValue({ content: 'Already saved earlier', isEncrypted: false, isDecrypting: false, decryptError: null });
    view.rerender(<DayDetailDialog day={wisdomDay} open onOpenChange={() => {}} />);

    expect(screen.getByText('Already saved earlier')).toBeVisible();
    expect(screen.getByTestId('editor')).toHaveValue('');
    expect(screen.getByTestId('editor')).toHaveFocus();
    expect(getWisdomHistory('empty-draft-account')[0].active).toBe(true);
    expect(publish).not.toHaveBeenCalled();
  });

  it('waits for the initial relay query before saving a guest draft over an existing entry', async () => {
    mockUser.mockReturnValue({ user: undefined });
    const view = render(<DayDetailDialog day={wisdomDay} open onOpenChange={() => {}} />);
    fireEvent.change(screen.getByTestId('editor'), { target: { value: 'My new writing' } });

    mockUser.mockReturnValue({ user: { pubkey: 'pk-self', method: 'extension', signer: {} } });
    mockExistingEntry.mockReturnValue({ data: undefined, isPending: true, isFetching: true });
    view.rerender(<DayDetailDialog day={wisdomDay} open onOpenChange={() => {}} />);
    expect(screen.getByRole('button', { name: /save entry/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /share to nostr/i })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /save entry/i }));
    expect(publish).not.toHaveBeenCalled();

    mockExistingEntry.mockReturnValue({ data: { ...encryptedEntry, id: 'late-entry', tags: [['d', wisdomDay.dateString]] }, isPending: false, isFetching: false });
    mockDecrypted.mockReturnValue({ content: 'Saved before this visit', isEncrypted: false, isDecrypting: false, decryptError: null });
    view.rerender(<DayDetailDialog day={wisdomDay} open onOpenChange={() => {}} />);
    expect(screen.getByText('Saved before this visit')).toBeVisible();
    expect(screen.getByTestId('editor')).toHaveValue('My new writing');
    fireEvent.click(screen.getByRole('button', { name: /save entry/i }));
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    const [event, callbacks] = publish.mock.calls[0];
    expect(event.content).toBe('Saved before this visit\n\nMy new writing');
    act(() => callbacks.onSuccess({ ...event, id: 'new-save', pubkey: 'pk-self', created_at: 1_800_000_000 }));
    expect(screen.getByText('Saved before this visit')).toBeVisible();
    expect(screen.getByText('My new writing')).toBeVisible();
    expect(getWisdomHistory('pk-self')[0].reflection?.eventId).toBe('new-save');
  });

  it.each(['save entry', 'share to nostr'])('does not link unchanged writing after Edit and %s', async (action) => {
    mockExistingEntry.mockReturnValue({ data: { ...encryptedEntry, id: 'old-entry', tags: [['d', wisdomDay.dateString]] } });
    mockDecrypted.mockReturnValue({ content: 'An existing moment', isEncrypted: false, isDecrypting: false, decryptError: null });
    render(<DayDetailDialog day={wisdomDay} open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /edit this moment/i }));
    // Canonicalization must not turn surrounding whitespace into new writing.
    fireEvent.change(screen.getAllByTestId('editor')[0], { target: { value: '  An existing moment\r\n' } });
    fireEvent.click(screen.getByRole('button', { name: new RegExp(action, 'i') }));
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    const [event, callbacks] = publish.mock.calls[0];
    act(() => callbacks.onSuccess({ ...event, id: 'unchanged-save', pubkey: 'pk-self', created_at: 1_800_000_000 }));
    expect(getWisdomHistory('pk-self')[0].reflection).toBeUndefined();

    publish.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /edit this moment/i }));
    fireEvent.change(screen.getByTestId('editor'), { target: { value: 'I learned to listen with patience.' } });
    fireEvent.click(screen.getByRole('button', { name: /save entry/i }));
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    const [changedEvent, changedCallbacks] = publish.mock.calls[0];
    act(() => changedCallbacks.onSuccess({ ...changedEvent, id: 'changed-save', pubkey: 'pk-self', created_at: 1_800_000_001 }));
    expect(getWisdomHistory('pk-self')[0].reflection?.eventId).toBe('changed-save');
  });

  it('compares edits to the latest local save when wisdom is added afterward', async () => {
    // A different account starts with no wisdom selected and no relay entry.
    mockUser.mockReturnValue({ user: { pubkey: 'local-save-account', method: 'extension', signer: {} } });
    render(<DayDetailDialog day={wisdomDay} open onOpenChange={() => {}} />);
    fireEvent.change(screen.getByTestId('editor'), { target: { value: 'Already written today' } });
    fireEvent.click(screen.getByRole('button', { name: /save entry/i }));
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    act(() => publish.mock.calls[0][1].onSuccess({ ...publish.mock.calls[0][0], id: 'first-save', pubkey: 'local-save-account', created_at: 1_800_000_000 }));
    act(() => recordWisdomInteraction('local-save-account', wisdom, wisdomDay.dateString, 'added'));
    fireEvent.click(screen.getByRole('button', { name: /edit this moment/i }));
    fireEvent.click(screen.getByRole('button', { name: /save entry/i }));
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(2));
    act(() => publish.mock.calls[1][1].onSuccess({ ...publish.mock.calls[1][0], id: 'second-save', pubkey: 'local-save-account', created_at: 1_800_000_001 }));
    expect(getWisdomHistory('local-save-account')[0].reflection).toBeUndefined();
  });

  it('lets users remove unsaved wisdom context after the day has passed', () => {
    render(<DayDetailDialog day={{ ...wisdomDay, isPast: true, isToday: false }} open onOpenChange={() => {}} />);
    expect(screen.queryByTestId('editor')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /remove wisdom context/i }));
    expect(screen.queryByText(wisdom.prompt!)).not.toBeInTheDocument();
    expect(getWisdomHistory('pk-self')[0].active).toBe(false);
    expect(getWisdomHistory('pk-self')[0].reflection).toBeUndefined();
    expect(publish).not.toHaveBeenCalled();
  });

  it('keeps a draft safe if the initial query fails and allows retrying', () => {
    mockUser.mockReturnValue({ user: undefined });
    const view = render(<DayDetailDialog day={wisdomDay} open onOpenChange={() => {}} />);
    fireEvent.change(screen.getByTestId('editor'), { target: { value: 'Keep this draft' } });
    mockUser.mockReturnValue({ user: { pubkey: 'pk-self', method: 'extension', signer: {} } });
    const refetch = vi.fn();
    mockExistingEntry.mockReturnValue({ data: undefined, isPending: false, isError: true, refetch });
    view.rerender(<DayDetailDialog day={wisdomDay} open onOpenChange={() => {}} />);
    expect(screen.getByTestId('editor')).toHaveValue('Keep this draft');
    expect(screen.getByRole('button', { name: /save entry/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /share to nostr/i })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(refetch).toHaveBeenCalledTimes(1);

    mockExistingEntry.mockReturnValue({ data: null, isPending: false, isError: false, isFetching: false });
    view.rerender(<DayDetailDialog day={wisdomDay} open onOpenChange={() => {}} />);
    expect(screen.getByTestId('editor')).toHaveValue('Keep this draft');
    expect(screen.getByRole('button', { name: /save entry/i })).toBeEnabled();
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
    expect(publish).not.toHaveBeenCalled();
  });

  it('does not leak wisdom or private writing into Nostr tags or local history', async () => {
    const encrypt = vi.fn().mockResolvedValue('CIPHERTEXT');
    mockUser.mockReturnValue({ user: { pubkey: 'pk-self', method: 'extension', signer: { nip44: { encrypt } } } });
    mockNip44.mockReturnValue({ supported: true });
    render(<DayDetailDialog day={wisdomDay} open onOpenChange={() => {}} />);
    fireEvent.change(screen.getByTestId('editor'), { target: { value: 'My private response' } });
    fireEvent.click(screen.getByRole('button', { name: /save entry/i }));
    await waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    expect(encrypt).toHaveBeenCalledWith('pk-self', 'My private response');
    const [event, callbacks] = publish.mock.calls[0];
    expect(event.content).toBe('CIPHERTEXT');
    expect(event.tags).toContainEqual(['encrypted', 'nip44']);
    expect(JSON.stringify(event.tags)).not.toMatch(/patience|gracian|My private response/);
    act(() => callbacks.onSuccess({ ...event, id: 'private-saved', pubkey: 'pk-self', created_at: 100 }));
    expect(getWisdomHistory('pk-self')[0].reflection?.eventId).toBe('private-saved');
    expect(localStorage.getItem('gratefulday:wisdom:v1:pk-self')).not.toContain('My private response');
  });
});

describe('DayDetailDialog — decrypt-failure data-loss guard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Defaults: logged-in, signer without NIP-44 (toggle hidden, Public).
    mockUser.mockReturnValue({
      user: { pubkey: 'pk-self', method: 'extension', signer: {} },
    });
    mockNip44.mockReturnValue({ supported: false });
  });

  it('waits for a paused initial query without creating an extra draft in a saved day', () => {
    mockExistingEntry.mockReturnValue({ data: undefined, isPending: true, isFetching: false });
    mockDecrypted.mockReturnValue({ content: '', isEncrypted: false, isDecrypting: false, decryptError: null });
    const view = render(<DayDetailDialog day={TODAY} open onOpenChange={() => {}} />);
    expect(screen.getByText(/loading your entry/i)).toBeVisible();
    expect(screen.getByRole('button', { name: /save entry/i })).toBeDisabled();
    expect(screen.queryByTestId('editor')).not.toBeInTheDocument();

    mockExistingEntry.mockReturnValue({ data: { ...encryptedEntry, tags: [['d', TODAY.dateString]] }, isPending: false, isFetching: false });
    mockDecrypted.mockReturnValue({ content: 'Saved moment', isEncrypted: false, isDecrypting: false, decryptError: null });
    view.rerender(<DayDetailDialog day={TODAY} open onOpenChange={() => {}} />);
    expect(screen.getByText('Saved moment')).toBeVisible();
    expect(screen.queryByTestId('editor')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save entry/i })).toBeEnabled();

    mockExistingEntry.mockReturnValue({ data: { ...encryptedEntry, tags: [['d', TODAY.dateString]] }, isPending: false, isFetching: true });
    view.rerender(<DayDetailDialog day={TODAY} open onOpenChange={() => {}} />);
    expect(screen.getByRole('button', { name: /save entry/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /share to nostr/i })).toBeDisabled();
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
