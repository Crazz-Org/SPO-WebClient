/**
 * REQ_RESUME_SESSION and the fresh-login eviction at the handler frontier. The gateway owns the
 * park registry; the handlers only reach it through the two optional context callbacks.
 */
import { describe, it, expect, jest } from '@jest/globals';
import type { WebSocket } from 'ws';
import { WsMessageType, type WsMessage } from '../../../shared/types';
import { handleResumeSession, handleLoginWorld } from '../auth-handlers';
import { RESUME_REFUSED_CODE, RESUME_REFUSED_MESSAGE } from '../../session-park';
import type { WsHandlerContext } from '../types';

function wsRecorder(): { ws: WebSocket; sent: Array<Record<string, unknown>> } {
  const sent: Array<Record<string, unknown>> = [];
  const ws = { send: (p: string) => { sent.push(JSON.parse(p) as Record<string, unknown>); } } as unknown as WebSocket;
  return { ws, sent };
}

const resumeMsg = { type: WsMessageType.REQ_RESUME_SESSION, wsRequestId: 'r1', username: 'u', token: 't' } as unknown as WsMessage;

describe('handleResumeSession', () => {
  it('delegates to the gateway callback', async () => {
    const { ws, sent } = wsRecorder();
    const resumeSession = jest.fn(async (_req: unknown) => undefined);
    await handleResumeSession({ ws, resumeSession } as unknown as WsHandlerContext, resumeMsg);
    expect(resumeSession).toHaveBeenCalledWith(resumeMsg);
    expect(sent).toEqual([]);
  });

  it('refuses with the generic resume error when there is no gateway callback', async () => {
    const { ws, sent } = wsRecorder();
    await handleResumeSession({ ws } as unknown as WsHandlerContext, resumeMsg);
    expect(sent).toEqual([
      { type: WsMessageType.RESP_ERROR, wsRequestId: 'r1', errorMessage: RESUME_REFUSED_MESSAGE, code: RESUME_REFUSED_CODE },
    ]);
  });
});

describe('handleLoginWorld — eviction of a parked session', () => {
  function loginCtx(evict?: (u: string) => Promise<void>) {
    const order: string[] = [];
    const { ws } = wsRecorder();
    const session = {
      isWorldConnected: jest.fn(() => { order.push('isWorldConnected'); return false; }),
      getWorldInfo: jest.fn(() => ({ name: 'W', ip: '1.1.1.1', port: 1, url: '' })),
      setLanguageId: jest.fn(),
      loginWorld: jest.fn(async () => {
        order.push('loginWorld');
        return { tycoonId: '1', contextId: '2', companies: [], worldXSize: null, worldYSize: null, worldSeason: null };
      }),
      cleanupWorldSession: jest.fn(async () => undefined),
    };
    const ctx = { ws, session, evictParkedSession: evict } as unknown as WsHandlerContext;
    return { ctx, order, session };
  }
  const loginMsg = (username: unknown) =>
    ({ type: WsMessageType.REQ_LOGIN_WORLD, wsRequestId: 'l1', username, password: 'p', worldName: 'W' }) as unknown as WsMessage;

  it('awaits the eviction before anything reaches the world (loginWorld sends AccountStatus)', async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const evict = jest.fn((_u: string) => gate);
    const { ctx, order } = loginCtx(evict);

    const done = handleLoginWorld(ctx, loginMsg('SPO_test3'));
    await new Promise(r => setImmediate(r));
    expect(evict).toHaveBeenCalledWith('SPO_test3');
    expect(order).toEqual([]);

    order.push('evicted');
    release();
    await done;
    expect(order).toEqual(['evicted', 'isWorldConnected', 'loginWorld']);
  });

  it('skips the eviction for a non-string username, and without a callback', async () => {
    const evict = jest.fn(async (_u: string) => undefined);
    const a = loginCtx(evict);
    await handleLoginWorld(a.ctx, loginMsg(42));
    expect(evict).not.toHaveBeenCalled();

    const b = loginCtx(undefined);
    await handleLoginWorld(b.ctx, loginMsg('u'));
    expect(b.order).toContain('loginWorld');
  });
});
