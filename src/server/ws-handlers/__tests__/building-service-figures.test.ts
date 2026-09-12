/**
 * REQ_BUILDING_SERVICE_FIGURES — the General tab's live Offer / Demand poll, at
 * the WebSocket frontier.
 *
 * The message carries one index, and that index becomes the single integer
 * argument of RDOGetDemand / RDOGetSupply. The frontier's job is to pass the
 * triple through unchanged, echo it back so a late reply can be routed or
 * dropped, and refuse an index that `RdoValue.int` would throw on — before the
 * session is reached.
 */

import { describe, it, expect, jest } from '@jest/globals';
import type { WebSocket } from 'ws';
import { WsMessageType, type WsMessage } from '../../../shared/types';
import { ERROR_InvalidParameter } from '../../../shared/error-codes';
import { handleBuildingServiceFigures } from '../building-handlers';
import type { WsHandlerContext } from '../types';

interface Recorded {
  ctx: WsHandlerContext;
  sent: Array<Record<string, unknown>>;
  getBuildingServiceFigures: jest.Mock;
}

function createCtx(result: unknown = { supply: '64', demand: '37' }): Recorded {
  const sent: Array<Record<string, unknown>> = [];
  const ws = {
    send(payload: string): void {
      sent.push(JSON.parse(payload) as Record<string, unknown>);
    },
  } as unknown as WebSocket;

  const getBuildingServiceFigures = jest.fn(async () => {
    if (result instanceof Error) throw result;
    return result;
  });

  const ctx = { ws, session: { getBuildingServiceFigures } } as unknown as WsHandlerContext;
  return { ctx, sent, getBuildingServiceFigures };
}

const request = (over: Partial<Record<string, unknown>> = {}): WsMessage => ({
  type: WsMessageType.REQ_BUILDING_SERVICE_FIGURES,
  wsRequestId: 'req-1',
  x: 924,
  y: 820,
  serviceIndex: 1,
  ...over,
}) as unknown as WsMessage;

describe('handleBuildingServiceFigures', () => {
  it('passes the coordinates and the service index to the session unchanged', async () => {
    const r = createCtx();

    await handleBuildingServiceFigures(r.ctx, request());

    expect(r.getBuildingServiceFigures).toHaveBeenCalledWith(924, 820, 1);
  });

  it('echoes the identity back with both figures', async () => {
    // The client drops a reply whose index is no longer the selected one, so
    // the index has to travel back with the numbers it belongs to.
    const r = createCtx();

    await handleBuildingServiceFigures(r.ctx, request());

    expect(r.sent).toHaveLength(1);
    expect(r.sent[0]).toEqual({
      type: WsMessageType.RESP_BUILDING_SERVICE_FIGURES,
      wsRequestId: 'req-1',
      x: 924,
      y: 820,
      serviceIndex: 1,
      supply: '64',
      demand: '37',
    });
  });

  it('carries an empty answer through as empty, not as a zero', async () => {
    const r = createCtx({ supply: '', demand: '' });

    await handleBuildingServiceFigures(r.ctx, request());

    expect(r.sent[0].supply).toBe('');
    expect(r.sent[0].demand).toBe('');
  });

  it.each([
    ['a negative index', -1],
    ['a fractional index', 1.5],
    ['a numeric string', '0'],
    ['a missing index', undefined],
  ])('refuses %s without reaching the session', async (_label, serviceIndex) => {
    const r = createCtx();

    await handleBuildingServiceFigures(r.ctx, request({ serviceIndex }));

    expect(r.getBuildingServiceFigures).not.toHaveBeenCalled();
    expect(r.sent).toHaveLength(1);
    expect(r.sent[0].type).toBe(WsMessageType.RESP_ERROR);
    expect(r.sent[0].code).toBe(ERROR_InvalidParameter);
  });

  it('turns a session failure into an error frame instead of a hung request', async () => {
    const r = createCtx(new Error('Request timeout: RDOGetDemand'));

    await handleBuildingServiceFigures(r.ctx, request());

    expect(r.sent).toHaveLength(1);
    expect(r.sent[0].type).toBe(WsMessageType.RESP_ERROR);
    expect(r.sent[0].wsRequestId).toBe('req-1');
  });
});
