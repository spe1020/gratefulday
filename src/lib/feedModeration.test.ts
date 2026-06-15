import { describe, it, expect, beforeEach } from 'vitest';
import {
  getHiddenNoteIds,
  getMutedPubkeys,
  hideNote,
  mutePubkey,
  unmutePubkey,
} from './feedModeration';

const HIDDEN_KEY = 'gratefulday:hidden-notes:v1';
const MUTED_KEY = 'gratefulday:muted-pubkeys:v1';

describe('feedModeration store', () => {
  beforeEach(() => {
    localStorage.removeItem(HIDDEN_KEY);
    localStorage.removeItem(MUTED_KEY);
  });

  it('starts empty', () => {
    expect(getHiddenNoteIds().size).toBe(0);
    expect(getMutedPubkeys().size).toBe(0);
  });

  it('hides notes and dedups repeats', () => {
    hideNote('a');
    hideNote('a');
    hideNote('b');
    expect([...getHiddenNoteIds()].sort()).toEqual(['a', 'b']);
  });

  it('mutes and unmutes authors', () => {
    mutePubkey('troll');
    expect(getMutedPubkeys().has('troll')).toBe(true);
    unmutePubkey('troll');
    expect(getMutedPubkeys().has('troll')).toBe(false);
  });

  it('keeps hidden notes and muted authors in separate keys', () => {
    hideNote('note1');
    mutePubkey('pk1');
    expect(getHiddenNoteIds().has('pk1')).toBe(false);
    expect(getMutedPubkeys().has('note1')).toBe(false);
  });

  it('degrades corrupt storage to empty', () => {
    localStorage.setItem(HIDDEN_KEY, 'not json');
    localStorage.setItem(MUTED_KEY, '{"not":"an array"}');
    expect(getHiddenNoteIds().size).toBe(0);
    expect(getMutedPubkeys().size).toBe(0);
  });
});
