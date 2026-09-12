/**
 * Tests for context-status-handler — the camera-driven ask for the town's sentence.
 *
 * The cadence itself (a call from `sendCameraPositionNow`) is client.ts's; what
 * this file pins is what the handler does each time it is called: ask for the
 * renderer's rounded position, store whatever string comes back — including '',
 * which hides the strip (`Kernel/World.pas:4243`) — drop an answer the camera has
 * already moved past, and never turn a failed background poll into a notification.
 */

import { refreshContextStatus } from './context-status-handler';
import { useGameStore } from '../store/game-store';
import { WsMessageType } from '../../shared/types';
import type { ClientHandlerContext } from './client-context';
import type { WsRespContextStatus } from '../../shared/types';

jest.mock('../bridge/client-bridge', () => ({
  ClientBridge: { log: jest.fn() },
}));

import { ClientBridge } from '../bridge/client-bridge';

const SENTENCE = 'Helartia — population 12 480, ruled by SPO_test3';

function makeResp(text: string): WsRespContextStatus {
  return { type: WsMessageType.RESP_CONTEXT_STATUS, text };
}

function makeCtx(overrides: Partial<ClientHandlerContext> = {}): ClientHandlerContext {
  return {
    sendRequest: jest.fn().mockResolvedValue(makeResp(SENTENCE)),
    getRenderer: () => ({ getCameraPosition: () => ({ x: 472.4, y: 391.6 }) }) as never,
    nextGeneration: jest.fn().mockReturnValue(1),
    isCurrentGeneration: jest.fn().mockReturnValue(true),
    ...overrides,
  } as unknown as ClientHandlerContext;
}

describe('refreshContextStatus', () => {
  beforeEach(() => {
    useGameStore.getState().setContextStatusText('');
    (ClientBridge.log as jest.Mock).mockClear();
  });

  it('asks for the renderer camera position, rounded to whole tiles', async () => {
    const ctx = makeCtx();

    await refreshContextStatus(ctx);

    expect(ctx.sendRequest).toHaveBeenCalledWith({
      type: WsMessageType.REQ_CONTEXT_STATUS,
      x: 472,
      y: 392,
    });
  });

  it('stores the sentence the server answered', async () => {
    await refreshContextStatus(makeCtx());

    expect(useGameStore.getState().contextStatusText).toBe(SENTENCE);
  });

  it('stores the empty answer as-is — the strip hides itself on it', async () => {
    useGameStore.getState().setContextStatusText(SENTENCE);
    const ctx = makeCtx({ sendRequest: jest.fn().mockResolvedValue(makeResp('')) as never });

    await refreshContextStatus(ctx);

    expect(useGameStore.getState().contextStatusText).toBe('');
  });

  it('treats a response with no text field as empty rather than undefined', async () => {
    const ctx = makeCtx({
      sendRequest: jest.fn().mockResolvedValue({ type: WsMessageType.RESP_CONTEXT_STATUS }) as never,
    });

    await refreshContextStatus(ctx);

    expect(useGameStore.getState().contextStatusText).toBe('');
  });

  it('drops an answer the camera has already moved past', async () => {
    const ctx = makeCtx({ isCurrentGeneration: jest.fn().mockReturnValue(false) as never });

    await refreshContextStatus(ctx);

    expect(useGameStore.getState().contextStatusText).toBe('');
  });

  it('asks nothing before the renderer exists', async () => {
    const ctx = makeCtx({ getRenderer: () => null });

    await refreshContextStatus(ctx);

    expect(ctx.sendRequest).not.toHaveBeenCalled();
    expect(ctx.nextGeneration).not.toHaveBeenCalled();
  });

  it('logs a failed poll and leaves the stored text untouched', async () => {
    useGameStore.getState().setContextStatusText(SENTENCE);
    const ctx = makeCtx({
      sendRequest: jest.fn().mockRejectedValue(new Error('Request timeout')) as never,
    });

    await expect(refreshContextStatus(ctx)).resolves.toBeUndefined();

    expect(useGameStore.getState().contextStatusText).toBe(SENTENCE);
    expect(ClientBridge.log).toHaveBeenCalledWith('Map', expect.stringContaining('Request timeout'));
  });
});
