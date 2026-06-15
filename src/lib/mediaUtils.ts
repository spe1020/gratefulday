/**
 * Pure helpers for inline media in note content. A bare media URL in a note is
 * rendered as an inline player/image by file extension; everything else stays a
 * link. Detection is deliberately conservative (extension-based) — we never
 * HEAD-probe URLs, and a misclassified or 404 media URL degrades to a link.
 */

export type MediaType = 'image' | 'video' | 'audio';

const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif']);
const VIDEO_EXT = new Set(['mp4', 'webm', 'mov']);
const AUDIO_EXT = new Set(['mp3', 'm4a', 'ogg', 'wav']);

/**
 * Split trailing sentence punctuation the note tokenizer's greedy `[^\s]+`
 * over-captures (e.g. "see clip.mp4." → url "…clip.mp4" + trailing "."). The
 * returned `url` is what callers MUST use as both the media `src` and the
 * link-fallback `href`; `trailing` is re-emitted as plain text after the node.
 * Brackets/quotes are intentionally left alone (balanced-bracket URLs).
 */
export function splitTrailingPunctuation(raw: string): { url: string; trailing: string } {
  const match = raw.match(/[.,;:!?]+$/);
  if (!match) return { url: raw, trailing: '' };
  const trailing = match[0];
  return { url: raw.slice(0, raw.length - trailing.length), trailing };
}

/** The lowercased file extension of a URL's path (query/fragment stripped), or ''. */
function extensionOf(url: string): string {
  let pathname = url;
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url.split(/[?#]/)[0];
  }
  const lastSegment = pathname.split('/').pop() ?? '';
  const dot = lastSegment.lastIndexOf('.');
  return dot >= 0 ? lastSegment.slice(dot + 1).toLowerCase() : '';
}

/**
 * Classify a URL as inline media by extension, or null for "render as a link".
 * Query strings and fragments are ignored (e.g. `…/clip.mp4?x=1#t=2` → video).
 * Pass an already-trimmed URL (see splitTrailingPunctuation).
 */
export function detectMediaType(url: string): MediaType | null {
  const ext = extensionOf(url);
  if (IMAGE_EXT.has(ext)) return 'image';
  if (VIDEO_EXT.has(ext)) return 'video';
  if (AUDIO_EXT.has(ext)) return 'audio';
  return null;
}
