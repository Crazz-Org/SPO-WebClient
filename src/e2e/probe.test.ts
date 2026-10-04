import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WsMessageType } from '@/shared/types/message-types';
import type { WsMessage } from '@/shared/types/message-types';
import { WsDriver } from './ws-driver';
import { runProbe, runRoundTrip, probeFailure, type ProbeSpec, type RoundTripSpec } from './probe';
import { WorldLock } from './world-lock';
import type { LiveSession } from './session';
import { PRIMARY_ACCOUNT } from './config';
import * as liveLog from './live-log';

const spec: ProbeSpec = {
  what: 'Helartia tax row 0',
  member: 'RDOSetTaxValue',
  x: 100,
  y: 200,
  visualClass: '512',
  groupId: 'townTaxes',
  readProperty: 'Tax0Percent',
  writeProperty: 'RDOSetTaxValue',
  additionalParams: { index: '0' },
  testValue: () => '8',
};

const window = { url: 'http://logs/S.log', offset: 0, openedAt: 'now' };
const factory = async () => window;

/**
 * A session whose reads return `values.shift()` while any remain, then the world's state —
 * the last value written — and whose writes are recorded. An explicit `undefined` in
 * `values` still reads as absent.
 */
function sessionReading(values: (string | undefined)[], onWrite?: (value: string) => void): LiveSession {
  let lastWritten: string | undefined;
  const driver = {
    close: jest.fn(),
    log: [],
    errors: [],
    send: jest.fn(),
    seen: jest.fn(() => []),
    request: jest.fn(async (msg: WsMessage) => {
      // The opening read carries the header group and never the tax table —
      // the probe reads that through the section request below, the way the
      // panel does once a menu entry is opened.
      if (msg.type === WsMessageType.REQ_BUILDING_DETAILS) {
        return {
          type: WsMessageType.RESP_BUILDING_DETAILS,
          details: { groups: { townGeneral: [] } },
        };
      }
      if (msg.type === WsMessageType.REQ_BUILDING_TAB_DATA) {
        const value = values.length > 0 ? values.shift() : lastWritten;
        return {
          type: WsMessageType.RESP_BUILDING_TAB_DATA,
          groups: value === undefined ? {} : { townTaxes: [{ name: 'Tax0Percent', value }] },
        };
      }
      lastWritten = (msg as unknown as { value: string }).value;
      onWrite?.(lastWritten);
      return { type: WsMessageType.RESP_BUILDING_SET_PROPERTY, success: true, newValue: '' };
    }),
  };
  return {
    driver: driver as unknown as WsDriver,
    account: PRIMARY_ACCOUNT,
    company: { id: '1', name: 'SPO_test3 - Green' },
    worlds: 1,
    companies: [],
    playerX: 0,
    playerY: 0,
  };
}

function tempLock(): WorldLock {
  return new WorldLock(fs.mkdtempSync(path.join(os.tmpdir(), 'spo-probe-')));
}

afterEach(() => jest.restoreAllMocks());

describe('runProbe', () => {
  it('passes when the log proves the write and the value is restored', async () => {
    jest.spyOn(liveLog, 'awaitMarker').mockResolvedValue('Setting Tax value: 8');
    const writes: string[] = [];
    const session = sessionReading(['7', '8'], v => writes.push(v));
    const lock = tempLock();

    const result = await runProbe(session, spec, lock, factory, window.url);

    expect(result.status).toBe('PASS');
    expect(result.original).toBe('7');
    expect(result.written).toBe('8');
    expect(result.readBack).toBe('CONFIRMED');
    expect(result.restored).toBe(true);
    expect(writes).toEqual(['8', '7']);
    expect(lock.read().pendingRestores).toEqual([]);
  });

  it('fails when no log line appears — the write never reached the object', async () => {
    jest.spyOn(liveLog, 'awaitMarker').mockResolvedValue(null);
    const result = await runProbe(sessionReading(['7', '8']), spec, tempLock(), factory, window.url);
    expect(result.status).toBe('FAIL');
    expect(result.note).toMatch(/never reached the object/);
  });

  it('still restores after a failed assertion', async () => {
    jest.spyOn(liveLog, 'awaitMarker').mockResolvedValue(null);
    const writes: string[] = [];
    const session = sessionReading(['7', '8'], v => writes.push(v));
    await runProbe(session, spec, tempLock(), factory, window.url);
    expect(writes).toEqual(['8', '7']);
  });

  it('fails when a lagging read-back outlasts its bound, even with the log line present', async () => {
    jest.spyOn(liveLog, 'awaitMarker').mockResolvedValue('Setting Tax value: 8');
    const result = await runProbe(sessionReading(['7', '7', '7']), spec, tempLock(), factory, window.url, {
      readBackBoundMs: 50,
      now: clock([0, 0, 100]),
      sleep: noSleep,
    });
    expect(result.status).toBe('FAIL');
    expect(result.readBack).toBe('UNCONFIRMED');
    expect(result.note).toMatch(/read-back never showed/);
    expect(result.restored).toBe(true);
  });

  it('waits out a lagging read-back that reaches the value on a later poll', async () => {
    jest.spyOn(liveLog, 'awaitMarker').mockResolvedValue('Setting Tax value: 8');
    const result = await runProbe(sessionReading(['7', '7', '7', '8']), spec, tempLock(), factory, window.url, {
      readBackBoundMs: 1_000,
      now: clock([0]),
      sleep: noSleep,
    });
    expect(result.status).toBe('PASS');
    expect(result.readBack).toBe('CONFIRMED');
    expect(result.restoreReadBack).toBe('CONFIRMED');
    expect(result.note).toBeUndefined();
  });

  it('registers the pending restore before issuing the write', async () => {
    jest.spyOn(liveLog, 'awaitMarker').mockResolvedValue('Setting Tax value: 8');
    const lock = tempLock();
    const seen: number[] = [];
    const session = sessionReading(['7', '8'], () => seen.push(lock.read().pendingRestores.length));
    await runProbe(session, spec, lock, factory, window.url);
    expect(seen[0]).toBe(1);
  });

  // #1310: the fake records the restore value before it throws, so the restore read-back shows
  // the original — the world is unchanged, the pending restore is cleared, and the probe FAILs.
  it('a restore write that throws but whose read-back shows the original clears the pending restore and still FAILs', async () => {
    jest.spyOn(liveLog, 'awaitMarker').mockResolvedValue('Setting Tax value: 8');
    const lock = tempLock();
    let writes = 0;
    const session = sessionReading(['7', '8'], () => {
      writes += 1;
      if (writes === 2) throw new Error('restore rejected');
    });
    const result = await runProbe(session, spec, lock, factory, window.url);
    expect(result.status).toBe('FAIL');
    expect(result.restored).toBe(true);
    expect(result.note).toMatch(/restore write failed, but the read-back shows the original — the world is unchanged/);
    expect(lock.read().pendingRestores).toEqual([]);
  });

  it('refuses to write when the original value cannot be read', async () => {
    const lock = tempLock();
    await expect(runProbe(sessionReading([undefined]), spec, lock, factory, window.url)).rejects.toThrow(
      /nothing to restore to/,
    );
    expect(lock.read().pendingRestores).toEqual([]);
  });

  it('refuses a member with no known log marker — it could never be proven', async () => {
    const unproven = { ...spec, member: 'RDOSetSomethingNew' };
    await expect(runProbe(sessionReading(['7']), unproven, tempLock(), factory, window.url)).rejects.toThrow(
      /No model-server log marker/,
    );
  });

  it('reports a mid-probe throw as a failure and still restores', async () => {
    jest.spyOn(liveLog, 'awaitMarker').mockRejectedValue(new Error('log host vanished'));
    const writes: string[] = [];
    const result = await runProbe(
      sessionReading(['7', '8'], v => writes.push(v)),
      spec,
      tempLock(),
      factory,
      window.url,
    );
    expect(result.status).toBe('FAIL');
    expect(result.note).toBe('log host vanished');
    expect(result.restored).toBe(true);
    expect(writes).toEqual(['8', '7']);
  });

  it('restores a given original, never a value re-read now', async () => {
    jest.spyOn(liveLog, 'awaitMarker').mockResolvedValue('Setting Tax value: 8');
    const lock = tempLock();
    const writes: string[] = [];
    const pendingOriginals: (string | undefined)[] = [];
    const testValue = jest.fn(() => '8');
    // The live read would say '9'; the spec's original says '7'.
    const session = sessionReading(['9'], v => {
      writes.push(v);
      pendingOriginals.push(lock.read().pendingRestores[0]?.originalValue);
    });
    const result = await runProbe(session, { ...spec, testValue, original: '7' }, lock, factory, window.url, {
      now: clock([0]),
      sleep: noSleep,
    });
    expect(testValue).toHaveBeenCalledWith('7');
    expect(writes).toEqual(['8', '7']);
    expect(pendingOriginals[0]).toBe('7');
    expect(result.original).toBe('7');
    expect(result.status).toBe('PASS');
  });

  it('fails a log line that holds the marker but fails logMatch', async () => {
    jest.spyOn(liveLog, 'awaitMarker').mockResolvedValue('Setting Tax value: Elsewhere, 3, 8');
    const logMatch = (line: string, written: string): boolean =>
      line.includes(`Setting Tax value: Helartia, 3, ${written}`);
    const result = await runProbe(sessionReading(['7', '8']), { ...spec, logMatch }, tempLock(), factory, window.url);
    expect(result.status).toBe('FAIL');
    expect(result.note).toMatch(/no model-server log line/);
  });
});

/** A clock returning `values` in turn, then the last one forever. */
function clock(values: number[]): () => number {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)];
}

function noSleep(): Promise<void> {
  return Promise.resolve();
}

/** A world holding one value, with fake read / write over it. */
function world(initial: string | undefined) {
  const state = { value: initial, writes: [] as string[], restores: [] as string[] };
  const read = jest.fn(async () => state.value);
  const write = jest.fn(async (v: string) => {
    state.writes.push(v);
    state.value = v;
  });
  return { state, read, write };
}

function roundTrip(w: ReturnType<typeof world>, overrides: Partial<RoundTripSpec> = {}): RoundTripSpec {
  return {
    what: 'Helartia tax row 0',
    member: 'RDOSetTaxValue',
    read: w.read,
    write: w.write,
    testValue: () => '8',
    proof: {
      log: { marker: 'Setting Tax value:', match: (line, written) => line.includes(`Helartia, 0, ${written}`) },
      readBack: { source: 'fake', why: 'test', read: w.read, boundMs: 50, pollMs: 0 },
    },
    ...overrides,
  };
}

/** A fresh clock that moves 100 ms per reading, so a 50 ms bound runs out after one poll. */
function timed() {
  let t = -100;
  return { now: () => (t += 100), sleep: noSleep };
}

describe('runRoundTrip', () => {
  it('passes when the log line matches and both read-backs confirm', async () => {
    jest.spyOn(liveLog, 'awaitMarker').mockResolvedValue('Setting Tax value: Helartia, 0, 8');
    const w = world('7');
    const lock = tempLock();
    const result = await runRoundTrip(roundTrip(w), lock, factory, window.url);
    expect(result).toMatchObject({
      status: 'PASS',
      readBack: 'CONFIRMED',
      restoreReadBack: 'CONFIRMED',
      restored: true,
      logLine: 'Setting Tax value: Helartia, 0, 8',
    });
    expect(result.note).toBeUndefined();
    expect(w.state.writes).toEqual(['8', '7']);
    expect(lock.read().pendingRestores).toEqual([]);
  });

  it('restores after a write that throws', async () => {
    const w = world('7');
    const write = jest.fn(async (v: string) => {
      if (v === '8') throw new Error('write rejected');
      await w.write(v);
    });
    const lock = tempLock();
    const result = await runRoundTrip(roundTrip(w, { write }), lock, factory, window.url);
    expect(result.status).toBe('FAIL');
    expect(result.note).toBe('write rejected');
    expect(write).toHaveBeenLastCalledWith('7');
    expect(result.restored).toBe(true);
    expect(lock.read().pendingRestores).toEqual([]);
  });

  it('restores after a proof that fails', async () => {
    jest.spyOn(liveLog, 'awaitMarker').mockResolvedValue(null);
    const w = world('7');
    const lock = tempLock();
    const result = await runRoundTrip(roundTrip(w), lock, factory, window.url);
    expect(result.status).toBe('FAIL');
    expect(result.note).toMatch(/never reached the object/);
    expect(w.state.writes).toEqual(['8', '7']);
    expect(result.restored).toBe(true);
    expect(lock.read().pendingRestores).toEqual([]);
  });

  it('fails a log line that contains the prefix but fails match', async () => {
    jest.spyOn(liveLog, 'awaitMarker').mockResolvedValue('Setting Tax value: Elsewhere, 0, 8');
    const result = await runRoundTrip(roundTrip(world('7')), tempLock(), factory, window.url);
    expect(result.status).toBe('FAIL');
    expect(result.logLine).toBeNull();
    expect(result.note).toMatch(/never reached the object/);
  });

  it('hands awaitMarker a proof that requires both the marker and the match', async () => {
    const spy = jest.spyOn(liveLog, 'awaitMarker').mockResolvedValue('Setting Tax value: Helartia, 0, 8');
    await runRoundTrip(roundTrip(world('7')), tempLock(), factory, window.url);
    const proof = spy.mock.calls[0][1] as liveLog.LogProof;
    expect(proof.marker).toBe('Setting Tax value:');
    expect(proof.match?.('Setting Tax value: Helartia, 0, 8')).toBe(true);
    expect(proof.match?.('Setting Tax value: Elsewhere, 0, 8')).toBe(false);
    expect(proof.match?.('Setting Min Wage: Helartia, 0, 8')).toBe(false);
  });

  it('fails when the log line is present but the read-back never shows the written value within boundMs', async () => {
    jest.spyOn(liveLog, 'awaitMarker').mockResolvedValue('Setting Tax value: Helartia, 0, 8');
    const w = world('7');
    // The server logs the line, then refuses the write: the value never moves.
    const write = jest.fn(async () => undefined);
    const lock = tempLock();
    const result = await runRoundTrip(roundTrip(w, { write }), lock, factory, window.url, timed());
    expect(result.status).toBe('FAIL');
    expect(result.readBack).toBe('UNCONFIRMED');
    expect(result.logLine).toBe('Setting Tax value: Helartia, 0, 8');
    expect(result.note).toMatch(/read-back never showed "8" within 50 ms \(last "7", fake\)/);
    expect(result.restored).toBe(true);
  });

  it('passes when the read-back reaches the value on a later poll', async () => {
    jest.spyOn(liveLog, 'awaitMarker').mockResolvedValue('Setting Tax value: Helartia, 0, 8');
    const w = world('7');
    const lagging = ['7', '7'];
    const read = jest.fn(async () => (lagging.length > 0 && w.state.writes.length === 1 ? lagging.shift() : w.state.value));
    const sleep = jest.fn(noSleep);
    const spec = roundTrip(w);
    spec.proof.readBack = { ...spec.proof.readBack, read, boundMs: 1_000, pollMs: 7 };
    const result = await runRoundTrip(spec, tempLock(), factory, window.url, { now: clock([0]), sleep });
    expect(result.status).toBe('PASS');
    expect(result.readBack).toBe('CONFIRMED');
    expect(sleep).toHaveBeenCalledWith(7);
  });

  it('refuses a spec whose member has a marker but no log part, before any write', async () => {
    const w = world('7');
    const lock = tempLock();
    const spec = roundTrip(w);
    spec.proof = { readBack: spec.proof.readBack };
    await expect(runRoundTrip(spec, lock, factory, window.url)).rejects.toThrow(/no log part/);
    expect(w.write).not.toHaveBeenCalled();
    expect(w.read).not.toHaveBeenCalled();
    expect(lock.read().pendingRestores).toEqual([]);
  });

  it('refuses a log marker that differs from LOG_MARKERS, before any write', async () => {
    const w = world('7');
    const spec = roundTrip(w);
    spec.proof = { ...spec.proof, log: { marker: 'Setting' } };
    await expect(runRoundTrip(spec, tempLock(), factory, window.url)).rejects.toThrow(/cited marker/);
    expect(w.write).not.toHaveBeenCalled();
  });

  it('refuses to write when the original is unreadable', async () => {
    const w = world(undefined);
    const lock = tempLock();
    await expect(runRoundTrip(roundTrip(w), lock, factory, window.url)).rejects.toThrow(/nothing to restore to/);
    expect(w.write).not.toHaveBeenCalled();
    expect(lock.read().pendingRestores).toEqual([]);
  });

  it('accepts a member with no marker on read-back alone', async () => {
    const spy = jest.spyOn(liveLog, 'awaitMarker');
    const opened = jest.fn(factory);
    const w = world('7');
    const spec = roundTrip(w, { member: 'RDOPayOff' });
    spec.proof = { readBack: spec.proof.readBack };
    const result = await runRoundTrip(spec, tempLock(), opened, window.url);
    expect(result.status).toBe('PASS');
    expect(result.logLine).toBeNull();
    expect(spy).not.toHaveBeenCalled();
    expect(opened).not.toHaveBeenCalled();
  });

  it('records the pending restore before the write and clears it only after the restore read-back matched', async () => {
    jest.spyOn(liveLog, 'awaitMarker').mockResolvedValue('Setting Tax value: Helartia, 0, 8');
    const w = world('7');
    const lock = tempLock();
    const seen: { key?: string; what: string }[][] = [];
    const write = jest.fn(async (v: string) => {
      seen.push(lock.read().pendingRestores.map(p => ({ key: p.key, what: p.what })));
      await w.write(v);
    });
    await runRoundTrip(roundTrip(w, { write, restoreRecord: { x: 1, y: 2 } }), lock, factory, window.url);
    expect(seen[0]).toHaveLength(1);
    expect(seen[0][0].key).toMatch(/^RDOSetTaxValue:[0-9a-f-]{36}$/);
    expect(seen[0][0].what).toBe('Helartia tax row 0 — put back "7"');
    expect(lock.read().pendingRestores).toEqual([]);
  });

  it('keeps the pending restore when the restore read-back never reaches the original', async () => {
    jest.spyOn(liveLog, 'awaitMarker').mockResolvedValue('Setting Tax value: Helartia, 0, 8');
    const w = world('7');
    // The restore is acknowledged but the value stays at the test value.
    const restore = jest.fn(async () => undefined);
    const lock = tempLock();
    const result = await runRoundTrip(roundTrip(w, { restore }), lock, factory, window.url, timed());
    expect(restore).toHaveBeenCalledWith('7');
    expect(result.status).toBe('FAIL');
    expect(result.restored).toBe(false);
    expect(result.restoreReadBack).toBe('UNCONFIRMED');
    expect(result.note).toMatch(/restore not confirmed: read-back still shows "8" — the world is left dirty/);
    expect(lock.read().pendingRestores).toHaveLength(1);
    expect(lock.read().pendingRestores[0].originalValue).toBe('7');
  });

  it('keeps the pending restore when the restore read-back throws', async () => {
    jest.spyOn(liveLog, 'awaitMarker').mockResolvedValue('Setting Tax value: Helartia, 0, 8');
    const w = world('7');
    const read = jest.fn(async () => {
      if (w.state.writes.length === 2) throw new Error('read failed');
      return w.state.value;
    });
    const spec = roundTrip(w);
    spec.proof.readBack = { ...spec.proof.readBack, read };
    const lock = tempLock();
    const result = await runRoundTrip(spec, lock, factory, window.url);
    expect(result.restored).toBe(false);
    expect(result.note).toMatch(/restore not confirmed: read-back still shows "\(absent\)"/);
    expect(lock.read().pendingRestores).toHaveLength(1);
  });

  it('reports a restore that throws as failed and keeps the pending restore', async () => {
    jest.spyOn(liveLog, 'awaitMarker').mockResolvedValue('Setting Tax value: Helartia, 0, 8');
    const restore = jest.fn(async () => {
      throw new Error('restore rejected');
    });
    const lock = tempLock();
    const result = await runRoundTrip(roundTrip(world('7'), { restore }), lock, factory, window.url);
    expect(result.status).toBe('FAIL');
    expect(result.restoreReadBack).toBe('UNCONFIRMED');
    expect(result.note).toMatch(/restore failed — the world is left dirty/);
    expect(lock.read().pendingRestores).toHaveLength(1);
  });

  // #1310: a server that refused both writes left the world unchanged — no dirty world.
  it('FAILs on the thrown write but clears the pending restore when both writes throw and the read-back shows the original', async () => {
    const w = world('7');
    const write = jest.fn(async () => {
      throw new Error('SERVER_ERROR could not store');
    });
    const lock = tempLock();
    const result = await runRoundTrip(roundTrip(w, { write }), lock, factory, window.url);
    expect(write).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('FAIL');
    expect(result.note).toBe('SERVER_ERROR could not store');
    expect(result.restored).toBe(true);
    expect(result.restoreReadBack).toBe('CONFIRMED');
    expect(lock.read().pendingRestores).toEqual([]);
  });

  it('notes an unchanged world when the test write was ignored and the restore write throws', async () => {
    jest.spyOn(liveLog, 'awaitMarker').mockResolvedValue(null);
    const w = world('7');
    const write = jest.fn(async () => undefined);
    const restore = jest.fn(async () => {
      throw new Error('restore rejected');
    });
    const lock = tempLock();
    const result = await runRoundTrip(roundTrip(w, { write, restore }), lock, factory, window.url, timed());
    expect(result.status).toBe('FAIL');
    expect(result.restored).toBe(true);
    expect(result.note).toMatch(/read-back never showed "8"/);
    expect(result.note).toMatch(/restore write failed, but the read-back shows the original — the world is unchanged/);
    expect(result.note).not.toMatch(/left dirty/);
    expect(lock.read().pendingRestores).toEqual([]);
  });

  it('keeps the pending restore when the restore write throws and the read-back shows the test value', async () => {
    jest.spyOn(liveLog, 'awaitMarker').mockResolvedValue('Setting Tax value: Helartia, 0, 8');
    const w = world('7');
    const restore = jest.fn(async () => {
      throw new Error('restore rejected');
    });
    const lock = tempLock();
    const result = await runRoundTrip(roundTrip(w, { restore }), lock, factory, window.url, timed());
    expect(result.status).toBe('FAIL');
    expect(result.restored).toBe(false);
    expect(result.restoreReadBack).toBe('UNCONFIRMED');
    expect(result.note).toMatch(/restore failed — the world is left dirty/);
    expect(lock.read().pendingRestores).toHaveLength(1);
    expect(lock.read().pendingRestores[0].originalValue).toBe('7');
  });

  it('uses spec.restore when given', async () => {
    jest.spyOn(liveLog, 'awaitMarker').mockResolvedValue('Setting Tax value: Helartia, 0, 8');
    const w = world('7');
    const restore = jest.fn(async (v: string) => {
      w.state.restores.push(v);
      w.state.value = v;
    });
    const result = await runRoundTrip(roundTrip(w, { restore }), tempLock(), factory, window.url);
    expect(result.status).toBe('PASS');
    expect(w.state.writes).toEqual(['8']);
    expect(w.state.restores).toEqual(['7']);
  });

  it('compares through normalise, for a documented server quantisation', async () => {
    jest.spyOn(liveLog, 'awaitMarker').mockResolvedValue('Setting Tax value: Helartia, 0, 8.4');
    const w = world('7');
    const write = jest.fn(async (v: string) => {
      w.state.writes.push(v);
      w.state.value = String(Math.round(Number(v)));
    });
    const spec = roundTrip(w, { write, testValue: () => '8.4' });
    spec.proof.readBack = { ...spec.proof.readBack, normalise: v => String(Math.round(Number(v))) };
    const result = await runRoundTrip(spec, tempLock(), factory, window.url);
    expect(result.status).toBe('PASS');
    expect(result.written).toBe('8.4');
  });

  describe('matches — a rounding equality cannot express (#1153)', () => {
    // The server stores a percent and publishes ceil(units): 30% of 7 units reads back 3.
    const units = (p: string): string => String(Math.ceil((Number(p) * 7) / 100));

    it('confirms the forward poll through matches where plain equality would fail', async () => {
      jest.spyOn(liveLog, 'awaitMarker').mockResolvedValue('Setting Tax value: Helartia, 0, 30');
      const w = world('50');
      const shown = { value: '4' };
      const write = jest.fn(async (v: string) => {
        w.state.writes.push(v);
        shown.value = units(v);
      });
      const spec = roundTrip(w, { write, testValue: () => '30' });
      spec.proof.readBack = {
        ...spec.proof.readBack,
        read: async () => shown.value,
        matches: (last, expected) => Math.abs(Number(last) - Number(units(expected))) <= 1,
      };
      const result = await runRoundTrip(spec, tempLock(), factory, window.url, timed());
      expect(result).toMatchObject({ status: 'PASS', readBack: 'CONFIRMED', restoreReadBack: 'CONFIRMED' });
      expect(w.state.writes).toEqual(['30', '50']);
    });

    it('hands the restore poll the original as expected', async () => {
      jest.spyOn(liveLog, 'awaitMarker').mockResolvedValue('Setting Tax value: Helartia, 0, 8');
      const w = world('7');
      const seen: string[] = [];
      const spec = roundTrip(w);
      spec.proof.readBack = {
        ...spec.proof.readBack,
        matches: (last, expected) => {
          seen.push(expected);
          return last === expected;
        },
      };
      const result = await runRoundTrip(spec, tempLock(), factory, window.url, timed());
      expect(result.status).toBe('PASS');
      expect(seen).toEqual(['8', '7']);
    });

    it('FAILs UNCONFIRMED when matches refuses, even though equality would pass', async () => {
      jest.spyOn(liveLog, 'awaitMarker').mockResolvedValue('Setting Tax value: Helartia, 0, 8');
      const w = world('7');
      const spec = roundTrip(w);
      spec.proof.readBack = { ...spec.proof.readBack, matches: () => false };
      const result = await runRoundTrip(spec, tempLock(), factory, window.url, timed());
      expect(result).toMatchObject({ status: 'FAIL', readBack: 'UNCONFIRMED', restoreReadBack: 'UNCONFIRMED', restored: false });
    });
  });

  it('truncates a long original in the pending restore label but keeps it whole in originalValue', async () => {
    jest.spyOn(liveLog, 'awaitMarker').mockResolvedValue('Setting Tax value: Helartia, 0, 8');
    const long = 'A'.repeat(200);
    const w = world(long);
    const lock = tempLock();
    const labels: { what: string; originalValue: string }[] = [];
    const write = jest.fn(async (v: string) => {
      labels.push(...lock.read().pendingRestores);
      await w.write(v);
    });
    await runRoundTrip(roundTrip(w, { write }), lock, factory, window.url);
    expect(labels[0].what.length).toBeLessThan(120);
    expect(labels[0].what.endsWith('…"')).toBe(true);
    expect(labels[0].originalValue).toBe(long);
  });
});

describe('probeFailure', () => {
  it('keeps the reason so the report is not just "FAIL"', () => {
    const result = probeFailure(spec, new Error('socket closed'));
    expect(result).toMatchObject({ status: 'FAIL', note: 'socket closed', restored: false });
  });
});
