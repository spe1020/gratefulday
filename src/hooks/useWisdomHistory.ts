import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { useCurrentUser } from './useCurrentUser';
import { parseWisdomHistory, subscribeWisdom, wisdomSnapshot, wisdomStorageUnavailable } from '@/lib/wisdomStore';

export function useWisdomHistory() {
  const { user } = useCurrentUser();
  const pubkey = user?.pubkey;
  const getSnapshot = useCallback(() => wisdomSnapshot(pubkey), [pubkey]);
  const raw = useSyncExternalStore(subscribeWisdom, getSnapshot, getSnapshot);
  const interactions = useMemo(() => parseWisdomHistory(raw), [raw]);
  return { interactions, pubkey, storageUnavailable: wisdomStorageUnavailable(pubkey) };
}
