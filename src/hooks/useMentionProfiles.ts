import { useState, useEffect } from 'react';
import { useProfileSearchService } from '@/lib/profileSearchService';
import { Profile } from '@/types/nostr';

export const useMentionProfiles = (text: string) => {
  const [mentionedProfiles, setMentionedProfiles] = useState<Map<string, Profile>>(new Map());
  const { fetchProfile, parseIdentifier } = useProfileSearchService();

  useEffect(() => {
    const nostrMentions = text.match(/nostr:(npub1[a-z0-9]{58,}|nprofile1[a-z0-9]{58,})/g);
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
        } catch (error) {
          // Silently ignore parsing errors
        }
      });
    }
  }, [text, fetchProfile, parseIdentifier]);

  return mentionedProfiles;
};
