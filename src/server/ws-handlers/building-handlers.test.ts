/**
 * WS legs of the building handlers.
 *
 * `handleBuildingWorkerCounts` is the Workforce tab's 20 s poll. What matters
 * there is that the class list the client sent is what reaches the session,
 * unaltered: the gateway loops over exactly what it is given, so a handler that
 * widened the list would put a call on the wire for a class with no jobs — the
 * one thing the card asks not to happen.
 *
 * `handlePlaceBuilding` is the placement refusal path: the server's result code
 * has to survive as itself, not collapse into one generic message.
 *
 * Each block keeps its own `makeCtx` / `request` inside its `describe`. They are
 * different shapes — one stubs `readWorkerCounts`, the other `placeBuilding` —
 * and were written independently on two branches; scoping them is what lets both
 * stand verbatim in one file.
 */

import type { WebSocket } from 'ws';
import { handleBuildingWorkerCounts, handlePlaceBuilding } from './building-handlers';
import type { WsHandlerContext } from './types';
import {
  WsMessageType,
  type WsMessage,
  type WsRespBuildingWorkerCounts,
  type WsRespBuildingPlaced,
  type WsRespError,
  type WorkerCount,
} from '../../shared/types';
import * as ErrorCodes from '../../shared/error-codes';

describe('handleBuildingWorkerCounts', () => {
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

describe('handlePlaceBuilding', () => {
  function makeCtx(placeBuilding: jest.Mock) {
    const sent: WsMessage[] = [];
    const ws = {
      send: jest.fn((payload: string) => sent.push(JSON.parse(payload) as WsMessage)),
    } as unknown as WebSocket;

    const ctx = {
      ws,
      session: { placeBuilding },
    } as unknown as WsHandlerContext;

    return { ctx, sent };
  }

  const request: WsMessage = {
    type: WsMessageType.REQ_PLACE_BUILDING,
    wsRequestId: 'req-1',
    facilityClass: 'PGISupermarketC',
    x: 28,
    y: 618,
  } as unknown as WsMessage;

  it.each([
    [28, 'Zone mismatch'],
    [33, 'Too many facilities'],
    [34, 'Building too close'],
    [3, 'Area not clear'],
    [999, 'Error 999'],
  ])('forwards the server\'s result code %i as RESP_ERROR with the matching text', async (code, message) => {
    const { ctx, sent } = makeCtx(
      jest.fn().mockResolvedValue({ success: false, buildingId: null, errorCode: code }),
    );

    await handlePlaceBuilding(ctx, request);

    expect(sent).toHaveLength(1);
    const resp = sent[0] as WsRespError;
    expect(resp.type).toBe(WsMessageType.RESP_ERROR);
    expect(resp.code).toBe(code);
    expect(resp.errorMessage).toBe(message);
  });

  it('falls back to ERROR_Unknown when the refusal carries no code at all', async () => {
    const { ctx, sent } = makeCtx(
      jest.fn().mockResolvedValue({ success: false, buildingId: null }),
    );

    await handlePlaceBuilding(ctx, request);

    const resp = sent[0] as WsRespError;
    expect(resp.code).toBe(ErrorCodes.ERROR_Unknown);
    expect(resp.errorMessage).toBe('Unknown error');
  });

  it('reports success without a buildingId key when the protocol returned none', async () => {
    const { ctx, sent } = makeCtx(
      jest.fn().mockResolvedValue({ success: true, buildingId: null }),
    );

    await handlePlaceBuilding(ctx, request);

    const resp = sent[0] as WsRespBuildingPlaced;
    expect(resp.type).toBe(WsMessageType.RESP_BUILDING_PLACED);
    expect(resp.x).toBe(28);
    expect(resp.y).toBe(618);
    expect('buildingId' in resp).toBe(false);
  });
});
