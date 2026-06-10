import { useMemo } from 'react';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useGratitudeEntries } from '@/hooks/useGratitudeEntries';
import { formatDateString } from '@/lib/gratitudeUtils';
import {
  calculateStreaks,
  getEntryDateStrings,
  getNextMilestone,
} from '@/lib/streakUtils';

export interface UseStreaksResult {
  current: number;
  longest: number;
  /** Unique entry days (after d-tag dedup). */
  total: number;
  todayCompleted: boolean;
  nextMilestone: number | null;
  isLoading: boolean;
}

/**
 * Streak stats for the current user, derived client-side from their kind
 * 36669 gratitude entries. Returns zeros while logged out or loading.
 */
export function useStreaks(): UseStreaksResult {
  const { user } = useCurrentUser();
  const { data: entries, isLoading } = useGratitudeEntries(user?.pubkey);

  const today = formatDateString(new Date());

  const streaks = useMemo(() => {
    const dateStrings = getEntryDateStrings(entries ?? []);
    const result = calculateStreaks(dateStrings, today);
    return { ...result, nextMilestone: getNextMilestone(result.current) };
  }, [entries, today]);

  return { ...streaks, isLoading };
}
