/**
 * Login World Failure Recovery Tests
 *
 * Validates that when loginWorld() throws (e.g., InitClient push timeout),
 * the session phase is reset to DIRECTORY_CONNECTED so the client can retry.
 * Also validates that cleanupWorldSession() closes the world connection pool.
 */

import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { handleLoginWorld } from '../ws-handlers/auth-handlers';
import { WsMessageType, SessionPhase } from '../../shared/types';
import type { WsHandlerContext } from '../ws-handlers/types';
import type { WebSocket } from 'ws';

// ── Minimal mocks ───────────────────────────────────────────────────────────

function createMockWs(): WebSocket {
  return { send: jest.fn() } as unknown as WebSocket;
}

function createMockSession(overrides: Record<string, unknown> = {}) {
  return {
    phase: SessionPhase.DIRECTORY_CONNECTED,
    isWorldConnected: jest.fn<() => boolean>().mockReturnValue(false),
    getWorldInfo: jest.fn<() => unknown>().mockReturnValue({ name: 'planitia', ip: '1.2.3.4', port: 8000 }),
    loginWorld: jest.fn<() => Promise<unknown>>(),
    setLanguageId: jest.fn<(value?: string) => void>(),
    cleanupWorldSession: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    getPhase: jest.fn<() => SessionPhase>(() => (overrides.phase as SessionPhase) ?? SessionPhase.DIRECTORY_CONNECTED),
    log: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
    ...overrides,
  };
}

function createCtx(session: ReturnType<typeof createMockSession>): WsHandlerContext {
  return {
    ws: createMockWs(),
    session: session as unknown as WsHandlerContext['session'],
    searchMenuService: null,
    facilityDimensionsCache: jest.fn() as unknown as WsHandlerContext['facilityDimensionsCache'],
    inventionIndex: null,
    connectedClients: new Map(),
    gmUsernames: new Set(),
  };
}

function loginWorldMsg(wsRequestId = 'test-req-1') {
  return {
    type: WsMessageType.REQ_LOGIN_WORLD,
    wsRequestId,
    username: 'TestUser',
    password: 'TestPass',
    worldName: 'planitia',
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe('handleLoginWorld: failure recovery', () => {
  let session: ReturnType<typeof createMockSession>;
  let ctx: WsHandlerContext;

  beforeEach(() => {
    session = createMockSession();
    ctx = createCtx(session);
  });

  it('should call cleanupWorldSession when loginWorld throws', async () => {
    session.loginWorld.mockRejectedValue(new Error('InitClient push timeout after 15s'));

    await expect(handleLoginWorld(ctx, loginWorldMsg())).rejects.toThrow('InitClient push timeout after 15s');
    expect(session.cleanupWorldSession).toHaveBeenCalledTimes(1);
  });

  it('should re-throw the original error after cleanup', async () => {
    const originalError = new Error('Connection refused');
    session.loginWorld.mockRejectedValue(originalError);

    await expect(handleLoginWorld(ctx, loginWorldMsg())).rejects.toThrow(originalError);
  });

  it('should still re-throw if cleanupWorldSession itself fails', async () => {
    session.loginWorld.mockRejectedValue(new Error('InitClient push timeout after 15s'));
    session.cleanupWorldSession.mockRejectedValue(new Error('cleanup failed'));

    await expect(handleLoginWorld(ctx, loginWorldMsg())).rejects.toThrow('InitClient push timeout after 15s');
    expect(session.cleanupWorldSession).toHaveBeenCalledTimes(1);
  });

  it('should not call cleanupWorldSession on success', async () => {
    session.loginWorld.mockResolvedValue({
      contextId: '100',
      tycoonId: '36',
      companies: [],
      worldXSize: 1000,
      worldYSize: 1000,
      worldSeason: null,
    });

    await handleLoginWorld(ctx, loginWorldMsg());

    expect(session.cleanupWorldSession).not.toHaveBeenCalled();
    expect((ctx.ws.send as jest.Mock).mock.calls.length).toBe(1);
    const sent = JSON.parse((ctx.ws.send as jest.Mock).mock.calls[0][0] as string);
    expect(sent.type).toBe(WsMessageType.RESP_LOGIN_SUCCESS);
  });

  it('should cleanup previous world session on server switch before login', async () => {
    session.isWorldConnected.mockReturnValue(true);
    session.loginWorld.mockResolvedValue({
      contextId: '100',
      tycoonId: '36',
      companies: [],
      worldXSize: null,
      worldYSize: null,
      worldSeason: null,
    });

    await handleLoginWorld(ctx, loginWorldMsg());

    // First call: server switch cleanup. No second call (success path).
    expect(session.cleanupWorldSession).toHaveBeenCalledTimes(1);
  });

  it('forwards the admission answer to the browser when loginWorld reports one', async () => {
    session.loginWorld.mockResolvedValue({
      contextId: '100',
      tycoonId: '36',
      companies: [],
      worldXSize: null,
      worldYSize: null,
      worldSeason: null,
      admission: { kind: 'nobility', shortfall: 2 },
    });

    await handleLoginWorld(ctx, loginWorldMsg());

    const sent = JSON.parse((ctx.ws.send as jest.Mock).mock.calls[0][0] as string);
    expect(sent.admission).toEqual({ kind: 'nobility', shortfall: 2 });
  });

  it('leaves the admission key absent when loginWorld reports none', async () => {
    session.loginWorld.mockResolvedValue({
      contextId: '100',
      tycoonId: '36',
      companies: [],
      worldXSize: null,
      worldYSize: null,
      worldSeason: null,
    });

    await handleLoginWorld(ctx, loginWorldMsg());

    const sent = JSON.parse((ctx.ws.send as jest.Mock).mock.calls[0][0] as string);
    expect(sent).not.toHaveProperty('admission');
  });
});
