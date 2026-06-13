import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { NostrEvent } from '@nostrify/nostrify';
import type { DayInfo } from '@/lib/gratitudeUtils';
import type { DecryptedEntry } from '@/hooks/useDecryptedEntry';

// The data-loss guard depends only on the decrypt state + existence of an
// entry, so we mock the data hooks and assert the rendered guard directly.
const mockDecrypted = vi.fn<() => DecryptedEntry>();
const mockExistingEntry = vi.fn<() => { data: NostrEvent | null }>();
const createEvent = vi.fn();
const publishNote = vi.fn();

vi.mock('@/hooks/useDecryptedEntry', () => ({
  useDecryptedEntry: () => mockDecrypted(),
}));
vi.mock('@/hooks/useGratitudeEntries', () => ({
  useGratitudeEntry: () => mockExistingEntry(),
}));
vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => ({
    user: { pubkey: 'pk-self', method: 'extension', signer: {} },
  }),
}));
vi.mock('@/hooks/useNip44Support', () => ({
  useNip44Support: () => ({ supported: false }),
  cacheNip44Support: vi.fn(),
}));
vi.mock('@/hooks/useNostrPublish', () => ({
  useNostrPublish: () => ({ mutate: createEvent, isPending: false }),
}));
vi.mock('@/hooks/useDeleteGratitudeEntry', () => ({
  useDeleteGratitudeEntry: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));
// Editor + login dialog are irrelevant to this guard and pull in providers.
vi.mock('./AutocompleteTextarea', () => ({
  AutocompleteTextarea: ({ value }: { value: string }) => (
    <textarea data-testid="editor" defaultValue={value} />
  ),
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
  });

  it('seeds the editor with an existing multi-note entry and shows the moment count', async () => {
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

    // Editor is present (not locked) and the count reflects the two notes.
    expect(await screen.findByText(/2 moments/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save/i })).not.toBeDisabled();
  });

  it('renders a past-day multi-note entry as separate read-only blocks', () => {
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

    // Each note renders in its own element rather than one run-on paragraph.
    const one = screen.getByText('grateful one');
    const two = screen.getByText('grateful two');
    expect(one).toBeInTheDocument();
    expect(two).toBeInTheDocument();
    expect(one).not.toBe(two);
    // No editor in the read-only past view.
    expect(screen.queryByTestId('editor')).not.toBeInTheDocument();
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
