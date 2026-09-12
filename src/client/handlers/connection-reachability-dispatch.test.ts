/**
 * RESP_CONNECTION_REACHABILITY (#584) reaches ClientBridge.updateConnectionReachability
 * with the message object, same as every other bridge-forwarding case in
 * `event-handler.ts`.
 */

jest.mock('../bridge/client-bridge', () => ({
  ClientBridge: {
    updateConnectionReachability: jest.fn(),
  },
}));

import { WsMessageType, type WsMessage, type WsRespConnectionReachability } from '@/shared/types';
import { dispatchEvent } from './event-handler';
import { ClientBridge } from '../bridge/client-bridge';
import type { ClientHandlerContext } from './client-context';

function makeCtx() {
  const ctx = {
    sendMessage: jest.fn(),
    soundManager: { play: jest.fn() },
  } as unknown as ClientHandlerContext;
  return ctx;
}

describe('RESP_CONNECTION_REACHABILITY dispatch', () => {
  it('reaches ClientBridge.updateConnectionReachability with the message object', () => {
    const msg = {
      type: WsMessageType.RESP_CONNECTION_REACHABILITY,
      wsRequestId: 'r1',
      fluidId: 'oil-1',
      direction: 'input',
      buildingX: 100,
      buildingY: 200,
      entries: [{ x: 10, y: 20, connected: true }],
    } as unknown as WsRespConnectionReachability;

    dispatchEvent(makeCtx(), msg as unknown as WsMessage);

    expect(ClientBridge.updateConnectionReachability).toHaveBeenCalledWith(msg);
  });
});
