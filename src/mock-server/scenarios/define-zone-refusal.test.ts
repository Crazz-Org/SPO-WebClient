/// <reference path="../../server/__tests__/matchers/rdo-matchers.d.ts" />

/**
 * `define-zone` scenario — driven through the real gateway AND the real client
 * handler, end to end.
 *
 * Proves an `ERROR_Unknown` `DefineZone` reply reaches the player as an error
 * notification naming the server's code, never the success toast — and that a
 * `NOERROR` reply produces that toast, worded as a request rather than a
 * guarantee (`Kernel/World.pas:4544-4546`: per-tile refusals are silent).
 */

jest.mock('@/client/bridge/client-bridge', () => ({ ClientBridge: { log: jest.fn() } }));
jest.mock('@/client/handlers/handler-utils', () => ({ setupEscapeHandler: jest.fn() }));

import { RdoProtocol } from '@/server/rdo';
import type { RdoPacket, WsMessage, WsRespDefineZone, WsReqDefineZone } from '@/shared/types';
import { WsMessageType } from '@/shared/types';
import { makeSessionCtx } from '@/server/__tests__/session/fake-session-context';
import { handleDefineZone } from '@/server/ws-handlers/misc-handlers';
import { defineZone } from '@/server/session/zone-surface-handler';
import type { WsHandlerContext } from '@/server/ws-handlers/types';
import { RdoMock } from '../rdo-mock';
import {
  createDefineZoneScenario,
  CAPTURED_DEFINE_ZONE_REFUSED,
  CAPTURED_DEFINE_ZONE_SUCCESS,
} from './define-zone-scenario';
import { toggleZonePaintingMode } from '@/client/handlers/zone-handler';
import type { ClientHandlerContext } from '@/client/handlers/client-context';

describe('define-zone scenario — server and client together', () => {
  function makeClientCtx() {
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
      sendRequest: jest.fn(),
      showNotification: jest.fn(),
    } as unknown as ClientHandlerContext;
    return { ctx, renderer };
  }

  async function driveWs(d: typeof CAPTURED_DEFINE_ZONE_SUCCESS, refusal?: 'unknown') {
    const scenario = createDefineZoneScenario(undefined, refusal ? { refusal } : undefined);
    const fake = makeSessionCtx({ sockets: ['world'] });

    const mock = new RdoMock();
    mock.addScenario(scenario.rdo);

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

    const req: WsReqDefineZone = {
      type: WsMessageType.REQ_DEFINE_ZONE,
      wsRequestId: 'req-dz-1',
      zoneId: d.zoneId,
      x1: d.x1,
      y1: d.y1,
      x2: d.x2,
      y2: d.y2,
    };

    await handleDefineZone(ctx, req);

    expect(sent).toHaveLength(1);
    const resp = sent[0] as WsRespDefineZone;
    expect(resp.type).toBe(WsMessageType.RESP_DEFINE_ZONE);
    expect(mock.getConsumedIds().has('dz-rdo-001')).toBe(true);

    return resp;
  }

  it('passes strict RDO validation', () => {
    const { rdo } = createDefineZoneScenario(undefined, { refusal: 'unknown' });
    expect(rdo).toPassStrictRdoValidation();
  });

  it('an ERROR_Unknown reply reaches the player as an error notification, not the success toast', async () => {
    const resp = await driveWs(CAPTURED_DEFINE_ZONE_REFUSED, 'unknown');
    expect(resp.success).toBe(false);
    expect(resp.message).toMatch(/error 1/);
    expect(resp.message).toContain('Unknown error');

    const { ctx, renderer } = makeClientCtx();
    (ctx.sendRequest as jest.Mock).mockResolvedValue(resp);
    toggleZonePaintingMode(ctx, CAPTURED_DEFINE_ZONE_REFUSED.zoneId);
    const cb = renderer.setZoneAreaCompleteCallback.mock.calls[0][0] as
      (x1: number, y1: number, x2: number, y2: number) => Promise<void>;
    await cb(CAPTURED_DEFINE_ZONE_REFUSED.x1, CAPTURED_DEFINE_ZONE_REFUSED.y1, CAPTURED_DEFINE_ZONE_REFUSED.x2, CAPTURED_DEFINE_ZONE_REFUSED.y2);

    expect(ctx.showNotification).toHaveBeenCalledTimes(1);
    expect(ctx.showNotification).toHaveBeenCalledWith(resp.message, 'error');
    expect(ctx.showNotification).not.toHaveBeenCalledWith(expect.any(String), 'success');
  });

  it('a NOERROR reply produces the success toast', async () => {
    const resp = await driveWs(CAPTURED_DEFINE_ZONE_SUCCESS);
    expect(resp.success).toBe(true);

    const { ctx, renderer } = makeClientCtx();
    (ctx.sendRequest as jest.Mock).mockResolvedValue(resp);
    toggleZonePaintingMode(ctx, CAPTURED_DEFINE_ZONE_SUCCESS.zoneId);
    const cb = renderer.setZoneAreaCompleteCallback.mock.calls[0][0] as
      (x1: number, y1: number, x2: number, y2: number) => Promise<void>;
    await cb(CAPTURED_DEFINE_ZONE_SUCCESS.x1, CAPTURED_DEFINE_ZONE_SUCCESS.y1, CAPTURED_DEFINE_ZONE_SUCCESS.x2, CAPTURED_DEFINE_ZONE_SUCCESS.y2);

    expect(ctx.showNotification).toHaveBeenCalledWith('Zone requested: 9 tiles', 'success');
  });
});
