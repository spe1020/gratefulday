
import { useNostr } from '@nostrify/react';
import { useCallback, useRef } from 'react';
import { nip19 } from 'nostr-tools';
import { getPrimalCache } from './primalCache';

type User = {
  name: string;
  picture: string;
  pubkey: string;
  nip05?: string;
};

export const useProfileSearchService = () => {
  const { nostr } = useNostr();
  const primalCache = useRef(getPrimalCache());

  const searchProfiles = useCallback(async (query: string): Promise<User[]> => {
    if (query.length < 2) {
      return [];
    }

    try {
      // Use Primal cache for fast, reliable search
      const profiles = await primalCache.current.searchProfiles(query, 10);

      return profiles
        .filter(p => p.name || p.display_name) // Only include profiles with names
        .map(p => ({
          name: p.display_name || p.name || '',
          picture: p.picture || '',
          pubkey: p.pubkey,
          nip05: p.nip05,
        }));
    } catch (error) {
      console.error('Error searching profiles via Primal:', error);
      return [];
    }
  }, []);

  const fetchProfile = useCallback(async (pubkey: string): Promise<User | null> => {
    const events = await nostr.query(
      [
        {
          kinds: [0],
          authors: [pubkey],
          limit: 1,
        },
      ]
    );

    if (events && events.length > 0) {
      const event = events[0];
      try {
        const metadata = JSON.parse(event.content);
        return {
          name: metadata.name,
          picture: metadata.picture,
          pubkey: event.pubkey,
        };
      } catch (e) {
        console.error('Error parsing metadata', e);
        return null;
      }
    }

    return null;
  }, [nostr]);

  const parseIdentifier = (value: string): { pubkey: string, relays: string[] } | null => {
    try {
      if (value.startsWith('npub1')) {
        const { data } = nip19.decode(value);
        return { pubkey: data as string, relays: [] };
      } else if (value.startsWith('nprofile1')) {
        const { data } = nip19.decode(value);
        const { pubkey, relays } = data as { pubkey: string, relays?: string[] };
        return { pubkey, relays: relays || [] };
      }
    } catch {
      // Silently ignore invalid identifiers (incomplete or malformed)
    }
    return null;
  };


  return {
    searchProfiles,
    fetchProfile,
    parseIdentifier,
  };
};
