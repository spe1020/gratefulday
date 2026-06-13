import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { NostrEvent } from '@nostrify/nostrify';

const mockUser = vi.fn<() => { user: { pubkey: string } | undefined }>();
const mockEntries = vi.fn<() => { data: NostrEvent[] | undefined; isLoading: boolean }>();

vi.mock('@/hooks/useCurrentUser', () => ({
  useCurrentUser: () => mockUser(),
}));
vi.mock('@/hooks/useGratitudeEntries', () => ({
  useGratitudeEntries: () => mockEntries(),
}));

import { GratitudeHeatmap } from './GratitudeHeatmap';

const TODAY = new Date(2026, 5, 13); // 2026-06-13 (local)

function entry(dateString: string): NostrEvent {
  return {
    id: `evt-${dateString}`,
    pubkey: 'pk-self',
    kind: 36669,
    content: 'whatever (never read)',
    created_at: 1_700_000_000,
    sig: 'sig',
    tags: [
      ['d', dateString],
      ['day', '1'],
      ['published_at', '1700000000'],
    ],
  };
}

describe('GratitudeHeatmap', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser.mockReturnValue({ user: { pubkey: 'pk-self' } });
  });

  it('renders one filled cell per in-window entry date (presence-based)', () => {
    mockEntries.mockReturnValue({
      data: [entry('2026-06-13'), entry('2026-06-10'), entry('2026-01-01')],
      isLoading: false,
    });

    render(<GratitudeHeatmap today={TODAY} />);

    const filled = screen.getAllByTitle(/— reflected$/i);
    expect(filled).toHaveLength(3);
    // Today's entry is present and labelled.
    expect(screen.getByTitle(/Jun 13, 2026 — reflected/i)).toBeInTheDocument();
    // A day without an entry reads as "no entry", never decrypted content.
    expect(screen.getByTitle(/Jun 12, 2026 — no entry/i)).toBeInTheDocument();
  });

  it('dedupes multiple events for the same day into a single filled cell', () => {
    mockEntries.mockReturnValue({
      data: [entry('2026-06-13'), entry('2026-06-13')],
      isLoading: false,
    });

    render(<GratitudeHeatmap today={TODAY} />);
    expect(screen.getAllByTitle(/— reflected$/i)).toHaveLength(1);
  });

  it('self-hides when logged out, loading, or with zero entries', () => {
    mockUser.mockReturnValue({ user: undefined });
    mockEntries.mockReturnValue({ data: [], isLoading: false });
    const { container: loggedOut } = render(<GratitudeHeatmap today={TODAY} />);
    expect(loggedOut).toBeEmptyDOMElement();

    mockUser.mockReturnValue({ user: { pubkey: 'pk-self' } });
    mockEntries.mockReturnValue({ data: undefined, isLoading: true });
    const { container: loading } = render(<GratitudeHeatmap today={TODAY} />);
    expect(loading).toBeEmptyDOMElement();

    mockEntries.mockReturnValue({ data: [], isLoading: false });
    const { container: empty } = render(<GratitudeHeatmap today={TODAY} />);
    expect(empty).toBeEmptyDOMElement();
  });
});
