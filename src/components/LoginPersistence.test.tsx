import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import type { NLoginType } from '@nostrify/react/login';

const addLogin = vi.fn();
let logins: NLoginType[] = [];

vi.mock('@nostrify/react/login', () => ({
  useNostrLogin: () => ({ logins, addLogin }),
}));

import { LoginPersistence, LOGIN_BACKUP_KEY } from './LoginPersistence';

const PRIMARY_KEY = 'nostr:login';

const LOGIN = {
  id: 'login-1',
  type: 'extension',
  pubkey: 'pk-self',
  createdAt: '2026-01-01T00:00:00Z',
} as unknown as NLoginType;

describe('LoginPersistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    logins = [];
    localStorage.removeItem(PRIMARY_KEY);
    localStorage.removeItem(LOGIN_BACKUP_KEY);
  });

  it('restores logins from the backup on boot when the primary key was lost', () => {
    localStorage.setItem(LOGIN_BACKUP_KEY, JSON.stringify([LOGIN]));

    render(<LoginPersistence />);

    expect(addLogin).toHaveBeenCalledTimes(1);
    expect(addLogin).toHaveBeenCalledWith(expect.objectContaining({ id: 'login-1' }));
    // The backup must survive the restore window (state hasn't updated yet).
    expect(localStorage.getItem(LOGIN_BACKUP_KEY)).not.toBeNull();
  });

  it('does nothing on boot for a logged-out user with no backup', () => {
    render(<LoginPersistence />);

    expect(addLogin).not.toHaveBeenCalled();
    expect(localStorage.getItem(LOGIN_BACKUP_KEY)).toBeNull();
  });

  it('mirrors active logins into the backup key', () => {
    logins = [LOGIN];

    render(<LoginPersistence />);

    expect(JSON.parse(localStorage.getItem(LOGIN_BACKUP_KEY)!)).toEqual([
      expect.objectContaining({ id: 'login-1' }),
    ]);
    expect(addLogin).not.toHaveBeenCalled();
  });

  it('clears the backup when the user logs out in-app', () => {
    logins = [LOGIN];
    const { rerender } = render(<LoginPersistence />);
    expect(localStorage.getItem(LOGIN_BACKUP_KEY)).not.toBeNull();

    // In-app logout flows through React state: logins become empty.
    logins = [];
    rerender(<LoginPersistence />);

    expect(localStorage.getItem(LOGIN_BACKUP_KEY)).toBeNull();
  });

  it('heals a wiped primary key when the tab becomes visible again', () => {
    logins = [LOGIN];
    render(<LoginPersistence />);

    // Another app on the shared origin (or eviction) wiped the login key
    // while this tab held a live session.
    localStorage.removeItem(PRIMARY_KEY);

    document.dispatchEvent(new Event('visibilitychange'));

    expect(JSON.parse(localStorage.getItem(PRIMARY_KEY)!)).toEqual([
      expect.objectContaining({ id: 'login-1' }),
    ]);
  });

  it('adopts a login made in another tab when this stale tab resumes', () => {
    logins = [];
    render(<LoginPersistence />);
    expect(addLogin).not.toHaveBeenCalled();

    localStorage.setItem(PRIMARY_KEY, JSON.stringify([LOGIN]));
    window.dispatchEvent(new Event('pageshow'));

    expect(addLogin).toHaveBeenCalledWith(expect.objectContaining({ id: 'login-1' }));
  });

  it('ignores corrupt backup data', () => {
    localStorage.setItem(LOGIN_BACKUP_KEY, 'not json{');

    render(<LoginPersistence />);

    expect(addLogin).not.toHaveBeenCalled();
  });
});
