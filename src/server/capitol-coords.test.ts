import { findCapitolCoords, pushCapitolCoords, sendCapitolCoords } from './capitol-coords';
import { WsMessageType } from '../shared/types/message-types';
import type { SearchMenuCategory } from '../shared/types/domain-types';

function category(over: Partial<SearchMenuCategory>): SearchMenuCategory {
  return { id: 'c', label: 'Capitol', enabled: true, x: 100, y: 200, ...over };
}

describe('findCapitolCoords', () => {
  it('returns the Capitol position when the page carries a complete one', () => {
    expect(findCapitolCoords([category({ label: 'Towns' }), category({})])).toEqual({ x: 100, y: 200 });
  });

  it('returns null when there is no Capitol entry', () => {
    expect(findCapitolCoords([category({ label: 'Towns' })])).toBeNull();
  });

  it('returns null when the Capitol is disabled', () => {
    expect(findCapitolCoords([category({ enabled: false })])).toBeNull();
  });

  it('returns null when the position is incomplete', () => {
    expect(findCapitolCoords([category({ y: undefined })])).toBeNull();
    expect(findCapitolCoords([category({ x: undefined })])).toBeNull();
  });

  it('returns null on an empty page', () => {
    expect(findCapitolCoords([])).toBeNull();
  });
});

function harness() {
  const sent: string[] = [];
  const stored: (null | { x: number; y: number })[] = [];
  return {
    sent,
    stored,
    ws: { send: (data: string) => { sent.push(data); } },
    session: { setCapitolCoords: (c: { x: number; y: number } | null) => { stored.push(c); } },
  };
}

describe('sendCapitolCoords', () => {
  it('records the coordinates and answers hasCapitol true', () => {
    const h = harness();
    sendCapitolCoords(h.ws, h.session, { x: 7, y: 9 });
    expect(h.stored).toEqual([{ x: 7, y: 9 }]);
    expect(JSON.parse(h.sent[0])).toEqual({
      type: WsMessageType.RESP_CAPITOL_COORDS,
      x: 7,
      y: 9,
      hasCapitol: true,
    });
  });

  it('still answers when there is no Capitol — a silent socket hangs the search menu', () => {
    const h = harness();
    sendCapitolCoords(h.ws, h.session, null);
    expect(h.stored).toEqual([null]);
    expect(JSON.parse(h.sent[0])).toEqual({
      type: WsMessageType.RESP_CAPITOL_COORDS,
      x: 0,
      y: 0,
      hasCapitol: false,
    });
  });
});

describe('pushCapitolCoords', () => {
  it('answers with the Capitol the home page names', async () => {
    const h = harness();
    await pushCapitolCoords({ getHomePage: async () => [category({})] }, h.ws, h.session);
    expect(h.stored).toEqual([{ x: 100, y: 200 }]);
    expect(JSON.parse(h.sent[0])).toMatchObject({ hasCapitol: true, x: 100, y: 200 });
  });

  it('answers "no Capitol" when the fetch rejects, instead of leaving the socket silent', async () => {
    const h = harness();
    await pushCapitolCoords(
      { getHomePage: async () => { throw new Error('Request timeout'); } },
      h.ws,
      h.session,
    );
    expect(h.stored).toEqual([null]);
    expect(JSON.parse(h.sent[0])).toMatchObject({ hasCapitol: false, x: 0, y: 0 });
  });

  it('never rejects, so a caller may fire it and forget it', async () => {
    const h = harness();
    await expect(
      pushCapitolCoords({ getHomePage: async () => { throw new Error('boom'); } }, h.ws, h.session),
    ).resolves.toBeUndefined();
  });

  it('retries a rejecting fetch and answers with the Capitol once it succeeds', async () => {
    const h = harness();
    const sleepCalls: number[] = [];
    const sleep = async (ms: number) => { sleepCalls.push(ms); };
    let calls = 0;
    const source = {
      getHomePage: async () => {
        calls++;
        if (calls <= 2) throw new Error('Request timeout');
        return [category({})];
      },
    };
    await pushCapitolCoords(source, h.ws, h.session, { attempts: 4, delayMs: 0, sleep });
    expect(h.sent.length).toBe(1);
    expect(JSON.parse(h.sent[0])).toEqual({
      type: WsMessageType.RESP_CAPITOL_COORDS,
      hasCapitol: true,
      x: 100,
      y: 200,
    });
    expect(h.stored).toEqual([{ x: 100, y: 200 }]);
    expect(calls).toBe(3);
    expect(sleepCalls.length).toBe(2);
  });

  it('spends the whole budget on a source that keeps rejecting, then answers "no Capitol" once', async () => {
    const h = harness();
    const sleepCalls: number[] = [];
    const sleep = async (ms: number) => { sleepCalls.push(ms); };
    let calls = 0;
    const source = { getHomePage: async () => { calls++; throw new Error('Request timeout'); } };
    await pushCapitolCoords(source, h.ws, h.session, { attempts: 3, delayMs: 0, sleep });
    expect(calls).toBe(3);
    expect(sleepCalls.length).toBe(2);
    expect(h.sent.length).toBe(1);
    expect(JSON.parse(h.sent[0])).toEqual({
      type: WsMessageType.RESP_CAPITOL_COORDS,
      hasCapitol: false,
      x: 0,
      y: 0,
    });
    expect(h.stored).toEqual([null]);
  });

  it('does not retry a good fetch that simply has no Capitol', async () => {
    const h = harness();
    const sleep = jest.fn(async () => {});
    let calls = 0;
    const source = { getHomePage: async () => { calls++; return [category({ label: 'Towns' })]; } };
    await pushCapitolCoords(source, h.ws, h.session, { attempts: 4, delayMs: 0, sleep });
    expect(calls).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(h.sent.length).toBe(1);
    expect(JSON.parse(h.sent[0])).toMatchObject({ hasCapitol: false, x: 0, y: 0 });
  });

  it('uses a real timer when no sleep is injected', async () => {
    const h = harness();
    let calls = 0;
    const source = {
      getHomePage: async () => {
        calls++;
        if (calls === 1) throw new Error('Request timeout');
        return [category({})];
      },
    };
    await pushCapitolCoords(source, h.ws, h.session, { attempts: 2, delayMs: 0 });
    expect(calls).toBe(2);
    expect(h.sent.length).toBe(1);
    expect(JSON.parse(h.sent[0])).toMatchObject({ hasCapitol: true, x: 100, y: 200 });
  });

  it('clamps attempts: 0 to a single attempt', async () => {
    const h = harness();
    const sleep = jest.fn(async () => {});
    let calls = 0;
    const source = { getHomePage: async () => { calls++; throw new Error('boom'); } };
    await pushCapitolCoords(source, h.ws, h.session, { attempts: 0, sleep });
    expect(calls).toBe(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(h.sent.length).toBe(1);
    expect(JSON.parse(h.sent[0])).toMatchObject({ hasCapitol: false, x: 0, y: 0 });
  });
});
