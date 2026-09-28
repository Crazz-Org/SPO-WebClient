import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import {
  SessionCap,
  parseMaxSessions,
  withSessionCap,
  DEFAULT_MAX_SESSIONS,
  SERVER_FULL_MESSAGE,
  WS_TRY_AGAIN_LATER_CLOSE_CODE,
} from './session-cap';
import type { GatewayMetrics } from './observability';

function sessions(n: number): EventEmitter[] {
  return Array.from({ length: n }, () => new EventEmitter());
}

describe('SessionCap', () => {
  it('with max 3, admits three sessions and refuses the fourth', () => {
    const cap = new SessionCap<EventEmitter>(3);
    const [a, b, c, d] = sessions(4);
    expect([cap.tryAdmit(a), cap.tryAdmit(b), cap.tryAdmit(c)]).toEqual([true, true, true]);
    expect(cap.tryAdmit(d)).toBe(false);
    expect(cap.isAdmitted(d)).toBe(false);
    expect(cap.counters()).toEqual({ admitted: 3, max: 3, refusedFull: 1 });
  });

  it('admitting the same session twice takes one slot', () => {
    const cap = new SessionCap<EventEmitter>(3);
    const [a] = sessions(1);
    expect(cap.tryAdmit(a)).toBe(true);
    expect(cap.tryAdmit(a)).toBe(true);
    expect(cap.counters().admitted).toBe(1);
  });

  it('an already-admitted session passes even at the cap', () => {
    const cap = new SessionCap<EventEmitter>(1);
    const [a] = sessions(1);
    cap.tryAdmit(a);
    expect(cap.tryAdmit(a)).toBe(true);
    expect(cap.counters().refusedFull).toBe(0);
  });

  it('a destroyed event frees the slot, and the next admission passes', () => {
    const cap = new SessionCap<EventEmitter>(2);
    const [a, b, c] = sessions(3);
    cap.tryAdmit(a);
    cap.tryAdmit(b);
    expect(cap.tryAdmit(c)).toBe(false);
    a.emit('destroyed');
    expect(cap.isAdmitted(a)).toBe(false);
    expect(cap.tryAdmit(c)).toBe(true);
    a.emit('destroyed');
    expect(cap.counters().admitted).toBe(2);
  });

  it('a failed-login release frees the slot, and a later re-admission still frees on destroyed', () => {
    const cap = new SessionCap<EventEmitter>(1);
    const [a, b] = sessions(2);
    cap.tryAdmit(a);
    cap.release(a);
    cap.release(a);
    expect(cap.counters().admitted).toBe(0);
    expect(cap.tryAdmit(a)).toBe(true);
    expect(a.listenerCount('destroyed')).toBe(1);
    a.emit('destroyed');
    expect(cap.tryAdmit(b)).toBe(true);
  });

  it("does not count the player's own parked session", () => {
    const cap = new SessionCap<EventEmitter>(3);
    const [parkedA, other1, other2, newA, newB] = sessions(5);
    cap.tryAdmit(parkedA);
    cap.tryAdmit(other1);
    cap.tryAdmit(other2);
    expect(cap.tryAdmit(newB, [])).toBe(false);
    expect(cap.tryAdmit(newA, [parkedA])).toBe(true);
    expect(cap.counters().admitted).toBe(4);
  });

  it('an unadmitted or duplicated notCounted entry does not lower the count twice', () => {
    const cap = new SessionCap<EventEmitter>(2);
    const [a, b, stranger, c] = sessions(4);
    cap.tryAdmit(a);
    cap.tryAdmit(b);
    expect(cap.tryAdmit(c, [stranger])).toBe(false);
    expect(cap.tryAdmit(c, [a, a])).toBe(true);
    const [d] = sessions(1);
    expect(cap.tryAdmit(d, [a, a])).toBe(false);
  });

  it('refusedFull counts every refusal', () => {
    const cap = new SessionCap<EventEmitter>(1);
    const [a, b, c] = sessions(3);
    cap.tryAdmit(a);
    cap.tryAdmit(b);
    cap.tryAdmit(c);
    cap.tryAdmit(b);
    expect(cap.counters().refusedFull).toBe(3);
  });

  it('setMax changes the cap in force', () => {
    const cap = new SessionCap<EventEmitter>();
    expect(cap.counters().max).toBe(DEFAULT_MAX_SESSIONS);
    cap.setMax(7);
    expect(cap.counters().max).toBe(7);
  });
});

describe('parseMaxSessions', () => {
  it.each([undefined, '', '   '])('%p gives the default', raw => {
    expect(parseMaxSessions(raw)).toBe(DEFAULT_MAX_SESSIONS);
  });

  it('a positive integer gives that value', () => {
    expect(parseMaxSessions('250')).toBe(250);
    expect(parseMaxSessions(' 12 ')).toBe(12);
  });

  it.each(['0', '-5', '2.5', 'abc', '99999999999999999999'])('%p throws naming SPO_MAX_SESSIONS', raw => {
    expect(() => parseMaxSessions(raw)).toThrow(/SPO_MAX_SESSIONS/);
  });
});

describe('DEFAULT_MAX_SESSIONS', () => {
  it('equals recommendedCap in src/__tests__/load/session-capacity.json (card L12-1)', () => {
    const raw: unknown = JSON.parse(
      fs.readFileSync(path.join(__dirname, '../__tests__/load/session-capacity.json'), 'utf8'),
    );
    const recommendedCap =
      typeof raw === 'object' && raw !== null && 'recommendedCap' in raw ? raw.recommendedCap : undefined;
    expect(DEFAULT_MAX_SESSIONS).toBe(recommendedCap);
  });
});

describe('refusal constants', () => {
  it('uses the "Try Again Later" close code and the server-full sentence', () => {
    expect(WS_TRY_AGAIN_LATER_CLOSE_CODE).toBe(1013);
    expect(SERVER_FULL_MESSAGE).toBe('The server is full. Please try again in a few minutes.');
  });
});

describe('withSessionCap', () => {
  it('keeps every metrics field and adds the three counters under sessions', () => {
    const metrics = {
      version: 'v1',
      sessions: { total: 2, byPhase: { 0: 1, 1: 1 } },
      websocketsOpen: 3,
    } as unknown as GatewayMetrics;
    const out = withSessionCap(metrics, { admitted: 2, max: 10, refusedFull: 4 });
    expect(out).toEqual({
      version: 'v1',
      websocketsOpen: 3,
      sessions: { total: 2, byPhase: { 0: 1, 1: 1 }, admitted: 2, max: 10, refusedFull: 4 },
    });
  });
});
