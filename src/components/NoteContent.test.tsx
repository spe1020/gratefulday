import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { nip19 } from 'nostr-tools';
import { TestApp } from '@/test/TestApp';
import { NoteContent } from './NoteContent';
import type { NostrEvent } from '@nostrify/nostrify';

const NEVENT = nip19.neventEncode({ id: 'a'.repeat(64) });
const NADDR = nip19.naddrEncode({ kind: 30023, pubkey: 'b'.repeat(64), identifier: 'slug' });
const NPROFILE = nip19.nprofileEncode({ pubkey: 'c'.repeat(64) });

function noteWith(content: string): NostrEvent {
  return {
    id: 'test-id',
    pubkey: 'test-pubkey',
    created_at: 1000,
    kind: 1,
    tags: [],
    content,
    sig: 'test-sig',
  };
}

describe('NoteContent', () => {
  it('linkifies URLs in kind 1 events', () => {
    const event: NostrEvent = {
      id: 'test-id',
      pubkey: 'test-pubkey',
      created_at: Math.floor(Date.now() / 1000),
      kind: 1,
      tags: [],
      content: 'Check out this link: https://example.com',
      sig: 'test-sig',
    };

    render(
      <TestApp>
        <NoteContent event={event} />
      </TestApp>
    );

    const link = screen.getByRole('link', { name: 'https://example.com' });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', 'https://example.com');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('linkifies URLs in kind 1111 events (comments)', () => {
    const event: NostrEvent = {
      id: 'test-comment-id',
      pubkey: 'test-pubkey',
      created_at: Math.floor(Date.now() / 1000),
      kind: 1111,
      tags: [
        ['a', '30040:pubkey:identifier'],
        ['k', '30040'],
        ['p', 'pubkey'],
      ],
      content: 'I think the log events should be different kind numbers instead of having a `log-type` tag. That way you can use normal Nostr filters to filter the log types. Also, the `note` type should just b a kind 1111: https://nostrbook.dev/kinds/1111',
      sig: 'test-sig',
    };

    render(
      <TestApp>
        <NoteContent event={event} />
      </TestApp>
    );

    const link = screen.getByRole('link', { name: 'https://nostrbook.dev/kinds/1111' });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', 'https://nostrbook.dev/kinds/1111');
    expect(link).toHaveAttribute('target', '_blank');
  });

  it('handles text without URLs correctly', () => {
    const event: NostrEvent = {
      id: 'test-id',
      pubkey: 'test-pubkey',
      created_at: Math.floor(Date.now() / 1000),
      kind: 1111,
      tags: [],
      content: 'This is just plain text without any links.',
      sig: 'test-sig',
    };

    render(
      <TestApp>
        <NoteContent event={event} />
      </TestApp>
    );

    expect(screen.getByText('This is just plain text without any links.')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('renders hashtags as links', () => {
    const event: NostrEvent = {
      id: 'test-id',
      pubkey: 'test-pubkey',
      created_at: Math.floor(Date.now() / 1000),
      kind: 1,
      tags: [],
      content: 'This is a post about #nostr and #bitcoin development.',
      sig: 'test-sig',
    };

    render(
      <TestApp>
        <NoteContent event={event} />
      </TestApp>
    );

    const nostrHashtag = screen.getByRole('link', { name: '#nostr' });
    const bitcoinHashtag = screen.getByRole('link', { name: '#bitcoin' });
    
    expect(nostrHashtag).toBeInTheDocument();
    expect(bitcoinHashtag).toBeInTheDocument();
    expect(nostrHashtag).toHaveAttribute('href', '/t/nostr');
    expect(bitcoinHashtag).toHaveAttribute('href', '/t/bitcoin');
  });

  it('renders an image URL as an inline lazy <img>', () => {
    const { container } = render(
      <TestApp>
        <NoteContent event={noteWith('look https://host.example/pic.png')} />
      </TestApp>
    );
    const img = container.querySelector('img');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', 'https://host.example/pic.png');
    expect(img).toHaveAttribute('loading', 'lazy');
  });

  it('renders a Blossom .mp4 as an inline <video preload="none">, not a link', () => {
    const { container } = render(
      <TestApp>
        <NoteContent event={noteWith('clip https://blossom.primal.net/abc123.mp4')} />
      </TestApp>
    );
    const video = container.querySelector('video');
    expect(video).toBeInTheDocument();
    expect(video).toHaveAttribute('preload', 'none');
    expect(video).toHaveAttribute('src', 'https://blossom.primal.net/abc123.mp4');
    expect(screen.queryByRole('link', { name: /blossom/ })).not.toBeInTheDocument();
  });

  it('renders an audio URL as an inline <audio> player', () => {
    const { container } = render(
      <TestApp>
        <NoteContent event={noteWith('https://host.example/song.mp3')} />
      </TestApp>
    );
    const audio = container.querySelector('audio');
    expect(audio).toBeInTheDocument();
    expect(audio).toHaveAttribute('preload', 'none');
  });

  it('keeps a normal (non-media) webpage link as a link', () => {
    render(
      <TestApp>
        <NoteContent event={noteWith('read https://example.com/article')} />
      </TestApp>
    );
    expect(
      screen.getByRole('link', { name: 'https://example.com/article' })
    ).toBeInTheDocument();
    expect(document.querySelector('img,video,audio')).not.toBeInTheDocument();
  });

  it('trims trailing punctuation off a media URL (src and surrounding text both clean)', () => {
    const { container } = render(
      <TestApp>
        <NoteContent event={noteWith('see https://host.example/pic.png.')} />
      </TestApp>
    );
    expect(container.querySelector('img')).toHaveAttribute('src', 'https://host.example/pic.png');
    expect(container.textContent).toContain('.'); // the trailing period is re-emitted as text
  });

  it('falls back to a link when media fails to load', () => {
    const { container } = render(
      <TestApp>
        <NoteContent event={noteWith('https://host.example/broken.png')} />
      </TestApp>
    );
    fireEvent.error(container.querySelector('img')!);
    expect(
      screen.getByRole('link', { name: 'https://host.example/broken.png' })
    ).toBeInTheDocument();
    expect(container.querySelector('img')).not.toBeInTheDocument();
  });

  it('renders a note reference (nevent) as an embedded card, not a raw link, at depth 0', () => {
    render(
      <TestApp>
        <NoteContent event={noteWith(`quote nostr:${NEVENT}`)} />
      </TestApp>
    );
    // The raw ref text must not appear as a plain link — it's an embedded card.
    expect(screen.queryByText(`nostr:${NEVENT}`)).not.toBeInTheDocument();
  });

  it('depth-1 guard: a nostr ref inside an embedded note renders as a plain link, not a card', () => {
    render(
      <TestApp>
        <NoteContent event={noteWith(`inner nostr:${NEVENT}`)} depth={1} />
      </TestApp>
    );
    const link = screen.getByRole('link', { name: `nostr:${NEVENT}` });
    expect(link).toHaveAttribute('href', `/${NEVENT}`);
  });

  it('depth-1 guard also applies to naddr refs (now matched by the parser)', () => {
    render(
      <TestApp>
        <NoteContent event={noteWith(`inner nostr:${NADDR}`)} depth={1} />
      </TestApp>
    );
    expect(screen.getByRole('link', { name: `nostr:${NADDR}` })).toHaveAttribute(
      'href',
      `/${NADDR}`
    );
  });

  it('renders an nprofile reference as a profile chip (not a plain ref link)', () => {
    render(
      <TestApp>
        <NoteContent event={noteWith(`hi nostr:${NPROFILE}`)} />
      </TestApp>
    );
    const chip = screen.getByRole('link');
    expect(chip.textContent?.startsWith('@')).toBe(true); // mention chip, not raw ref
    expect(chip.getAttribute('href')).toContain('/npub1');
  });

  it('generates deterministic names for users without metadata and styles them differently', () => {
    // Use a valid npub for testing
    const event: NostrEvent = {
      id: 'test-id',
      pubkey: 'test-pubkey',
      created_at: Math.floor(Date.now() / 1000),
      kind: 1,
      tags: [],
      content: `Mentioning nostr:npub1zg69v7ys40x77y352eufp27daufrg4ncjz4ummcjx3t83y9tehhsqepuh0`,
      sig: 'test-sig',
    };

    render(
      <TestApp>
        <NoteContent event={event} />
      </TestApp>
    );

    // The mention should be rendered with a deterministic name
    const mention = screen.getByRole('link');
    expect(mention).toBeInTheDocument();
    
    // Should have muted styling for generated names (gray instead of blue)
    expect(mention).toHaveClass('text-gray-500');
    expect(mention).not.toHaveClass('text-blue-500');
    
    // The text should start with @ and contain a generated name (not a truncated npub)
    const linkText = mention.textContent;
    expect(linkText).not.toMatch(/^@npub1/); // Should not be a truncated npub
    expect(linkText).toEqual("@Swift Falcon");
  });
});