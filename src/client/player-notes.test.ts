/**
 * Tests for the player notes module: ordering, the seen-ids bookkeeping behind the
 * "What's New" popup, and the shape guard on the committed player-notes.json — the check
 * that commit text never enters the player feed.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  PLAYER_NOTES,
  SEEN_NOTES_KEY,
  markAllNotesSeen,
  sortPlayerNotes,
  takeUnseenNotes,
  type PlayerNote,
} from './player-notes';

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

const FIXTURE: PlayerNote[] = [
  { id: 10, date: '2026-10-01', type: 'fixed', text: 'Older fix.' },
  { id: 12, date: '2026-10-02', type: 'added', text: 'Newer, lower id.' },
  { id: 15, date: '2026-10-02', type: 'changed', text: 'Newer, higher id.' },
  { id: 20, date: '2026-09-30', type: 'added', text: 'Oldest.' },
];
const FIXTURE_IDS = FIXTURE.map((n) => n.id).sort((a, b) => a - b);

function storedIds(): number[] {
  return (JSON.parse(store.get(SEEN_NOTES_KEY) ?? 'null') as number[]).slice().sort((a, b) => a - b);
}

describe('sortPlayerNotes', () => {
  it('puts the newer date first, and on the same date the higher id first', () => {
    expect(sortPlayerNotes(FIXTURE).map((n) => n.id)).toEqual([15, 12, 10, 20]);
  });

  it('does not mutate its input', () => {
    const before = FIXTURE.map((n) => n.id);
    sortPlayerNotes(FIXTURE);
    expect(FIXTURE.map((n) => n.id)).toEqual(before);
  });
});

describe('PLAYER_NOTES', () => {
  it('is the committed file, sorted', () => {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, 'player-notes.json'), 'utf8')) as PlayerNote[];
    expect(PLAYER_NOTES).toEqual(sortPlayerNotes(raw));
  });

  it('takeUnseenNotes() with no argument works on the real list', () => {
    store.set(SEEN_NOTES_KEY, '[]');
    expect(takeUnseenNotes()).toEqual([...PLAYER_NOTES]);
  });
});

describe('takeUnseenNotes', () => {
  it('key absent: returns [] and stores every id', () => {
    expect(takeUnseenNotes(FIXTURE)).toEqual([]);
    expect(storedIds()).toEqual(FIXTURE_IDS);
  });

  it('key holding every id: returns []', () => {
    store.set(SEEN_NOTES_KEY, JSON.stringify(FIXTURE_IDS));
    expect(takeUnseenNotes(FIXTURE)).toEqual([]);
  });

  it('key missing one id: returns exactly that note', () => {
    store.set(SEEN_NOTES_KEY, JSON.stringify([10, 15, 20]));
    expect(takeUnseenNotes(FIXTURE)).toEqual([FIXTURE[1]]);
  });

  it('does not mark anything seen when the key is present', () => {
    store.set(SEEN_NOTES_KEY, JSON.stringify([10]));
    takeUnseenNotes(FIXTURE);
    expect(store.get(SEEN_NOTES_KEY)).toBe('[10]');
  });

  it.each(['not json', '{}'])('unparseable key %p: returns [] and stores every id', (value) => {
    store.set(SEEN_NOTES_KEY, value);
    expect(takeUnseenNotes(FIXTURE)).toEqual([]);
    expect(storedIds()).toEqual(FIXTURE_IDS);
  });

  it('storage throwing on read: returns [] without throwing', () => {
    installStorage({ getItem: () => { throw new Error('denied'); } });
    expect(() => takeUnseenNotes(FIXTURE)).not.toThrow();
    expect(takeUnseenNotes(FIXTURE)).toEqual([]);
  });

  it('storage throwing on write: returns [] without throwing', () => {
    installStorage({ setItem: () => { throw new Error('full'); } });
    expect(() => takeUnseenNotes(FIXTURE)).not.toThrow();
    expect(takeUnseenNotes(FIXTURE)).toEqual([]);
  });

  it('no localStorage at all: returns []', () => {
    delete (globalThis as unknown as { localStorage?: unknown }).localStorage;
    expect(takeUnseenNotes(FIXTURE)).toEqual([]);
  });

  it('empty note list: returns []', () => {
    store.set(SEEN_NOTES_KEY, '[1]');
    expect(takeUnseenNotes([])).toEqual([]);
  });
});

describe('markAllNotesSeen', () => {
  it('stores every current id', () => {
    markAllNotesSeen(FIXTURE);
    expect(storedIds()).toEqual(FIXTURE_IDS);
  });

  it('does not throw when storage refuses the write', () => {
    installStorage({ setItem: () => { throw new Error('full'); } });
    expect(() => markAllNotesSeen(FIXTURE)).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// The shape of the committed file
// ---------------------------------------------------------------------------

const COMMIT_PREFIX = /^\w+(\([^)]*\))?!?:\s/;
const TYPES = new Set(['added', 'fixed', 'changed']);

function shapeErrors(entries: unknown): string[] {
  if (!Array.isArray(entries)) return ['not an array'];
  const errors: string[] = [];
  const ids = new Set<number>();
  entries.forEach((entry: unknown, i) => {
    const e = (entry ?? {}) as Record<string, unknown>;
    const { id, date, type, text } = e;
    if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) errors.push(`#${i}: id`);
    else if (ids.has(id)) errors.push(`#${i}: duplicate id ${id}`);
    else ids.add(id);
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push(`#${i}: date format`);
    else {
      const d = new Date(`${date}T00:00:00Z`);
      if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== date) errors.push(`#${i}: date not real`);
    }
    if (typeof type !== 'string' || !TYPES.has(type)) errors.push(`#${i}: type`);
    if (typeof text !== 'string' || text.trim() === '') errors.push(`#${i}: text empty`);
    else {
      if (text.length > 200) errors.push(`#${i}: text too long`);
      if (COMMIT_PREFIX.test(text)) errors.push(`#${i}: text is a commit subject`);
    }
  });
  return errors;
}

describe('player-notes.json shape', () => {
  const good = { id: 1071, date: '2026-10-02', type: 'fixed', text: 'Your mailbox now updates as soon as you delete a message.' };

  it('the committed file is well formed', () => {
    const real: unknown = JSON.parse(fs.readFileSync(path.join(__dirname, 'player-notes.json'), 'utf8'));
    expect(shapeErrors(real)).toEqual([]);
  });

  it('accepts a well-formed entry', () => {
    expect(shapeErrors([good])).toEqual([]);
  });

  it.each([
    ['not an array', {}],
    ['id 0', [{ ...good, id: 0 }]],
    ['id 1.5', [{ ...good, id: 1.5 }]],
    ['duplicate id', [good, { ...good }]],
    ['impossible date', [{ ...good, date: '2026-13-40' }]],
    ['slashed date', [{ ...good, date: '2026/10/02' }]],
    ['unknown type', [{ ...good, type: 'removed' }]],
    ['empty text', [{ ...good, text: '' }]],
    ['201-char text', [{ ...good, text: 'a'.repeat(201) }]],
    ['scoped commit subject', [{ ...good, text: 'fix(client): foo' }]],
    ['bare commit subject', [{ ...good, text: 'feat: bar' }]],
  ])('rejects %s', (_label, entries) => {
    expect(shapeErrors(entries).length).toBeGreaterThan(0);
  });
});
