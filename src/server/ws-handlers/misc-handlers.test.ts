import type { WebSocket } from 'ws';
import { handleSearchConnections } from './misc-handlers';
import type { WsHandlerContext } from './types';
import { WsMessageType, type WsMessage, type WsRespSearchConnections, type WsRespConnectionReachability, type ConnectionSearchResult, type ConnectionReachabilityEntry } from '../../shared/types';

function makeCtx(session: Record<string, unknown>) {
  const sent: WsMessage[] = [];
  const ws = {
    send: jest.fn((payload: string) => sent.push(JSON.parse(payload) as WsMessage)),
  } as unknown as WebSocket;

  const ctx = { ws, session } as unknown as WsHandlerContext;
  return { ctx, sent };
}

/** A promise plus its resolvers, so a test controls exactly when the sweep settles. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (err: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const flush = () => new Promise(r => setImmediate(r));

const RESULTS: ConnectionSearchResult[] = [
  { facilityName: 'Trade Center', companyName: 'PGI', x: 463, y: 389, price: '$80', quality: '40' },
];
const ENTRIES: ConnectionReachabilityEntry[] = [{ x: 463, y: 389, connected: true }];

const REQ: WsMessage = {
  type: WsMessageType.REQ_SEARCH_CONNECTIONS,
  wsRequestId: 'r1',
  buildingX: 459, buildingY: 389,
  fluidId: 'Crops', direction: 'input',
} as WsMessage;

describe('handleSearchConnections', () => {
  it('sends RESP_SEARCH_CONNECTIONS first, then RESP_CONNECTION_REACHABILITY once the sweep resolves', async () => {
    const gate = deferred<ConnectionReachabilityEntry[]>();
    const searchConnections = jest.fn().mockResolvedValue(RESULTS);
    const resolveConnectionReachability = jest.fn().mockReturnValue(gate.promise);
    const log = { warn: jest.fn() };
    const { ctx, sent } = makeCtx({ searchConnections, resolveConnectionReachability, log });

    await handleSearchConnections(ctx, REQ);

    expect(sent).toHaveLength(1);
    const first = sent[0] as WsRespSearchConnections;
    expect(first.type).toBe(WsMessageType.RESP_SEARCH_CONNECTIONS);
    expect(first.results).toEqual(RESULTS);

    gate.resolve(ENTRIES);
    await flush();

    expect(sent).toHaveLength(2);
    const second = sent[1] as WsRespConnectionReachability;
    expect(second.type).toBe(WsMessageType.RESP_CONNECTION_REACHABILITY);
    expect(second.wsRequestId).toBe('r1');
    expect(second.fluidId).toBe('Crops');
    expect(second.direction).toBe('input');
    expect(second.buildingX).toBe(459);
    expect(second.buildingY).toBe(389);
    expect(second.entries).toEqual(ENTRIES);
  });

  it('a rejected sweep sends no second frame and warns', async () => {
    const searchConnections = jest.fn().mockResolvedValue(RESULTS);
    const resolveConnectionReachability = jest.fn().mockRejectedValue(new Error('boom'));
    const log = { warn: jest.fn() };
    const { ctx, sent } = makeCtx({ searchConnections, resolveConnectionReachability, log });

    await handleSearchConnections(ctx, REQ);
    await flush();

    expect(sent).toHaveLength(1);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('boom'));
  });

  it('zero results send no second frame and never call the sweep', async () => {
    const searchConnections = jest.fn().mockResolvedValue([]);
    const resolveConnectionReachability = jest.fn();
    const log = { warn: jest.fn() };
    const { ctx, sent } = makeCtx({ searchConnections, resolveConnectionReachability, log });

    await handleSearchConnections(ctx, REQ);
    await flush();

    expect(sent).toHaveLength(1);
    expect(resolveConnectionReachability).not.toHaveBeenCalled();
  });

  it('a second search on the same session before the first sweep resolves supersedes it', async () => {
    const firstGate = deferred<ConnectionReachabilityEntry[]>();
    const secondGate = deferred<ConnectionReachabilityEntry[]>();
    const searchConnections = jest.fn().mockResolvedValue(RESULTS);
    const resolveConnectionReachability = jest.fn()
      .mockReturnValueOnce(firstGate.promise)
      .mockReturnValueOnce(secondGate.promise);
    const log = { warn: jest.fn() };
    const { ctx, sent } = makeCtx({ searchConnections, resolveConnectionReachability, log });

    await handleSearchConnections(ctx, { ...REQ, wsRequestId: 'r1' } as WsMessage);
    await handleSearchConnections(ctx, { ...REQ, wsRequestId: 'r2' } as WsMessage);

    // Both RESP_SEARCH_CONNECTIONS frames are already sent.
    expect(sent).toHaveLength(2);

    firstGate.resolve(ENTRIES);
    await flush();
    // Superseded: the first sweep's frame must not appear.
    expect(sent).toHaveLength(2);

    secondGate.resolve(ENTRIES);
    await flush();
    expect(sent).toHaveLength(3);
    expect((sent[2] as WsRespConnectionReachability).wsRequestId).toBe('r2');
  });
});
