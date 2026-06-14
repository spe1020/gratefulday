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

import { GratitudeVine } from './GratitudeVine';

const TODAY = new Date(2026, 5, 13); // Sat 2026-06-13

/** Mirror the component's locale formatting so assertions aren't en-only. */
function weekTitle(year: number, month: number, day: number, count: number): string {
  const label = new Date(year, month - 1, day).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
  return `Week of ${label} — ${count} ${count === 1 ? 'day' : 'days'}`;
}

function entry(dateString: string): NostrEvent {
  return {
    id: `evt-${dateString}`,
    pubkey: 'pk-self',
    kind: 36669,
    content: 'never read by the vine',
    created_at: 1_700_000_000,
    sig: 'sig',
    tags: [
      ['d', dateString],
      ['day', '1'],
      ['published_at', '1700000000'],
    ],
  };
}

describe('GratitudeVine', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUser.mockReturnValue({ user: { pubkey: 'pk-self' } });
  });

  it('renders a labelled vine summarizing unique journaled days', () => {
    mockEntries.mockReturnValue({
      data: [entry('2026-06-13'), entry('2026-06-10'), entry('2026-01-01')],
      isLoading: false,
    });

    render(<GratitudeVine today={TODAY} />);

    const vine = screen.getByRole('img', { name: /gratitude vine/i });
    expect(vine).toBeInTheDocument();
    expect(vine).toHaveAttribute(
      'aria-label',
      'Gratitude vine: 3 days journaled over the past year'
    );
    // One sprig (<g> with a week <title>) per week in the trailing window.
    expect(screen.getAllByText(/^Week of .+ — \d+ days?$/)).toHaveLength(53);
  });

  it('dedupes multiple events for the same day (counts unique days)', () => {
    mockEntries.mockReturnValue({
      data: [entry('2026-06-13'), entry('2026-06-13')],
      isLoading: false,
    });

    render(<GratitudeVine today={TODAY} />);
    expect(screen.getByRole('img', { name: /gratitude vine/i })).toHaveAttribute(
      'aria-label',
      'Gratitude vine: 1 day journaled over the past year'
    );
  });

  it('reports a full 7/7 week (the bloom condition) in its sprig title', () => {
    // A completed week entirely in the past: Sun 2026-05-31 .. Sat 2026-06-06.
    const fullWeek = [
      '2026-05-31', '2026-06-01', '2026-06-02', '2026-06-03',
      '2026-06-04', '2026-06-05', '2026-06-06',
    ].map(entry);
    mockEntries.mockReturnValue({ data: fullWeek, isLoading: false });

    render(<GratitudeVine today={TODAY} />);
    expect(
      screen.getByText(weekTitle(2026, 5, 31, 7))
    ).toBeInTheDocument();
  });

  it('draws one leaflet per journaled day and no bloom below a full week', () => {
    // 3 days in one completed past week; every other week is empty.
    const dates = ['2026-05-31', '2026-06-02', '2026-06-04'].map(entry);
    mockEntries.mockReturnValue({ data: dates, isLoading: false });

    const { container } = render(<GratitudeVine today={TODAY} />);
    // Leaflets are <ellipse>; exactly one per journaled day.
    expect(container.querySelectorAll('ellipse')).toHaveLength(3);
    // No bloom (amber petals) unless a week is 7/7.
    expect(container.querySelectorAll('[class~="fill-amber-400"]')).toHaveLength(0);
  });

  it('draws 7 leaflets and a bloom for a full 7/7 week', () => {
    const fullWeek = [
      '2026-05-31', '2026-06-01', '2026-06-02', '2026-06-03',
      '2026-06-04', '2026-06-05', '2026-06-06',
    ].map(entry);
    mockEntries.mockReturnValue({ data: fullWeek, isLoading: false });

    const { container } = render(<GratitudeVine today={TODAY} />);
    expect(container.querySelectorAll('ellipse')).toHaveLength(7);
    // Bloom = 5 amber petals (plus a darker amber center).
    expect(container.querySelectorAll('[class~="fill-amber-400"]')).toHaveLength(5);
  });

  it('self-hides when logged out, loading, or with zero entries', () => {
    mockUser.mockReturnValue({ user: undefined });
    mockEntries.mockReturnValue({ data: [], isLoading: false });
    const { container: loggedOut } = render(<GratitudeVine today={TODAY} />);
    expect(loggedOut).toBeEmptyDOMElement();

    mockUser.mockReturnValue({ user: { pubkey: 'pk-self' } });
    mockEntries.mockReturnValue({ data: undefined, isLoading: true });
    const { container: loading } = render(<GratitudeVine today={TODAY} />);
    expect(loading).toBeEmptyDOMElement();

    mockEntries.mockReturnValue({ data: [], isLoading: false });
    const { container: empty } = render(<GratitudeVine today={TODAY} />);
    expect(empty).toBeEmptyDOMElement();
  });
});
