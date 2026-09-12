/**
 * REQ_CONNECTION_REACHABILITY — the WebSocket frontier for the road-reachability
 * sweep (issue #584). The frontier forwards the four request fields to the
 * session unchanged, relays each batch `resolveConnectionReachability` produces
 * as its own frame with the request's identity echoed (so a late or stale batch
 * is recognisable), and turns a session failure into an error frame.
 */

import { describe, it, expect, jest } from '@jest/globals';
import type { WebSocket } from 'ws';
import { WsMessageType, type WsMessage } from '../../../shared/types';
import { handleConnectionReachability } from '../misc-handlers';
import type { WsHandlerContext } from '../types';

interface Recorded {
  ctx: WsHandlerContext;
  sent: Array<Record<string, unknown>>;
  resolveConnectionReachability: jest.Mock<(bx: number, by: number, candidates: unknown[], onBatch?: (entries: unknown[]) => void) => Promise<unknown[]>>;
}

function createCtx(
  behavior: (onBatch: (entries: unknown[]) => void) => Promise<unknown[]>,
): Recorded {
  const sent: Array<Record<string, unknown>> = [];
  const ws = {
    send(payload: string): void {
      sent.push(JSON.parse(payload) as Record<string, unknown>);
    },
  } as unknown as WebSocket;

  const resolveConnectionReachability = jest.fn(
    async (_bx: number, _by: number, _candidates: unknown[], onBatch?: (entries: unknown[]) => void) =>
      behavior(entries => onBatch?.(entries))
  );

  const ctx = { ws, session: { resolveConnectionReachability } } as unknown as WsHandlerContext;
  return { ctx, sent, resolveConnectionReachability };
}

const request = (over: Partial<Record<string, unknown>> = {}): WsMessage => ({
  type: WsMessageType.REQ_CONNECTION_REACHABILITY,
  wsRequestId: 'req-1',
  buildingX: 706,
  buildingY: 436,
  fluidId: 'Cotton',
  direction: 'input',
  candidates: [{ x: 480, y: 392 }, { x: 600, y: 700 }],
  ...over,
}) as unknown as WsMessage;

describe('handleConnectionReachability', () => {
  it('forwards the four request fields to the session unchanged', async () => {
    const r = createCtx(async onBatch => {
      onBatch([]);
      return [];
    });

    await handleConnectionReachability(r.ctx, request());

    expect(r.resolveConnectionReachability).toHaveBeenCalledWith(
      706, 436,
      [{ x: 480, y: 392 }, { x: 600, y: 700 }],
      expect.any(Function),
    );
  });

  it('relays each batch as its own frame with the identity echoed', async () => {
    const r = createCtx(async onBatch => {
      onBatch([{ x: 480, y: 392, reachability: 'connected' }]);
      onBatch([{ x: 600, y: 700, reachability: 'isolated' }]);
      return [
        { x: 480, y: 392, reachability: 'connected' },
        { x: 600, y: 700, reachability: 'isolated' },
      ];
    });

    await handleConnectionReachability(r.ctx, request());

    expect(r.sent).toHaveLength(2);
    for (const frame of r.sent) {
      expect(frame.type).toBe(WsMessageType.RESP_CONNECTION_REACHABILITY);
      expect(frame.wsRequestId).toBe('req-1');
      expect(frame.buildingX).toBe(706);
      expect(frame.buildingY).toBe(436);
      expect(frame.fluidId).toBe('Cotton');
      expect(frame.direction).toBe('input');
    }
    expect(r.sent[0].entries).toEqual([{ x: 480, y: 392, reachability: 'connected' }]);
    expect(r.sent[1].entries).toEqual([{ x: 600, y: 700, reachability: 'isolated' }]);
  });

  it('turns a session failure into an error frame and no reachability frame', async () => {
    const r = createCtx(async () => {
      throw new Error('Request timeout: SetObject');
    });

    await handleConnectionReachability(r.ctx, request());

    expect(r.sent).toHaveLength(1);
    expect(r.sent[0].type).toBe(WsMessageType.RESP_ERROR);
    expect(r.sent[0].wsRequestId).toBe('req-1');
  });
});
