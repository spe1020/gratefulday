import { useCallback, useState } from 'react';
import {
  getHiddenNoteIds,
  getMutedPubkeys,
  hideNote as hideNoteStore,
  mutePubkey as mutePubkeyStore,
} from '@/lib/feedModeration';

export interface FeedModeration {
  hiddenIds: ReadonlySet<string>;
  mutedPubkeys: ReadonlySet<string>;
  hideNote: (id: string) => void;
  mutePubkey: (pubkey: string) => void;
}

/**
 * React state over the local feed-moderation store. Writing through re-reads
 * the store into state so consumers (the feed's filter) re-render immediately
 * and the hidden/muted card disappears without a refetch.
 */
export function useFeedModeration(): FeedModeration {
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(() => getHiddenNoteIds());
  const [mutedPubkeys, setMutedPubkeys] = useState<ReadonlySet<string>>(() => getMutedPubkeys());

  const hideNote = useCallback((id: string) => {
    hideNoteStore(id);
    setHiddenIds(getHiddenNoteIds());
  }, []);

  const mutePubkey = useCallback((pubkey: string) => {
    mutePubkeyStore(pubkey);
    setMutedPubkeys(getMutedPubkeys());
  }, []);

  return { hiddenIds, mutedPubkeys, hideNote, mutePubkey };
}
