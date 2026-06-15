import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TestApp } from '@/test/TestApp';
import { TaggedNoteCard } from './TaggedNoteCard';
import type { NostrEvent } from '@nostrify/nostrify';

// Valid 32-byte hex so nip19.neventEncode succeeds and the link branch renders
// (placeholder strings like "note-id" would throw and silently fall back to
// plain text, leaving the link untested).
const NOTE_ID = '1'.repeat(64);
const AUTHOR = '2'.repeat(64);
const ROOT_ID = 'a'.repeat(64);
const ROOT_AUTHOR = 'b'.repeat(64);

function note(tags: string[][]): NostrEvent {
  return {
    id: NOTE_ID,
    pubkey: AUTHOR,
    created_at: 1000,
    kind: 1,
    tags,
    content: 'grateful in conversation',
    sig: 'sig',
  };
}

describe('TaggedNoteCard — replying-to affordance', () => {
  it('renders a clickable "replying to" link to the root nevent when the note is a reply', () => {
    render(
      <TestApp>
        <TaggedNoteCard
          event={note([['t', 'grateful'], ['e', ROOT_ID, '', 'root', ROOT_AUTHOR]])}
        />
      </TestApp>
    );
    const link = screen.getByRole('link', { name: /replying to/i });
    expect(link).toBeInTheDocument();
    expect(link.getAttribute('href')).toMatch(/^\/nevent1/);
  });

  it('shows no "replying to" affordance for a top-level (root) note', () => {
    render(
      <TestApp>
        <TaggedNoteCard event={note([['t', 'grateful']])} />
      </TestApp>
    );
    expect(screen.queryByText(/replying to/i)).not.toBeInTheDocument();
  });
});
