/**
 * Compact relative timestamp for note/card UIs: "now", "5m", "3h", "2d", then a
 * short "Mon D" date past a week — with the year appended ("Jul 3, 2025") once
 * the date's year differs from the current one, so a 13-month-old note isn't
 * indistinguishable from this year's. Shared by the feed cards and embedded-note
 * cards so the formatting (and edge cases like a future `created_at`, which the
 * `< 60` branch renders as "now") stays consistent in one place.
 *
 * @param createdAt unix seconds (Nostr `event.created_at`).
 */
export function timeAgo(createdAt: number): string {
  const seconds = Math.floor(Date.now() / 1000) - createdAt;
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  const date = new Date(createdAt * 1000);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() !== new Date().getFullYear() ? { year: 'numeric' as const } : {}),
  });
}
