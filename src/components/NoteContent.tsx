import { useMemo, useState } from 'react';
import { type NostrEvent } from '@nostrify/nostrify';
import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { useAuthor } from '@/hooks/useAuthor';
import { genUserName } from '@/lib/genUserName';
import { detectMediaType, splitTrailingPunctuation, type MediaType } from '@/lib/mediaUtils';
import { cn } from '@/lib/utils';

interface NoteContentProps {
  event: NostrEvent;
  className?: string;
}

/** Parses content of text note events so that URLs and hashtags are linkified. */
export function NoteContent({
  event, 
  className, 
}: NoteContentProps) {  
  // Process the content to render mentions, links, etc.
  const content = useMemo(() => {
    const text = event.content;

    // Regex to find URLs, Nostr references, and hashtags
    // npub1/note1: 58-59 chars, nprofile1/nevent1: 58+ chars
    // Using word boundaries to prevent matching beyond valid identifiers
    const regex = /(https?:\/\/[^\s]+)|nostr:(npub1[023456789acdefghjklmnpqrstuvwxyz]{58,59}|note1[023456789acdefghjklmnpqrstuvwxyz]{58,59}|(?:nprofile1|nevent1)[023456789acdefghjklmnpqrstuvwxyz]{58,})\b|(#\w+)/g;
    
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let keyCounter = 0;
    
    while ((match = regex.exec(text)) !== null) {
      const [fullMatch, url, nostrId, hashtag] = match;
      const index = match.index;

      // Add text before this match
      if (index > lastIndex) {
        parts.push(text.substring(lastIndex, index));
      }

      if (url) {
        // Trim trailing sentence punctuation the greedy URL match over-captures,
        // and use that single cleaned URL for BOTH media src and link href.
        const { url: cleanUrl, trailing } = splitTrailingPunctuation(url);
        const mediaType = detectMediaType(cleanUrl);

        if (mediaType) {
          parts.push(<InlineMedia key={`media-${keyCounter++}`} url={cleanUrl} type={mediaType} />);
        } else {
          parts.push(
            <a
              key={`url-${keyCounter++}`}
              href={cleanUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-500 hover:underline"
            >
              {cleanUrl}
            </a>
          );
        }
        // Re-emit the trimmed punctuation so the text reads faithfully.
        if (trailing) parts.push(trailing);
      } else if (nostrId) {
        // Handle Nostr references
        try {
          const decoded = nip19.decode(nostrId);

          if (decoded.type === 'npub') {
            const pubkey = decoded.data;
            parts.push(
              <NostrMention key={`mention-${keyCounter++}`} pubkey={pubkey} />
            );
          } else {
            // For other types, just show as a link
            parts.push(
              <Link
                key={`nostr-${keyCounter++}`}
                to={`/${nostrId}`}
                className="text-blue-500 hover:underline"
              >
                {fullMatch}
              </Link>
            );
          }
        } catch {
          // If decoding fails, just render as text
          parts.push(fullMatch);
        }
      } else if (hashtag) {
        // Handle hashtags
        const tag = hashtag.slice(1); // Remove the #
        parts.push(
          <Link
            key={`hashtag-${keyCounter++}`}
            to={`/t/${tag}`}
            className="text-blue-500 hover:underline"
          >
            {hashtag}
          </Link>
        );
      }

      lastIndex = index + fullMatch.length;
    }
    
    // Add any remaining text
    if (lastIndex < text.length) {
      parts.push(text.substring(lastIndex));
    }
    
    // If no special content was found, just use the plain text
    if (parts.length === 0) {
      parts.push(text);
    }
    
    return parts;
  }, [event]);

  return (
    <div className={cn("whitespace-pre-wrap break-words", className)}>
      {content.length > 0 ? content : event.content}
    </div>
  );
}

/**
 * Inline media for a bare media URL. Lazy / preload="none" so nothing downloads
 * until an image scrolls in or the viewer presses play — important in an open
 * feed where a note may carry several media links. On load error (404, or a URL
 * that isn't really media) it degrades to the original URL as a link.
 *
 * Privacy: loading remote media leaks the viewer's IP to the host. Accepted for
 * v1; a future "load media" setting could gate this.
 */
function InlineMedia({ url, type }: { url: string; type: MediaType }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-500 hover:underline"
      >
        {url}
      </a>
    );
  }

  if (type === 'image') {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="block my-2">
        <img
          src={url}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="max-h-80 w-auto max-w-full rounded-lg border border-border object-contain"
        />
      </a>
    );
  }

  if (type === 'video') {
    return (
      <video
        src={url}
        controls
        preload="none"
        onError={() => setFailed(true)}
        className="block my-2 max-h-80 w-full max-w-full rounded-lg border border-border"
      />
    );
  }

  return (
    <audio
      src={url}
      controls
      preload="none"
      onError={() => setFailed(true)}
      className="block my-2 w-full max-w-full"
    />
  );
}

// Helper component to display user mentions
function NostrMention({ pubkey }: { pubkey: string }) {
  const author = useAuthor(pubkey);
  const npub = nip19.npubEncode(pubkey);
  const hasRealName = !!author.data?.metadata?.name;
  const displayName = author.data?.metadata?.name ?? genUserName(pubkey);

  return (
    <Link 
      to={`/${npub}`}
      className={cn(
        "font-medium hover:underline",
        hasRealName 
          ? "text-blue-500" 
          : "text-gray-500 hover:text-gray-700"
      )}
    >
      @{displayName}
    </Link>
  );
}