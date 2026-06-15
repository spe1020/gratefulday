import { useMemo, useState } from 'react';
import { type NostrEvent } from '@nostrify/nostrify';
import { Link } from 'react-router-dom';
import { nip19 } from 'nostr-tools';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuthor } from '@/hooks/useAuthor';
import { useInView } from '@/hooks/useInView';
import { useEmbeddedEvent } from '@/hooks/useEmbeddedEvent';
import { genUserName } from '@/lib/genUserName';
import { decodeEmbedRef } from '@/lib/embedRef';
import { isEncryptedEntry } from '@/lib/privacyUtils';
import { detectMediaType, splitTrailingPunctuation, type MediaType } from '@/lib/mediaUtils';
import { cn } from '@/lib/utils';

interface NoteContentProps {
  event: NostrEvent;
  className?: string;
  /**
   * Recursion depth. 0 = top level (note/nevent/naddr refs render as embedded
   * quote cards). >= 1 = inside an embedded note: every nostr: ref renders as a
   * plain link instead, so embeds never nest (hard depth-1 guard).
   */
  depth?: number;
}

/** Parses content of text note events so that URLs and hashtags are linkified. */
export function NoteContent({
  event,
  className,
  depth = 0,
}: NoteContentProps) {
  // Process the content to render mentions, links, etc.
  const content = useMemo(() => {
    const text = event.content;

    // Regex to find URLs, Nostr references, and hashtags
    // npub1/note1: 58-59 chars, nprofile1/nevent1: 58+ chars
    // Using word boundaries to prevent matching beyond valid identifiers
    const regex = /(https?:\/\/[^\s]+)|nostr:(npub1[023456789acdefghjklmnpqrstuvwxyz]{58,59}|note1[023456789acdefghjklmnpqrstuvwxyz]{58,59}|(?:nprofile1|nevent1|naddr1)[023456789acdefghjklmnpqrstuvwxyz]{20,})\b|(#\w+)/g;
    
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

          if (depth >= 1) {
            // Depth-1 recursion guard: inside an embedded note, every nostr ref
            // is a plain link — no nested chips or quote cards.
            parts.push(<RefLink key={`nostr-${keyCounter++}`} nostrId={nostrId} label={fullMatch} />);
          } else if (decoded.type === 'npub' || decoded.type === 'nprofile') {
            const pubkey = decoded.type === 'npub' ? decoded.data : decoded.data.pubkey;
            parts.push(<NostrMention key={`mention-${keyCounter++}`} pubkey={pubkey} />);
          } else if (
            decoded.type === 'note' ||
            decoded.type === 'nevent' ||
            decoded.type === 'naddr'
          ) {
            // Embedded note quote card (depth 0 only; renders inner body at depth 1).
            parts.push(
              <EmbeddedNoteCard key={`embed-${keyCounter++}`} nostrId={nostrId} depth={depth} />
            );
          } else {
            parts.push(<RefLink key={`nostr-${keyCounter++}`} nostrId={nostrId} label={fullMatch} />);
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
  }, [event, depth]);

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

/** A nostr: reference rendered as a plain link (depth-1 guard, or fallback). */
function RefLink({ nostrId, label }: { nostrId: string; label: string }) {
  return (
    <Link to={`/${nostrId}`} className="text-blue-500 hover:underline break-all">
      {label}
    </Link>
  );
}

/** Compact relative timestamp like "3h", "2d", or a short date past a week. */
function relativeTime(createdAt: number): string {
  const seconds = Math.floor(Date.now() / 1000) - createdAt;
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(createdAt * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Muted fallback chip for an embed that can't be shown (not found / encrypted). */
function EmbeddedUnavailable({
  nostrId,
  label = 'Note unavailable',
}: {
  nostrId: string;
  label?: string;
}) {
  return (
    <Link to={`/${nostrId}`} className="text-xs text-muted-foreground hover:underline">
      {label} · view
    </Link>
  );
}

/** Author header + depth-1 snippet + view link for a fetched embed. */
function EmbeddedBody({
  event,
  nostrId,
  depth,
}: {
  event: NostrEvent;
  nostrId: string;
  depth: number;
}) {
  const author = useAuthor(event.pubkey);
  const metadata = author.data?.metadata;
  const displayName = metadata?.name || genUserName(event.pubkey);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2 min-w-0">
        <Avatar className="h-5 w-5 shrink-0">
          <AvatarImage src={metadata?.picture} alt={displayName} />
          <AvatarFallback className="text-[10px] bg-gradient-to-br from-amber-400 to-orange-500 text-white">
            {displayName.slice(0, 2).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <span className="text-xs font-semibold truncate">{displayName}</span>
        <span className="text-xs text-muted-foreground shrink-0">
          · {relativeTime(event.created_at)}
        </span>
      </div>
      {/* depth + 1 → inner nostr refs become plain links (recursion guard). */}
      <div className="text-sm text-foreground/90 line-clamp-4">
        <NoteContent event={event} depth={depth + 1} />
      </div>
      <Link to={`/${nostrId}`} className="text-xs text-blue-500 hover:underline">
        View note
      </Link>
    </div>
  );
}

/**
 * Generic compact quote card for an embedded note reference (note/nevent/naddr).
 * Decode → IntersectionObserver-gated fetch (lazy + implicit concurrency cap) →
 * render a generic quote (author + depth-1 snippet + view). Generic for ANY kind
 * — no kind routing, no interactive feed card nested inside.
 *
 * Degrades gracefully: undecodable / not-found / error → a muted "note
 * unavailable" link. An encrypted kind-36669 entry (naddr can resolve to one)
 * shows a muted placeholder — its ciphertext is NEVER rendered.
 */
function EmbeddedNoteCard({ nostrId, depth }: { nostrId: string; depth: number }) {
  const ref = useMemo(() => decodeEmbedRef(nostrId), [nostrId]);
  const { ref: ioRef, inView } = useInView<HTMLDivElement>();
  const { data: event, isLoading, isError } = useEmbeddedEvent(ref, inView);

  if (!ref) {
    return <RefLink nostrId={nostrId} label={`nostr:${nostrId}`} />;
  }

  return (
    <div ref={ioRef} className="my-2 rounded-lg border border-border bg-muted/30 p-3">
      {!inView || isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-3/4" />
        </div>
      ) : isError || !event ? (
        <EmbeddedUnavailable nostrId={nostrId} />
      ) : event.kind === 36669 && isEncryptedEntry(event) ? (
        <EmbeddedUnavailable nostrId={nostrId} label="Private entry — unavailable" />
      ) : (
        <EmbeddedBody event={event} nostrId={nostrId} depth={depth} />
      )}
    </div>
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