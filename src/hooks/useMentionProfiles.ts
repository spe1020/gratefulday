import { useState, useEffect } from 'react';
import { useProfileSearchService } from '@/lib/profileSearchService';
import { Profile } from '@/types/nostr';

export const useMentionProfiles = (text: string) => {
  const [mentionedProfiles, setMentionedProfiles] = useState<Map<string, Profile>>(new Map());
  const { fetchProfile, parseIdentifier } = useProfileSearchService();

  useEffect(() => {
    // Match nostr mentions with exact lengths: npub1/nprofile1 (58-59 chars)
    const nostrMentions = text.match(/nostr:(npub1[a-z0-9]{58,59}|nprofile1[a-z0-9]{58,})\b/g);
    if (nostrMentions) {
      nostrMentions.forEach(async (mention) => {
        if (mentionedProfiles.has(mention)) return;
        
        const identifier = mention.replace('nostr:', '');
        try {
          const parsed = parseIdentifier(identifier);
          if (parsed) {
            const profile = await fetchProfile(parsed.pubkey);
            if (profile) {
              setMentionedProfiles(prev => new Map(prev).set(mention, profile));
            }
          }
        } catch {
          // Silently ignore parsing errors
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, fetchProfile, parseIdentifier]);

  return mentionedProfiles;
};
