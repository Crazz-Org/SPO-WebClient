/// <reference path="../../server/__tests__/matchers/rdo-matchers.d.ts" />

/**
 * `define-zone` — driven through the real gateway handler and the real
 * browser handler (issue 586).
 *
 * `DefineZone` is a `"^"` function answering `res="#<code>"`; per-tile
 * refusals inside an accepted call are silent
 * (`Kernel/World.pas:4544-4546`), so the reply only ever says "the call was
 * accepted or refused", never "N tiles were painted". This proves that an
 * `ERROR_Unknown` reply reaches the player as an error notification, not a
 * success toast, and that an accepted call shows the tiles *requested*.
 */

jest.mock('@/client/bridge/client-bridge', () => ({ ClientBridge: { log: jest.fn() } }));
jest.mock('@/client/handlers/handler-utils', () => ({ setupEscapeHandler: jest.fn() }));

import { RdoProtocol } from '@/server/rdo';
import type { RdoPacket, WsMessage } from '@/shared/types';
import { WsMessageType } from '@/shared/types';
import type { WsRespDefineZone } from '@/shared/types';
import * as ErrorCodes from '@/shared/error-codes';
import { makeSessionCtx } from '@/server/__tests__/session/fake-session-context';
import { handleDefineZone } from '@/server/ws-handlers/misc-handlers';
import { defineZone } from '@/server/session/zone-surface-handler';
import type { WsHandlerContext } from '@/server/ws-handlers/types';
import { RdoMock } from '../rdo-mock';
import { createDefineZoneScenario } from './define-zone-scenario';
import { toggleZonePaintingMode } from '@/client/handlers/zone-handler';
import type { ClientHandlerContext } from '@/client/handlers/client-context';

/** Drive the real gateway handler over the mock and return what it sent to the browser. */
async function driveGateway(result: number): Promise<WsRespDefineZone> {
  const { rdo } = createDefineZoneScenario(undefined, { result });

  const fake = makeSessionCtx({ sockets: ['world'] });

  const mock = new RdoMock();
  mock.addScenario(rdo);

  fake.respond((packet) => {
    const frame = `${RdoProtocol.format(packet as RdoPacket)};`;
    const r = mock.match(frame);
    return r ? (RdoProtocol.parse(r.response).payload ?? '') : '';
  });

  const sent: WsMessage[] = [];
  const ctx = {
    ws: { send: (payload: string) => sent.push(JSON.parse(payload) as WsMessage) },
    session: {
      defineZone: (zoneId: number, x1: number, y1: number, x2: number, y2: number) =>
        defineZone(fake.ctx, zoneId, x1, y1, x2, y2),
    },
  } as unknown as WsHandlerContext;

  const req: WsMessage = {
    type: WsMessageType.REQ_DEFINE_ZONE,
    wsRequestId: 'req-1',
    zoneId: 2,
    x1: 100, y1: 100, x2: 102, y2: 102,
  } as unknown as WsMessage;

  await handleDefineZone(ctx, req);

  expect(sent).toHaveLength(1);
  expect(mock.getConsumedIds().has('dz-rdo-001')).toBe(true);
  // The fixture request is byte-for-byte the frame production emitted.
  const frames = fake.sent.map(s => `${RdoProtocol.format(s.packet as RdoPacket)};`);
  expect(frames.map(f => mock.match(f)!.exchange.id)).toEqual(['dz-rdo-001']);
  expect(frames).toEqual(frames.map(f => mock.match(f)!.exchange.request));
  return sent[0] as WsRespDefineZone;
}

/** Feed the gateway's response into the real browser handler and capture the notification. */
async function driveBrowser(response: WsRespDefineZone) {
  const renderer = {
    setZonePaintingMode: jest.fn(),
    setZoneAreaCompleteCallback: jest.fn(),
    setCancelZonePaintingCallback: jest.fn(),
  };
  const ctx = {
    isZonePaintingMode: false,
    selectedZoneType: 0,
    isRoadBuildingMode: false,
    isRoadDemolishMode: false,
    currentBuildingToPlace: null,
    isCityZonesEnabled: false,
    activeOverlayType: null,
    overlayBeforePlacement: { type: 'none' },
    toggleZoneOverlay: jest.fn(),
    getRenderer: () => renderer,
    cancelRoadBuildingMode: jest.fn(),
    cancelRoadDemolishMode: jest.fn(),
    cancelBuildingPlacement: jest.fn(),
    sendRequest: jest.fn().mockResolvedValue(response),
    showNotification: jest.fn(),
  } as unknown as ClientHandlerContext;

  toggleZonePaintingMode(ctx, 2);
  const complete = renderer.setZoneAreaCompleteCallback.mock.calls[0][0] as
    (x1: number, y1: number, x2: number, y2: number) => Promise<void>;

  await complete(100, 100, 102, 102);

  return ctx;
}

describe('define-zone scenario', () => {
  it('passes strict RDO validation', () => {
    const { rdo } = createDefineZoneScenario();
    expect(rdo).toPassStrictRdoValidation();
  });

  it('an ERROR_Unknown reply produces an error notification, not a success toast', async () => {
    const gatewayResponse = await driveGateway(ErrorCodes.ERROR_Unknown);
    expect(gatewayResponse.success).toBe(false);
    expect(gatewayResponse.errorCode).toBe(ErrorCodes.ERROR_Unknown);
    expect(gatewayResponse.message).toMatch(/code 1/);

    const ctx = await driveBrowser(gatewayResponse);
    expect(ctx.showNotification).toHaveBeenCalledWith(gatewayResponse.message, 'error');
    expect(ctx.showNotification).not.toHaveBeenCalledWith(expect.anything(), 'success');
  });

  it('a NOERROR reply shows one success toast naming the requested tiles, no error', async () => {
    const gatewayResponse = await driveGateway(ErrorCodes.NOERROR);
    expect(gatewayResponse.success).toBe(true);
    expect(gatewayResponse.errorCode).toBeUndefined();

    const ctx = await driveBrowser(gatewayResponse);
    expect(ctx.showNotification).toHaveBeenCalledTimes(1);
    expect(ctx.showNotification).toHaveBeenCalledWith('Zone requested: 9 tiles', 'success');
  });
});
