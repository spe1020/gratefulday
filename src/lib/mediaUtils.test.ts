import { describe, it, expect } from 'vitest';
import { detectMediaType, splitTrailingPunctuation } from './mediaUtils';

describe('detectMediaType', () => {
  it('classifies images', () => {
    for (const ext of ['jpg', 'jpeg', 'png', 'gif', 'webp', 'avif']) {
      expect(detectMediaType(`https://host/x.${ext}`)).toBe('image');
    }
  });

  it('classifies video, including the Blossom .mp4 example', () => {
    expect(detectMediaType('https://blossom.primal.net/abc123.mp4')).toBe('video');
    expect(detectMediaType('https://host/x.webm')).toBe('video');
    expect(detectMediaType('https://host/x.mov')).toBe('video');
  });

  it('classifies audio', () => {
    for (const ext of ['mp3', 'm4a', 'ogg', 'wav']) {
      expect(detectMediaType(`https://host/x.${ext}`)).toBe('audio');
    }
  });

  it('ignores query strings and fragments', () => {
    expect(detectMediaType('https://host/clip.mp4?token=abc&x=1')).toBe('video');
    expect(detectMediaType('https://host/pic.png#section')).toBe('image');
  });

  it('is case-insensitive on the extension', () => {
    expect(detectMediaType('https://host/IMG.JPG')).toBe('image');
  });

  it('returns null for non-media URLs (plain links)', () => {
    expect(detectMediaType('https://example.com')).toBeNull();
    expect(detectMediaType('https://nostrbook.dev/kinds/1111')).toBeNull();
    expect(detectMediaType('https://host/file.pdf')).toBeNull();
  });
});

describe('splitTrailingPunctuation', () => {
  it('strips trailing sentence punctuation', () => {
    expect(splitTrailingPunctuation('https://host/clip.mp4.')).toEqual({
      url: 'https://host/clip.mp4',
      trailing: '.',
    });
    expect(splitTrailingPunctuation('https://host/clip.mp4!?')).toEqual({
      url: 'https://host/clip.mp4',
      trailing: '!?',
    });
  });

  it('leaves a clean URL untouched', () => {
    expect(splitTrailingPunctuation('https://host/clip.mp4')).toEqual({
      url: 'https://host/clip.mp4',
      trailing: '',
    });
  });

  it('round-trips: the trimmed URL is the one detection and src/href use', () => {
    // The build-note guarantee — one trimmed URL drives detection AND both
    // the media src and the link-fallback href; the trailing char is separate.
    const raw = 'https://blossom.primal.net/abc123.mp4.';
    const { url, trailing } = splitTrailingPunctuation(raw);
    expect(url).toBe('https://blossom.primal.net/abc123.mp4');
    expect(trailing).toBe('.');
    expect(detectMediaType(url)).toBe('video');
    // Reconstructs the original exactly.
    expect(url + trailing).toBe(raw);
  });
});
