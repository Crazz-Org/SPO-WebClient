/// <reference path="../../server/__tests__/matchers/rdo-matchers.d.ts" />

/**
 * `build-menu` scenario — the pending placeholder (issue 604).
 *
 * A delayed refusal must show the greyed placeholder the instant the request
 * leaves and remove it once the gateway's zone-mismatch answer lands — the
 * `finally` in `sendPlaceBuilding` is what clears it, on the browser side,
 * regardless of how long the round trip takes.
 */

jest.mock('@/client/bridge/client-bridge', () => ({ ClientBridge: { log: jest.fn() } }));

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
import { sendPlaceBuilding } from '@/client/handlers/build-menu-handler';
import type { ClientHandlerContext } from '@/client/handlers/client-context';
import { PendingPlacementLayer } from '@/client/renderer/pending-placements';
import type { BuildingInfo } from '@/shared/types';

/** Drive the gateway against the mock and return the RESP_ERROR it sent. */
async function driveGateway(): Promise<WsRespError> {
  const { rdo } = createBuildMenuScenario(undefined, { refusal: 'zone-mismatch' });

  const fake = makeSessionCtx({ sockets: ['world'] });
  Object.assign(fake.ctx, { currentCompany: { id: '28', name: 'PGI' } });

  const mock = new RdoMock();
  mock.addScenario(rdo);

  fake.respond((packet) => {
    const frame = `${RdoProtocol.format(packet as RdoPacket)};`;
    const r = mock.match(frame);
    return r ? (RdoProtocol.parse(r.response).payload ?? '') : new Error(`L1: no exchange for ${frame}`);
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
  expect(mock.getConsumedIds().has('bm-rdo-001')).toBe(true);
  return sent[0] as WsRespError;
}

const BUILDING: BuildingInfo = {
  name: 'Supermarket',
  facilityClass: CAPTURED_BUILD_ZONE_MISMATCH.facilityClass,
  visualClassId: '610',
  cost: 500000,
  area: 1,
  description: '',
  zoneRequirement: 'Commerce',
  iconPath: '',
  available: true,
};

describe('build-menu scenario — the pending placeholder', () => {
  it('a delayed refusal shows the placeholder and then removes it', async () => {
    const gatewayResponse = await driveGateway();
    expect(gatewayResponse.type).toBe(WsMessageType.RESP_ERROR);
    expect(gatewayResponse.code).toBe(ErrorCodes.ERROR_ZoneMissmatch);
    expect(gatewayResponse.errorMessage).toMatch(/zone/i);

    const layer = new PendingPlacementLayer();
    const renderer = {
      addPendingPlacement: (p: Parameters<PendingPlacementLayer['add']>[0]) => layer.add(p),
      removePendingPlacement: (key: string) => layer.remove(key),
      setPlacementMode: jest.fn(),
    };

    let rejectReq!: (err: Error) => void;
    const sendRequest = jest.fn(() => new Promise((_resolve, reject) => { rejectReq = reject; }));
    const ctx = {
      currentBuildingXSize: 1,
      currentBuildingYSize: 1,
      sendRequest,
      loadAlignedMapArea: jest.fn(),
      showNotification: jest.fn(),
      getRenderer: () => renderer,
      focusBuilding: jest.fn(),
    } as unknown as ClientHandlerContext;

    const done = sendPlaceBuilding(
      ctx,
      BUILDING,
      CAPTURED_BUILD_ZONE_MISMATCH.x,
      CAPTURED_BUILD_ZONE_MISMATCH.y,
    );

    // 1. while the answer is outstanding, the placeholder is up.
    expect(layer.size).toBe(1);
    expect(layer.list(0)[0]).toMatchObject({
      x: CAPTURED_BUILD_ZONE_MISMATCH.x,
      y: CAPTURED_BUILD_ZONE_MISMATCH.y,
    });

    // 2. reject with the coded Error client.ts:1107-1123 builds from a RESP_ERROR.
    const localizedMessage = getErrorMessage(gatewayResponse.code);
    const err = new Error(localizedMessage) as Error & { code: number; serverMessage: string };
    err.code = gatewayResponse.code;
    err.serverMessage = gatewayResponse.errorMessage;
    rejectReq(err);
    await done;

    // 3. the placeholder is gone, the area was never reloaded, and an error was shown.
    expect(layer.size).toBe(0);
    expect(ctx.loadAlignedMapArea).not.toHaveBeenCalled();
    expect(ctx.showNotification).toHaveBeenCalledWith(expect.any(String), 'error');
  });
});
