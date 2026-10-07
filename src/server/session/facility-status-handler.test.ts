/**
 * REQ_FACILITY_STATUS_BATCH — AllObjectStatusText per facility id, no focus (#1335).
 *
 * The answers are derived from the captured SwitchFocusEx answers
 * (`mock-server/scenarios/switch-focus-scenario.ts`): `TClientView.SwitchFocusEx`
 * answers `IntToStr(ObjId) + LineBreak + RDOAllObjectStatusText(ObjId, ...)`
 * (Interface Server/InterfaceServer.pas:924-935), so dropping the leading id line of a
 * captured focus answer gives exactly the AllObjectStatusText answer for that facility.
 */

import { describe, it, expect, afterEach } from '@jest/globals';
import type { WebSocket } from 'ws';
import {
  readFacilityStatusBatch,
  parseFacilityStatusText,
  revenueToNumber,
  FACILITY_STATUS_BUDGET_MS,
  FACILITY_STATUS_BATCH_CAP_MS,
} from './facility-status-handler';
import { makeSessionCtx } from '../__tests__/session/fake-session-context';
import type { FakeSessionCtx } from '../__tests__/session/fake-session-context';
import { createSwitchFocusScenario } from '../../mock-server/scenarios/switch-focus-scenario';
import { RdoParser } from '../../shared/rdo-types';
import { TimeoutCategory } from '../../shared/timeout-categories';
import { WsMessageType } from '../../shared/types';
import type { RdoPacket, WsMessage } from '../../shared/types';
import { handleFacilityStatusBatch, MAX_FACILITY_STATUS_BATCH_IDS } from '../ws-handlers/misc-handlers';
import type { WsHandlerContext } from '../ws-handlers/types';

/** `{ id, answer }` per captured focus: answer = `res="%<AllObjectStatusText>"`. */
function capturedStatusAnswers(): Array<{ id: string; answer: string }> {
  const { rdo } = createSwitchFocusScenario();
  return rdo.exchanges.map(ex => {
    const m = /^A\d+ res="%(\d+)\n([\s\S]*)"$/.exec(ex.response);
    if (!m) throw new Error(`unexpected capture shape: ${ex.response.slice(0, 40)}`);
    return { id: m[1], answer: `res="%${m[2]}"` };
  });
}

/** The integer arguments of an AllObjectStatusText frame as sent. */
function argsOf(packet: Partial<RdoPacket>): number[] {
  return (packet.args ?? []).map(a => RdoParser.asInt(String(a)));
}

function answerPacket(payload: string): RdoPacket {
  return { raw: '', type: 'RESPONSE', rid: 1, payload } as RdoPacket;
}

/**
 * A server whose answers the test releases by hand. It counts the calls the gateway has
 * not yet seen settle — the number "one in flight per session" is about.
 */
function heldServer() {
  const calls: Array<{ id: number; settle: (payload: string | Error) => void }> = [];
  let inFlight = 0;
  let peak = 0;
  const send = jest.fn((_socket: string, packet: Partial<RdoPacket>) => {
    inFlight++;
    peak = Math.max(peak, inFlight);
    return new Promise<RdoPacket>((resolve, reject) => {
      calls.push({
        id: argsOf(packet)[0],
        settle: payload => {
          inFlight--;
          if (payload instanceof Error) reject(payload);
          else resolve(answerPacket(payload));
        },
      });
    });
  });
  return { calls, send, peak: () => peak, inFlight: () => inFlight };
}

/** Let every queued promise continuation run (fake timers do not tick microtasks). */
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

afterEach(() => {
  jest.useRealTimers();
});

describe('revenueToNumber', () => {
  it.each([
    ['$1,398/h', 1398],
    ['-$29/h', -29],
    ['-$39,127/h', -39127],
    ['$0/h', 0],
    ['', null],
    ['$1,398', null],
    ['garbage', null],
  ])('%s -> %s', (raw, n) => {
    expect(revenueToNumber(raw)).toBe(n);
  });
});

describe('parseFacilityStatusText', () => {
  it('reads a captured status text as focus reads it, revenue included', () => {
    const [farm, store] = capturedStatusAnswers();
    const farmText = farm.answer.slice('res="%'.length, -1);
    expect(parseFacilityStatusText(farm.id, farmText)).toEqual({
      buildingName: 'Farm 10',
      ownerName: 'Yellow Inc.',
      salesInfo: 'Hiring workforce at 39%',
      revenue: '-$29/h',
      revenuePerHour: -29,
      detailsText: 'Upgrade Level: 1  Professionals: 1 of 1.Workers: 9 of 27.',
      hintsText: 'Warning: This facility needs Low class work force.',
    });
    const storeText = store.answer.slice('res="%'.length, -1);
    expect(parseFacilityStatusText(store.id, storeText).revenuePerHour).toBe(-36);
  });

  it('a text without ($X/h) has revenue "" and revenuePerHour null (malformed / missing revenue)', () => {
    const s = parseFacilityStatusText('5', 'Shop 1\r\n\r\nAcme\r\n\r\nFood sales at 10%:-:details:-:hint:-:');
    expect(s.buildingName).toBe('Shop 1');
    expect(s.revenue).toBe('');
    expect(s.revenuePerHour).toBeNull();

    const bad = parseFacilityStatusText('5', 'Shop 1\r\n\r\nAcme\r\n\r\nsales\r\n\r\n($12,x/h):-:d:-:h:-:');
    expect(bad.revenue).toBe('');
    expect(bad.revenuePerHour).toBeNull();
  });
});

describe('readFacilityStatusBatch', () => {
  it('sends one AllObjectStatusText(id, TycoonId) per id on world, NORMAL, no focus member, answers in order', async () => {
    const caps = capturedStatusAnswers();
    const byId = new Map(caps.map(c => [c.id, c.answer]));
    const fake = makeSessionCtx({ hasFocusedFacilityId: () => true });
    fake.respond(p => byId.get(String(argsOf(p)[0])) ?? new Error('unexpected id'));

    const ids = caps.map(c => c.id);
    const entries = await readFacilityStatusBatch(fake.ctx, ids);

    expect(entries.map(e => e.id)).toEqual(ids);
    expect(entries.map(e => (e.status === 'ok' ? e.text.revenue : e.status))).toEqual(['-$29/h', '-$36/h']);
    for (const s of fake.sent) {
      expect(s.socketName).toBe('world');
      expect(s.packet.member).toBe('AllObjectStatusText');
      expect(s.packet.targetId).toBe(fake.ctx.worldContextId);
      expect(s.category).toBe(TimeoutCategory.NORMAL);
      // The wire keeps its own (legacy) deadline; the budget is the gateway's.
      expect(s.timeoutMs).toBeUndefined();
      expect(argsOf(s.packet)[1]).toBe(fake.ctx.fTycoonProxyId);
    }
    expect(fake.sent.map(s => s.packet.member)).not.toContain('SwitchFocusEx');
    expect(fake.sent.map(s => argsOf(s.packet)[0])).toEqual(ids.map(Number));
    expect(fake.ctx.clearBuildingFocus).not.toHaveBeenCalled();
  });

  it('never has more than one AllObjectStatusText unsettled per session, across two batches at once', async () => {
    const answer = capturedStatusAnswers()[0].answer;
    const server = heldServer();
    const fake = makeSessionCtx({ hasFocusedFacilityId: () => true, sendRdoRequest: server.send });

    const a = readFacilityStatusBatch(fake.ctx, ['11', '12', '13']);
    const b = readFacilityStatusBatch(fake.ctx, ['21', '22']);
    for (let i = 0; i < 5; i++) {
      await flush();
      expect(server.inFlight()).toBe(1);
      server.calls[i].settle(answer);
    }
    const [ea, eb] = await Promise.all([a, b]);

    expect(server.peak()).toBe(1);
    expect(server.send).toHaveBeenCalledTimes(5);
    expect([...ea, ...eb].every(e => e.status === 'ok')).toBe(true);
    // Fair: the two batches take turns at the one slot.
    expect(server.calls.map(c => c.id)).toEqual([11, 21, 12, 22, 13]);
  });

  it('gives each session its own slot: two sessions each have one call in flight at once', async () => {
    const answer = capturedStatusAnswers()[0].answer;
    const server = heldServer();
    const one = makeSessionCtx({ hasFocusedFacilityId: () => true, sendRdoRequest: server.send });
    const two = makeSessionCtx({ hasFocusedFacilityId: () => true, sendRdoRequest: server.send });

    const a = readFacilityStatusBatch(one.ctx, ['1']);
    const b = readFacilityStatusBatch(two.ctx, ['2']);
    await flush();
    expect(server.inFlight()).toBe(2);
    server.calls.forEach(c => c.settle(answer));
    await Promise.all([a, b]);
  });

  it('a per-id timeout gives that id unknown, and the rest of the batch still answers', async () => {
    jest.useFakeTimers();
    const answer = capturedStatusAnswers()[1].answer;
    const server = heldServer();
    const fake = makeSessionCtx({ hasFocusedFacilityId: () => true, sendRdoRequest: server.send });

    const batch = readFacilityStatusBatch(fake.ctx, ['1', '2', '3'], 1000);
    await flush();
    server.calls[0].settle(answer);
    await flush();
    // Id 2 is slow: its budget runs out, then its answer comes in late.
    await jest.advanceTimersByTimeAsync(1000);
    expect(server.inFlight()).toBe(1);
    expect(server.send).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(300);
    server.calls[1].settle(answer);
    await flush();
    // Only now, with the late call settled, is id 3 sent.
    expect(server.send).toHaveBeenCalledTimes(3);
    server.calls[2].settle(answer);
    const entries = await batch;

    expect(entries[0]).toMatchObject({ id: '1', status: 'ok', text: { revenuePerHour: -36 } });
    expect(entries[1]).toEqual({ id: '2', status: 'unknown', error: 'no answer within 1000 ms' });
    expect(entries[2]).toMatchObject({ id: '3', status: 'ok', text: { revenuePerHour: -36 } });
    expect(server.peak()).toBe(1);
  });

  it('sends nothing behind a call that never settles: the ids waiting run out of budget unsent', async () => {
    jest.useFakeTimers();
    const server = heldServer();
    const fake = makeSessionCtx({ hasFocusedFacilityId: () => true, sendRdoRequest: server.send });

    const batch = readFacilityStatusBatch(fake.ctx, ['1', '2', '3'], 1000);
    await jest.advanceTimersByTimeAsync(3000);
    const entries = await batch;

    expect(server.send).toHaveBeenCalledTimes(1);
    expect(entries.map(e => e.status)).toEqual(['unknown', 'unknown', 'unknown']);
    expect(entries[1]).toEqual({
      id: '2', status: 'unknown',
      error: "not sent: this session's previous status read was still unanswered after 1000 ms",
    });

    // When the stuck call finally settles, the slot is free again for the next read.
    server.calls[0].settle(new Error('Request timeout: AllObjectStatusText'));
    await flush();
    const next = readFacilityStatusBatch(fake.ctx, ['4'], 1000);
    await flush();
    expect(server.send).toHaveBeenCalledTimes(2);
    server.calls[1].settle(capturedStatusAnswers()[0].answer);
    expect((await next)[0].status).toBe('ok');
  });

  it('budgets 10 s per id by default', async () => {
    jest.useFakeTimers();
    const server = heldServer();
    const fake = makeSessionCtx({ hasFocusedFacilityId: () => true, sendRdoRequest: server.send });

    const batch = readFacilityStatusBatch(fake.ctx, ['1']);
    await jest.advanceTimersByTimeAsync(FACILITY_STATUS_BUDGET_MS - 1);
    server.calls[0].settle(capturedStatusAnswers()[0].answer);
    expect((await batch)[0].status).toBe('ok');
    expect(FACILITY_STATUS_BUDGET_MS).toBe(10_000);
  });

  it('caps the whole batch at 60 s: past it the unanswered ids are unknown and nothing more is sent', async () => {
    jest.useFakeTimers();
    const answer = capturedStatusAnswers()[0].answer;
    const sentAt: number[] = [];
    const start = Date.now();
    // Every call takes 9 s: inside the 10 s per-id budget, so only the cap can stop the batch.
    const send = jest.fn(() => {
      sentAt.push(Date.now() - start);
      return new Promise<RdoPacket>(resolve => setTimeout(() => resolve(answerPacket(answer)), 9_000));
    });
    const fake = makeSessionCtx({ hasFocusedFacilityId: () => true, sendRdoRequest: send });
    const ids = Array.from({ length: 20 }, (_, i) => String(i + 1));

    let done = false;
    const batch = readFacilityStatusBatch(fake.ctx, ids).then(e => { done = true; return e; });
    await jest.advanceTimersByTimeAsync(FACILITY_STATUS_BATCH_CAP_MS);
    expect(done).toBe(true);
    const entries = await batch;

    expect(FACILITY_STATUS_BATCH_CAP_MS).toBe(60_000);
    // Answered at 9, 18, … 54 s; the seventh call, sent at 54 s, is cut off by the cap at 60 s.
    expect(entries.slice(0, 6).every(e => e.status === 'ok')).toBe(true);
    expect(entries.slice(6)).toEqual(
      ids.slice(6).map(id => ({ id, status: 'unknown', error: 'batch cap of 60000 ms reached' })),
    );
    expect(sentAt).toEqual([0, 9_000, 18_000, 27_000, 36_000, 45_000, 54_000]);
    // Nothing is sent after the cap, even once the late seventh call has settled.
    await jest.advanceTimersByTimeAsync(30_000);
    expect(send).toHaveBeenCalledTimes(7);
  });

  it('never reaches the cap on a healthy server: 300 ids all answer', async () => {
    const answer = capturedStatusAnswers()[0].answer;
    const fake = makeSessionCtx({ hasFocusedFacilityId: () => true });
    fake.respond(() => answer);
    const ids = Array.from({ length: 300 }, (_, i) => String(i + 1));

    const entries = await readFacilityStatusBatch(fake.ctx, ids);

    expect(entries).toHaveLength(300);
    expect(entries.every(e => e.status === 'ok')).toBe(true);
    expect(fake.sent).toHaveLength(300);
  });

  it('isolates per-id failures: rejection, error code and empty text are unknown, an unfocused id is an error never sent', async () => {
    const good = capturedStatusAnswers()[1].answer;
    const known = new Set(['11', '22', '33', '44']);
    const fake = makeSessionCtx({ hasFocusedFacilityId: (id: string) => known.has(id) });
    fake.respond(p => {
      switch (argsOf(p)[0]) {
        case 11: return good;
        case 22: return new Error('Request timeout');
        case 33: return 'res="#1"';
        case 44: return 'res="%"';
        default: return new Error('must not be sent');
      }
    });

    const entries = await readFacilityStatusBatch(fake.ctx, ['11', '22', '33', '44', '55']);

    expect(entries[0]).toMatchObject({ id: '11', status: 'ok', text: { revenuePerHour: -36 } });
    expect(entries[1]).toEqual({ id: '22', status: 'unknown', error: 'Request timeout' });
    expect(entries[2]).toMatchObject({ id: '33', status: 'unknown', error: expect.stringContaining('error code') });
    expect(entries[3]).toMatchObject({ id: '44', status: 'unknown', error: expect.stringContaining('empty status text') });
    expect(entries[4]).toMatchObject({ id: '55', status: 'error', error: expect.stringContaining('unknown id') });
    // The never-focused id never reached the server.
    expect(fake.sent.map(s => argsOf(s.packet)[0])).toEqual([11, 22, 33, 44]);
  });

  it('answers every id with an error and sends nothing when not logged into a world', async () => {
    const fake = makeSessionCtx({ hasFocusedFacilityId: () => true, worldContextId: null });
    const entries = await readFacilityStatusBatch(fake.ctx, ['1', '2']);
    expect(entries).toEqual([
      { id: '1', status: 'error', error: 'not logged into a world' },
      { id: '2', status: 'error', error: 'not logged into a world' },
    ]);
    expect(fake.sent).toHaveLength(0);
  });

  it('returns [] and sends nothing for no ids', async () => {
    const fake = makeSessionCtx({ hasFocusedFacilityId: () => true });
    expect(await readFacilityStatusBatch(fake.ctx, [])).toEqual([]);
    expect(fake.sent).toHaveLength(0);
  });
});

describe('REQ_FACILITY_STATUS_BATCH end to end over the fake session', () => {
  /** The WS handler, with the session's delegation wired to the real batch read over `fake`. */
  function wsOver(fake: FakeSessionCtx) {
    const replies: WsMessage[] = [];
    const ws = { send: jest.fn((payload: string) => replies.push(JSON.parse(payload) as WsMessage)) } as unknown as WebSocket;
    const session = { readFacilityStatusBatch: (ids: ReadonlyArray<string>) => readFacilityStatusBatch(fake.ctx, ids) };
    const ctx = { ws, session } as unknown as WsHandlerContext;
    return {
      replies,
      ask: (ids: unknown) =>
        handleFacilityStatusBatch(ctx, { type: WsMessageType.REQ_FACILITY_STATUS_BATCH, wsRequestId: 'r', ids } as WsMessage),
    };
  }

  it.each([
    ['no ids', []],
    ['the id 0', [0]],
    [`${MAX_FACILITY_STATUS_BATCH_IDS + 1} ids`, Array.from({ length: MAX_FACILITY_STATUS_BATCH_IDS + 1 }, (_, i) => i + 1)],
  ])('refuses %s with RESP_ERROR and no RDO frame', async (_label, ids) => {
    const fake = makeSessionCtx({ hasFocusedFacilityId: () => true });
    const { replies, ask } = wsOver(fake);
    await ask(ids);
    expect(replies).toEqual([expect.objectContaining({ type: WsMessageType.RESP_ERROR, wsRequestId: 'r' })]);
    expect(fake.sent).toHaveLength(0);
  });

  it(`reads ${MAX_FACILITY_STATUS_BATCH_IDS} ids, and answers a never-focused one per id with no frame for it`, async () => {
    const answer = capturedStatusAnswers()[0].answer;
    const fake = makeSessionCtx({ hasFocusedFacilityId: (id: string) => id !== '7' });
    fake.respond(() => answer);
    const { replies, ask } = wsOver(fake);

    await ask(Array.from({ length: MAX_FACILITY_STATUS_BATCH_IDS }, (_, i) => i + 1));

    expect(replies).toHaveLength(1);
    const entries = (replies[0] as WsMessage & { entries: Array<{ id: string; status: string }> }).entries;
    expect(entries).toHaveLength(MAX_FACILITY_STATUS_BATCH_IDS);
    expect(entries[6]).toMatchObject({ id: '7', status: 'error' });
    expect(entries.filter(e => e.status === 'ok')).toHaveLength(MAX_FACILITY_STATUS_BATCH_IDS - 1);
    expect(fake.sent).toHaveLength(MAX_FACILITY_STATUS_BATCH_IDS - 1);
    expect(fake.sent.map(s => argsOf(s.packet)[0])).not.toContain(7);
  });
});
