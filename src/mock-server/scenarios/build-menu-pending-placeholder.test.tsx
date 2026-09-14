/// <reference path="../../server/__tests__/matchers/rdo-matchers.d.ts" />

/**
 * `build-menu` pending-placeholder form — driven through the real gateway and
 * the real browser handler (issue 604).
 *
 * A delayed refusal must show the optimistic placeholder the moment the click
 * leaves, then take it away again once the (delayed) `ERROR_ZoneMissmatch`
 * answer lands — never leaving the map with a placeholder outliving its
 * request, and never reaching `loadAlignedMapArea` on a refusal.
 */

jest.mock('@/client/bridge/client-bridge', () => ({ ClientBridge: { log: jest.fn() } }));
jest.mock('@/client/handlers/handler-utils', () => ({ setupEscapeHandler: jest.fn() }));

import { RdoProtocol } from '@/server/rdo';
import type { RdoPacket, WsMessage, WsRespError } from '@/shared/types';
import { WsMessageType } from '@/shared/types';
import * as ErrorCodes from '@/shared/error-codes';
import { getErrorMessage } from '@/shared/error-codes';
import { makeSessionCtx } from '@/server/__tests__/session/fake-session-context';
import { handlePlaceBuilding } from '@/server/ws-handlers/building-handlers';
import { placeBuilding as serverPlaceBuilding } from '@/server/session/building-templates-handler';
import type { WsHandlerContext } from '@/server/ws-handlers/types';
import { RdoMock } from '../rdo-mock';
import { createBuildMenuScenario, CAPTURED_BUILD_ZONE_MISMATCH } from './build-menu-scenario';
import { placeBuilding } from '@/client/handlers/build-menu-handler';
import type { ClientHandlerContext } from '@/client/handlers/client-context';

/** Drive the real gateway handler over the mock and return the RESP_ERROR it sent. */
async function driveGateway(): Promise<WsRespError> {
  const { rdo } = createBuildMenuScenario(undefined, { refusal: 'zone-mismatch' });

  const fake = makeSessionCtx({ sockets: ['world'] });
  Object.assign(fake.ctx, { currentCompany: { id: '28', name: 'PGI' } });

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
      placeBuilding: (facilityClass: string, x: number, y: number) =>
        serverPlaceBuilding(fake.ctx, facilityClass, x, y),
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

describe('build-menu scenario — pending placeholder (#604)', () => {
  beforeEach(() => {
    sessionStorage.setItem('spo.dialog.dontAsk.build', '1');
  });

  it('a delayed refusal shows the placeholder, then removes it', async () => {
    const gatewayResponse = await driveGateway();
    expect(gatewayResponse.type).toBe(WsMessageType.RESP_ERROR);
    expect(gatewayResponse.code).toBe(ErrorCodes.ERROR_ZoneMissmatch);

    const renderer = {
      addPendingPlacement: jest.fn().mockReturnValue(`${CAPTURED_BUILD_ZONE_MISMATCH.x},${CAPTURED_BUILD_ZONE_MISMATCH.y}`),
      removePendingPlacement: jest.fn(),
      setPlacementMode: jest.fn(),
    };

    let settleSendRequest!: (err: Error) => void;
    const sendRequest = jest.fn().mockImplementation(
      () => new Promise((_resolve, reject) => { settleSendRequest = reject; }),
    );

    const ctx = {
      currentBuildingToPlace: {
        name: 'Supermarket',
        cost: 500_000,
        facilityClass: CAPTURED_BUILD_ZONE_MISMATCH.facilityClass,
        visualClassId: '610',
        area: 1,
        zoneRequirement: 'Commerce',
        iconPath: 'icon.gif',
      },
      currentBuildingXSize: 2,
      currentBuildingYSize: 2,
      getRenderer: () => renderer,
      sendRequest,
      showNotification: jest.fn(),
      loadAlignedMapArea: jest.fn(),
      focusBuilding: jest.fn(),
    } as unknown as ClientHandlerContext;

    const done = placeBuilding(ctx, CAPTURED_BUILD_ZONE_MISMATCH.x, CAPTURED_BUILD_ZONE_MISMATCH.y);

    // Give the synchronous confirm-and-send path a tick to run.
    await Promise.resolve();
    await Promise.resolve();

    expect(renderer.addPendingPlacement).toHaveBeenCalledTimes(1);
    expect(renderer.addPendingPlacement).toHaveBeenCalledWith(
      CAPTURED_BUILD_ZONE_MISMATCH.x, CAPTURED_BUILD_ZONE_MISMATCH.y, 2, 2, '610', 'icon.gif',
    );
    expect(renderer.removePendingPlacement).not.toHaveBeenCalled();

    settleSendRequest(new Error(getErrorMessage(gatewayResponse.code)));
    await done;

    const key = renderer.addPendingPlacement.mock.results[0].value as string;
    expect(renderer.removePendingPlacement).toHaveBeenCalledWith(key);
    expect(ctx.showNotification).toHaveBeenCalledWith(
      expect.stringContaining(getErrorMessage(gatewayResponse.code)),
      'error',
    );
    expect(ctx.loadAlignedMapArea).not.toHaveBeenCalled();
  });
});
