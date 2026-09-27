/// <reference path="../../server/__tests__/matchers/rdo-matchers.d.ts" />

/**
 * `build-menu` refusal form — driven through the real gateway.
 *
 * Proves the notification a player sees for a mismatched-zone placement names
 * the zone (ERROR_ZoneMissmatch, 28), not the "area not clear" constant the
 * ws handler used to send regardless of what the server actually refused.
 */

import { RdoProtocol } from '@/server/rdo';
import type { RdoPacket, WsMessage, WsRespError } from '@/shared/types';
import { WsMessageType } from '@/shared/types';
import * as ErrorCodes from '@/shared/error-codes';
import { getErrorMessage } from '@/shared/error-codes';
import { makeSessionCtx } from '@/server/__tests__/session/fake-session-context';
import { handlePlaceBuilding } from '@/server/ws-handlers/building-handlers';
import { placeBuilding } from '@/server/session/building-templates-handler';
import type { WsHandlerContext } from '@/server/ws-handlers/types';
import { RdoMock } from '../rdo-mock';
import { createBuildMenuScenario, CAPTURED_BUILD_ZONE_MISMATCH } from './build-menu-scenario';

describe('build-menu scenario — zone mismatch refusal', () => {
  const { rdo } = createBuildMenuScenario(undefined, { refusal: 'zone-mismatch' });

  it('the client notification names the zone, not the area', async () => {
    const fake = makeSessionCtx({ sockets: ['world'] });
    Object.assign(fake.ctx, { currentCompany: { id: '28', name: 'PGI' } });

    const mock = new RdoMock();
    mock.addScenario(rdo);

    fake.respond((packet) => {
      const frame = `${RdoProtocol.format(packet as RdoPacket)};`;
      const r = mock.match(frame);
      if (!r) return new Error(`L1: no exchange for ${frame}`);
      return RdoProtocol.parse(r.response).payload ?? '';
    });

    const sent: WsMessage[] = [];
    const ctx = {
      ws: { send: (payload: string) => sent.push(JSON.parse(payload) as WsMessage) },
      session: {
        placeBuilding: (facilityClass: string, x: number, y: number) =>
          placeBuilding(fake.ctx, facilityClass, x, y),
      },
    } as unknown as WsHandlerContext;

    const req: WsMessage = {
      type: WsMessageType.REQ_PLACE_BUILDING,
      wsRequestId: 'req-1',
      facilityClass: CAPTURED_BUILD_ZONE_MISMATCH.facilityClass,
      x: CAPTURED_BUILD_ZONE_MISMATCH.x,
      y: CAPTURED_BUILD_ZONE_MISMATCH.y,
    } as unknown as WsMessage;

    await handlePlaceBuilding(ctx, req);

    expect(sent).toHaveLength(1);
    const resp = sent[0] as WsRespError;
    expect(resp.type).toBe(WsMessageType.RESP_ERROR);
    expect(resp.code).toBe(ErrorCodes.ERROR_ZoneMissmatch);
    expect(resp.errorMessage).toMatch(/zone/i);
    expect(resp.errorMessage).not.toMatch(/area/i);
    expect(getErrorMessage(resp.code)).toBe(resp.errorMessage);

    expect(mock.getConsumedIds().has('bm-rdo-001')).toBe(true);

    // The one frame production emitted: on the world context, class, company, x, y.
    const frames = fake.sent.map(s => `${RdoProtocol.format(s.packet as RdoPacket)};`);
    expect(frames).toEqual(['C sel 8161308 call NewFacility "^" "%PGISupermarketC","#28","#200","#300";']);
    expect(frames).toPassStrictRdoValidation(rdo);
  });
});
