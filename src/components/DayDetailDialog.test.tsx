import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { NostrEvent } from '@nostrify/nostrify';
import type { DayInfo } from '@/lib/gratitudeUtils';
import type { DecryptedEntry } from '@/hooks/useDecryptedEntry';

// The dialog is a read-only look back at a past day (editing lives in
// GratitudeComposer) — mock the data hooks and assert the rendered states.
const mockDecrypted = vi.fn<() => DecryptedEntry>();
const mockExistingEntry = vi.fn<() => { data: NostrEvent | null }>();
const mockUser = vi.fn<() => { user: unknown }>();

vi.mock('@/hooks/useDecryptedEntry', () => ({
  useDecryptedEntry: () => mockDecrypted(),
}));
vi.mock('@/hooks/useGratitudeEntries', () => ({
  useGratitudeEntry: () => mockExistingEntry(),
}));
vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => mockUser(),
}));
vi.mock('@/hooks/useDeleteGratitudeEntry', () => ({
  useDeleteGratitudeEntry: () => ({ mutate: vi.fn(), isPending: false }),
}));
vi.mock('@/hooks/useToast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { DayDetailDialog } from './DayDetailDialog';

const PAST_DAY: DayInfo = {
  dayOfYear: 100,
  date: new Date('2026-04-10T00:00:00Z'),
  dateString: '2026-04-10',
  isToday: false,
  isFuture: false,
  isPast: true,
  isUnlocked: true,
};

const baseEntry: NostrEvent = {
  id: 'evt-past',
  pubkey: 'pk-self',
  kind: 36669,
  content: 'grateful one\n\ngrateful two',
  created_at: 1_700_000_000,
  sig: 'sig',
  tags: [
    ['d', '2026-04-10'],
    ['day', '100'],
    ['published_at', '1700000000'],
  ],
};

describe('DayDetailDialog — past-day read-only view', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser.mockReturnValue({
      user: { pubkey: 'pk-self', method: 'extension', signer: {} },
    });
  });

  it('renders a past-day multi-note entry as read-only cards with no editor', () => {
    mockExistingEntry.mockReturnValue({ data: baseEntry });
    mockDecrypted.mockReturnValue({
      content: 'grateful one\n\ngrateful two',
      isEncrypted: false,
      isDecrypting: false,
      decryptError: null,
    });

    render(<DayDetailDialog day={PAST_DAY} open onOpenChange={() => {}} />);

    // Each note renders in its own card rather than one run-on paragraph.
    const one = screen.getByText('grateful one');
    const two = screen.getByText('grateful two');
    expect(one).toBeInTheDocument();
    expect(two).toBeInTheDocument();
    expect(one).not.toBe(two);
    // No editing affordances at all — this is a viewer.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /edit this moment/i })
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^post$/i })).not.toBeInTheDocument();
    // The owner can still delete the entry.
    expect(
      screen.getByRole('button', { name: /delete entry/i })
    ).toBeInTheDocument();
  });

  it('shows the encrypted-entry message when the signer cannot decrypt a past entry', () => {
    mockExistingEntry.mockReturnValue({
      data: {
        ...baseEntry,
        content: 'CIPHERTEXT',
        tags: [...baseEntry.tags, ['encrypted', 'nip44']],
      },
    });
    mockDecrypted.mockReturnValue({
      content: '',
      isEncrypted: true,
      isDecrypting: false,
      decryptError: new Error("signer can't decrypt"),
    });

    render(<DayDetailDialog day={PAST_DAY} open onOpenChange={() => {}} />);

    expect(screen.getByText(/can't\s+decrypt it/i)).toBeInTheDocument();
    expect(screen.getByText(/private/i)).toBeInTheDocument();
  });

  it('says so when no reflection was recorded', () => {
    mockExistingEntry.mockReturnValue({ data: null });
    mockDecrypted.mockReturnValue({
      content: '',
      isEncrypted: false,
      isDecrypting: false,
      decryptError: null,
    });

    render(<DayDetailDialog day={PAST_DAY} open onOpenChange={() => {}} />);

    expect(
      screen.getByText(/no reflection was recorded for this day/i)
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /delete entry/i })
    ).not.toBeInTheDocument();
  });
});
