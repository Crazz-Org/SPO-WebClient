/**
 * `move-to` — the fake Interface Server's MoveTo push, driven through the real gateway
 * dispatcher and the real client dispatcher, end to end.
 */

jest.mock('../../client/bridge/client-bridge', () => ({
  ClientBridge: {
    log: jest.fn(),
  },
}));

import { WsMessageType, type WsMessage, type WsEventMoveTo } from '@/shared/types';
import { RdoProtocol } from '../../server/rdo';
import { makePushCtx } from '../../server/__tests__/session/fake-session-context';
import { dispatchPush } from '../../server/session/push-dispatcher';
import { dispatchEvent } from '../../client/handlers/event-handler';
import { useMapStore } from '../../client/store/map-store';
import type { ClientHandlerContext } from '../../client/handlers/client-context';
import { createMoveToScenario, CAPTURED_MOVE_TO } from './move-to-scenario';
import { loadScenario } from './scenario-registry';

describe('move-to scenario', () => {
  beforeEach(() => {
    useMapStore.getState().reset();
  });

  it('is a push-only exchange with no client request', () => {
    const { rdo } = createMoveToScenario();
    const exchange = rdo.exchanges[0];

    expect(exchange.pushOnly).toBe(true);
    expect(exchange.request).toBe('');
  });

  it('parses as a MoveTo push', () => {
    const { rdo } = createMoveToScenario();
    const packet = RdoProtocol.parse(rdo.exchanges[0].response);

    expect(packet.type).toBe('PUSH');
    expect(packet.member).toBe('MoveTo');
  });

  it('moves the client camera end to end', () => {
    const { rdo } = createMoveToScenario();
    const packet = RdoProtocol.parse(rdo.exchanges[0].response);

    const fake = makePushCtx();
    dispatchPush(fake.ctx, 'world', packet);

    expect(fake.emit).toHaveBeenCalledTimes(1);
    const [wsType, event] = fake.emit.mock.calls[0];
    expect(wsType).toBe('ws_event');
    expect(event).toEqual({
      type: WsMessageType.EVENT_MOVE_TO,
      x: CAPTURED_MOVE_TO.x,
      y: CAPTURED_MOVE_TO.y,
    } as WsEventMoveTo);

    const renderer = { centerOn: jest.fn() };
    const ctx = {
      getRenderer: () => renderer,
      soundManager: { play: jest.fn() },
    } as unknown as ClientHandlerContext;

    dispatchEvent(ctx, event as WsMessage);

    expect(renderer.centerOn).toHaveBeenCalledWith(CAPTURED_MOVE_TO.x, CAPTURED_MOVE_TO.y);
    expect(useMapStore.getState().history).toEqual([CAPTURED_MOVE_TO]);
  });

  it('is registered in the scenario registry', () => {
    const bundle = loadScenario('move-to');

    expect(bundle.rdo!.exchanges).toHaveLength(1);
  });
});
