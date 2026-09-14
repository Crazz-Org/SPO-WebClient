/**
 * Tests for the "explain the backup once" flag.
 *
 * First call is false (never explained), a second call is true, per-username isolation
 * holds, an empty username falls back to a fixed key, and a throwing localStorage degrades
 * to "not seen" rather than throwing.
 */

import { hasSeenBackupNotice, markBackupNoticeSeen, backupNoticeKey, BACKUP_NOTICE_KEY_PREFIX } from './backup-notice';

const store = new Map<string, string>();

function installStorage(impl?: Partial<Storage>) {
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    ...impl,
  };
}

beforeEach(() => {
  store.clear();
  installStorage();
});
afterEach(() => { delete (globalThis as unknown as { localStorage?: unknown }).localStorage; });

describe('backupNoticeKey', () => {
  it('is one key per account, with a placeholder for an empty username', () => {
    expect(backupNoticeKey('SPO_test3')).toBe(`${BACKUP_NOTICE_KEY_PREFIX}SPO_test3`);
    expect(backupNoticeKey('')).toBe(`${BACKUP_NOTICE_KEY_PREFIX}player`);
  });
});

describe('hasSeenBackupNotice / markBackupNoticeSeen', () => {
  it('is false before the mark, true after', () => {
    expect(hasSeenBackupNotice('SPO_test3')).toBe(false);
    markBackupNoticeSeen('SPO_test3');
    expect(hasSeenBackupNotice('SPO_test3')).toBe(true);
  });

  it('is isolated per account', () => {
    markBackupNoticeSeen('SPO_test3');
    expect(hasSeenBackupNotice('Crazz')).toBe(false);
  });

  it('a throwing localStorage returns false without throwing', () => {
    installStorage({ getItem: () => { throw new Error('nope'); } });
    expect(hasSeenBackupNotice('SPO_test3')).toBe(false);

    installStorage({ setItem: () => { throw new Error('nope'); } });
    expect(() => markBackupNoticeSeen('SPO_test3')).not.toThrow();
  });
});
