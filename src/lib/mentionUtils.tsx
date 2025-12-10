import React from 'react';
import { Profile } from '@/types/nostr';

export const renderTextWithMentions = (text: string, mentionedProfiles: Map<string, Profile>): React.ReactNode[] => {
  if (!text) return [];

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  // Match nostr mentions with exact lengths: npub1/nprofile1 (58-59 chars)
  const mentionRegex = /nostr:(npub1[a-z0-9]{58,59}|nprofile1[a-z0-9]{58,})\b/g;
  let match: RegExpExecArray | null;

  while ((match = mentionRegex.exec(text)) !== null) {
    const fullMention = match[0];
    const beforeText = text.substring(lastIndex, match.index);

    if (beforeText) {
      parts.push(beforeText);
    }

    const profile = mentionedProfiles.get(fullMention);
    parts.push(
      <span
        key={`mention-${match.index}`}
        contentEditable={false}
        data-mention={fullMention}
        className="inline-flex items-center gap-1 bg-primary/10 text-primary px-2 py-0.5 rounded-md font-medium"
        style={{ userSelect: 'all' }}
      >
        @{profile?.name || fullMention.substring(6, 16) + '...'}
      </span>
    );

    lastIndex = match.index + fullMention.length;
  }

  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex));
  }
  
  return parts;
};
