import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WorldLock, WorldDirtyError } from './world-lock';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'spo-e2e-lock-'));
}

const restore = {
  key: 'RDOSetTaxValue:a',
  what: 'Helartia tax row 0',
  x: 10,
  y: 20,
  propertyName: 'RDOSetTaxValue',
  originalValue: '7',
};

describe('WorldLock — single flight', () => {
  it('acquires a lock when none is held', () => {
    const lock = new WorldLock(tempDir());
    lock.acquire('fix/thing', 111, () => false);
    expect(lock.read().holder?.branch).toBe('fix/thing');
  });

  it('refuses when another live process holds it', () => {
    const dir = tempDir();
    new WorldLock(dir).acquire('fix/a', 111, () => true);
    expect(() => new WorldLock(dir).acquire('fix/b', 222, () => true)).toThrow(/single-flight/);
  });

  it('takes over from a holder whose process is gone', () => {
    const dir = tempDir();
    new WorldLock(dir).acquire('fix/a', 111, () => true);
    const second = new WorldLock(dir);
    second.acquire('fix/b', 222, () => false);
    expect(second.read().holder?.branch).toBe('fix/b');
  });

  it('starts a genuinely clean acquire with an empty pending-restore list', () => {
    const dir = tempDir();
    const lock = new WorldLock(dir);
    lock.acquire('fix/a', 111, () => false);
    lock.addPendingRestore(restore);
    lock.clearPendingRestore(restore.key);
    lock.release();
    lock.acquire('fix/a', 111, () => false);
    expect(lock.read().pendingRestores).toEqual([]);
  });

  // This test used to be named "starts each run with an empty pending-restore list" and
  // called acquire() a second time straight over a pending restore, asserting the list was
  // wiped to []. That pinned exactly the defect B5.5 fixes: acquire() taking over a holder —
  // dead, or in this case the same pid calling it again — silently dropped whatever writes
  // were still owed, and never marked the world dirty. A crash never reaches release(), so
  // the pendingRestores left on disk are the only record that Helartia was left mutated;
  // erasing them here made that state permanently un-restorable. The correct behaviour is
  // the opposite of what was pinned: a takeover that finds unrestored writes must refuse and
  // mark the world dirty, not proceed with a clean slate.
  it('refuses to take over and marks the world dirty instead of dropping a pending restore', () => {
    const dir = tempDir();
    const lock = new WorldLock(dir);
    lock.acquire('fix/a', 111, () => false);
    lock.addPendingRestore(restore);
    expect(() => lock.acquire('fix/a', 111, () => false)).toThrow(WorldDirtyError);
    const state = lock.read();
    expect(state.dirty).toBe(true);
    expect(state.pendingRestores).toEqual([restore]);
    expect(state.holder).toBeNull();
  });
});

describe('WorldLock — world dirty', () => {
  it('marks the world dirty when a run ends with an unrestored write', () => {
    const lock = new WorldLock(tempDir());
    lock.acquire('fix/a', 111, () => false);
    lock.addPendingRestore(restore);
    expect(() => lock.release('crashed mid-probe')).toThrow(WorldDirtyError);
    expect(lock.read().dirty).toBe(true);
    expect(lock.read().dirtyReason).toBe('crashed mid-probe');
  });

  it('blocks every later run until a human clears it', () => {
    const dir = tempDir();
    const first = new WorldLock(dir);
    first.acquire('fix/a', 111, () => false);
    first.addPendingRestore(restore);
    expect(() => first.release()).toThrow(WorldDirtyError);

    expect(() => new WorldLock(dir).acquire('fix/b', 222, () => false)).toThrow(WorldDirtyError);
  });

  it('names the pending values in the refusal so they can be put back', () => {
    const lock = new WorldLock(tempDir());
    lock.acquire('fix/a', 111, () => false);
    lock.addPendingRestore(restore);
    expect(() => lock.release()).toThrow(/1 value\(s\) need a human restore/);
  });

  it('releases cleanly once the write has been restored', () => {
    const lock = new WorldLock(tempDir());
    lock.acquire('fix/a', 111, () => false);
    lock.addPendingRestore(restore);
    lock.clearPendingRestore(restore.key);
    expect(() => lock.release()).not.toThrow();
    expect(lock.read().dirty).toBe(false);
    expect(lock.read().holder).toBeNull();
  });

  it('only clears the matching restore, not every pending one', () => {
    const lock = new WorldLock(tempDir());
    lock.acquire('fix/a', 111, () => false);
    lock.addPendingRestore(restore);
    // Same facility and property: only the key tells the two round trips apart.
    lock.addPendingRestore({ ...restore, key: 'RDOSetTaxValue:b', what: 'other' });
    lock.clearPendingRestore(restore.key);
    expect(lock.read().pendingRestores).toHaveLength(1);
    expect(lock.read().pendingRestores[0].key).toBe('RDOSetTaxValue:b');
  });

  it('forceUnlock returns what was pending so a human can check it', () => {
    const lock = new WorldLock(tempDir());
    lock.acquire('fix/a', 111, () => false);
    lock.addPendingRestore(restore);
    expect(() => lock.release()).toThrow();
    const previous = lock.forceUnlock();
    expect(previous.dirty).toBe(true);
    expect(previous.pendingRestores[0].originalValue).toBe('7');
    expect(lock.read().dirty).toBe(false);
  });

  it('treats a missing or corrupt lock file as no lock', () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'world-lock.json'), 'not json', 'utf8');
    expect(new WorldLock(dir).read().dirty).toBe(false);
  });

  // Every dirty lock this module writes also carries the pendingRestores that caused it, so
  // the pendingRestores check inside acquire() alone happens to catch a dirty world too. This
  // test writes the lock file directly so it does not rely on that coincidence: it pins that
  // the `dirty` flag itself — not just a non-empty pendingRestores list — is load-bearing.
  // Without it, deleting the `if (lock.dirty) throw` guard at the top of acquire() would pass
  // every other test in this file while still leaving a dirty world open to a silent takeover.
  it('keeps refusing on the dirty flag alone, even with no pending restores left to notice', () => {
    const dir = tempDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'world-lock.json'),
      JSON.stringify({
        holder: null,
        pendingRestores: [],
        dirty: true,
        dirtySince: '2026-09-01T00:00:00.000Z',
        dirtyReason: 'restored by hand, flag never cleared',
      }),
      'utf8',
    );
    expect(() => new WorldLock(dir).acquire('fix/z', 999, () => false)).toThrow(WorldDirtyError);
  });

  it('marks the world dirty on takeover from a dead holder that never released, instead of dropping its restores', () => {
    const dir = tempDir();
    const first = new WorldLock(dir);
    first.acquire('fix/a', 111, () => false);
    first.addPendingRestore(restore);
    // The process is killed here — no release() runs, so no dirty marking happens yet.
    // The next acquire(), by a different pid, is the only place left to notice.
    const second = new WorldLock(dir);
    expect(() => second.acquire('fix/b', 222, () => false)).toThrow(WorldDirtyError);

    const state = second.read();
    expect(state.dirty).toBe(true);
    expect(state.pendingRestores).toEqual([restore]);
    expect(state.holder).toBeNull();
    expect(state.dirtyReason).toMatch(/pid 111/);

    // And a third run is blocked too — the dirty flag, not aliveness, is what gates it now.
    expect(() => new WorldLock(dir).acquire('fix/c', 333, () => false)).toThrow(WorldDirtyError);
  });

  it('loads a lock written in the old PendingRestore shape and reports it dirty', () => {
    const dir = tempDir();
    const legacy = {
      what: 'Helartia tax row 0',
      x: 10,
      y: 20,
      propertyName: 'RDOSetTaxValue',
      originalValue: '7',
    };
    fs.writeFileSync(
      path.join(dir, 'world-lock.json'),
      JSON.stringify({ holder: null, pendingRestores: [legacy], dirty: true, dirtyReason: 'old run' }),
      'utf8',
    );
    const lock = new WorldLock(dir);
    expect(() => lock.acquire('fix/z', 999, () => false)).toThrow(WorldDirtyError);
    expect(lock.read().pendingRestores[0]).toEqual(legacy);
    // A keyless entry is never cleared by a key — only a human clears it.
    lock.clearPendingRestore('RDOSetTaxValue:a');
    expect(lock.read().pendingRestores).toHaveLength(1);
  });

  it('round-trips a base64 originalValue', () => {
    const lock = new WorldLock(tempDir());
    const bytes = Buffer.from([0, 255, 137, 80]);
    lock.addPendingRestore({ key: 'portrait:1', what: 'SPO_test3 portrait', originalValue: bytes.toString('base64') });
    const stored = lock.read().pendingRestores[0];
    expect(stored.key).toBe('portrait:1');
    expect(Buffer.from(stored.originalValue, 'base64')).toEqual(bytes);
  });
});
