import { describe, it, expect, vi, beforeEach } from 'vitest';
import { forwardRef, useImperativeHandle } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
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
  AutocompleteTextarea: forwardRef<{ focus: () => void }, { value: string }>(
    ({ value }, ref) => {
      useImperativeHandle(ref, () => ({ focus: () => {} }));
      return <textarea data-testid="editor" defaultValue={value} />;
    }
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
    // No editor affordances when locked — nothing to add a note to.
    expect(
      screen.queryByRole('button', { name: /add another moment/i })
    ).not.toBeInTheDocument();
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

    // Two separate boxes, each its own editor, with the moment count + count.
    const boxes = await screen.findAllByTestId('editor');
    expect(boxes).toHaveLength(2);
    expect(screen.getByText(/2 moments/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save/i })).not.toBeDisabled();
    // Per-note remove controls appear once there is more than one box.
    expect(
      screen.getAllByRole('button', { name: /remove this moment/i })
    ).toHaveLength(2);
    // The explicit affordance to add a note is discoverable.
    expect(
      screen.getByRole('button', { name: /add another moment/i })
    ).toBeInTheDocument();
  });

  it('seeds a one-note day as exactly one box, unchanged from a single entry', async () => {
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

    const boxes = await screen.findAllByTestId('editor');
    expect(boxes).toHaveLength(1);
    // No remove control and no multi-note count for a single note.
    expect(
      screen.queryByRole('button', { name: /remove this moment/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/moments ·/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save/i })).not.toBeDisabled();
  });

  it('"Add another moment" adds an empty box and reveals remove controls', async () => {
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

  it('removing a box drops it and hides the remove control at one box', async () => {
    const twoNotes: NostrEvent = {
      ...encryptedEntry,
      id: 'evt-two',
      content: 'alpha\n\nbeta',
      tags: [
        ['d', '2026-06-13'],
        ['day', '164'],
        ['published_at', '1700000000'],
      ],
    };
    mockExistingEntry.mockReturnValue({ data: twoNotes });
    mockDecrypted.mockReturnValue({
      content: 'alpha\n\nbeta',
      isEncrypted: false,
      isDecrypting: false,
      decryptError: null,
    });

    render(<DayDetailDialog day={TODAY} open onOpenChange={() => {}} />);

    expect(await screen.findAllByTestId('editor')).toHaveLength(2);
    fireEvent.click(
      screen.getAllByRole('button', { name: /remove this moment/i })[0]
    );

    expect(await screen.findAllByTestId('editor')).toHaveLength(1);
    expect(
      screen.queryByRole('button', { name: /remove this moment/i })
    ).not.toBeInTheDocument();
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
