import { describe, it, expect, vi, afterEach } from 'vitest';
import { timeAgo } from './timeUtils';

const NOW = 1_700_000_000; // fixed reference (unix seconds)

function freezeAt(nowSeconds: number) {
  vi.useFakeTimers();
  vi.setSystemTime(nowSeconds * 1000);
}

describe('timeAgo', () => {
  afterEach(() => vi.useRealTimers());

  it('formats seconds → "now", then m / h / d', () => {
    freezeAt(NOW);
    expect(timeAgo(NOW - 10)).toBe('now');
    expect(timeAgo(NOW - 59)).toBe('now');
    expect(timeAgo(NOW - 5 * 60)).toBe('5m');
    expect(timeAgo(NOW - 3 * 3600)).toBe('3h');
    expect(timeAgo(NOW - 2 * 86400)).toBe('2d');
  });

  it('renders a short date once past a week', () => {
    freezeAt(NOW);
    // 10 days ago — falls through to the toLocaleDateString branch (not "Nd").
    expect(timeAgo(NOW - 10 * 86400)).not.toMatch(/^\d+[mhd]$|^now$/);
  });

  it('treats a future timestamp as "now" (no negative "−Nm")', () => {
    freezeAt(NOW);
    expect(timeAgo(NOW + 500)).toBe('now');
  });
});
