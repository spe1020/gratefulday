import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TestApp } from '@/test/TestApp';
import { TaggedNoteCard } from './TaggedNoteCard';
import type { NostrEvent } from '@nostrify/nostrify';

function note(tags: string[][]): NostrEvent {
  return {
    id: 'note-id',
    pubkey: 'author',
    created_at: 1000,
    kind: 1,
    tags,
    content: 'grateful in conversation',
    sig: 'sig',
  };
}

describe('TaggedNoteCard — replying-to affordance', () => {
  it('shows "replying to" when the note is a reply (has a thread root)', () => {
    render(
      <TestApp>
        <TaggedNoteCard event={note([['t', 'grateful'], ['e', 'the-root', '', 'root', 'root-author']])} />
      </TestApp>
    );
    expect(screen.getByText(/replying to/i)).toBeInTheDocument();
  });

  it('shows no "replying to" for a top-level (root) note', () => {
    render(
      <TestApp>
        <TaggedNoteCard event={note([['t', 'grateful']])} />
      </TestApp>
    );
    expect(screen.queryByText(/replying to/i)).not.toBeInTheDocument();
  });
});
