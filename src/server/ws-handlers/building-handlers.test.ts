/**
 * `handleBuildingWorkerCounts` — the WS leg of the Workforce tab's 20 s poll.
 *
 * What matters here is that the class list the client sent is what reaches the
 * session, unaltered: the gateway loops over exactly what it is given, so a
 * handler that widened the list would put a call on the wire for a class with no
 * jobs — the one thing the card asks not to happen.
 */

import type { WebSocket } from 'ws';
import { handleBuildingWorkerCounts } from './building-handlers';
import type { WsHandlerContext } from './types';
import {
  WsMessageType,
  type WsMessage,
  type WsRespBuildingWorkerCounts,
  type WsRespError,
  type WorkerCount,
} from '../../shared/types';
import * as ErrorCodes from '../../shared/error-codes';

function makeCtx(readWorkerCounts: jest.Mock) {
  const sent: WsMessage[] = [];
  const ws = {
    send: jest.fn((payload: string) => sent.push(JSON.parse(payload) as WsMessage)),
  } as unknown as WebSocket;

  const ctx = {
    ws,
    session: { readWorkerCounts },
  } as unknown as WsHandlerContext;

  return { ctx, sent, readWorkerCounts };
}

function request(kinds: unknown): WsMessage {
  return {
    type: WsMessageType.REQ_BUILDING_WORKER_COUNTS,
    wsRequestId: 'req-wc',
    x: 472,
    y: 392,
    kinds,
  } as unknown as WsMessage;
}

describe('handleBuildingWorkerCounts', () => {
  const counts: WorkerCount[] = [{ kind: 0, workers: 5 }, { kind: 2, workers: 69 }];

  it('forwards the coordinates and the class list, and answers with the figures', async () => {
    const { ctx, sent, readWorkerCounts } = makeCtx(jest.fn().mockResolvedValue(counts));

    await handleBuildingWorkerCounts(ctx, request([0, 2]));

    expect(readWorkerCounts).toHaveBeenCalledWith(472, 392, [0, 2]);
    expect(sent).toHaveLength(1);
    expect(sent[0] as WsRespBuildingWorkerCounts).toEqual({
      type: WsMessageType.RESP_BUILDING_WORKER_COUNTS,
      wsRequestId: 'req-wc',
      x: 472,
      y: 392,
      counts,
    });
  });

  it('forwards an empty list when the request carries no array', async () => {
    const { ctx, readWorkerCounts } = makeCtx(jest.fn().mockResolvedValue([]));

    await handleBuildingWorkerCounts(ctx, request(undefined));

    expect(readWorkerCounts).toHaveBeenCalledWith(472, 392, []);
  });

  it('answers an error frame when the session rejects', async () => {
    const { ctx, sent } = makeCtx(jest.fn().mockRejectedValue(new Error('no inspector')));
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await handleBuildingWorkerCounts(ctx, request([1]));

    const err = sent[0] as WsRespError;
    expect(err.type).toBe(WsMessageType.RESP_ERROR);
    expect(err.wsRequestId).toBe('req-wc');
    expect(err.errorMessage).toBe('no inspector');
    expect(err.code).toBe(ErrorCodes.ERROR_FacilityNotFound);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });
});
