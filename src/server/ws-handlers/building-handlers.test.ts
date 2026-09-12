import type { WebSocket } from 'ws';
import { handlePlaceBuilding } from './building-handlers';
import type { WsHandlerContext } from './types';
import { WsMessageType, type WsMessage, type WsRespError, type WsRespBuildingPlaced } from '../../shared/types';
import * as ErrorCodes from '../../shared/error-codes';

function makeCtx(placeBuilding: jest.Mock) {
  const sent: WsMessage[] = [];
  const ws = {
    send: jest.fn((payload: string) => sent.push(JSON.parse(payload) as WsMessage)),
  } as unknown as WebSocket;

  const ctx = {
    ws,
    session: { placeBuilding },
  } as unknown as WsHandlerContext;

  return { ctx, sent };
}

const request: WsMessage = {
  type: WsMessageType.REQ_PLACE_BUILDING,
  wsRequestId: 'req-1',
  facilityClass: 'PGISupermarketC',
  x: 28,
  y: 618,
} as unknown as WsMessage;

describe('handlePlaceBuilding', () => {
  it.each([
    [28, 'Zone mismatch'],
    [33, 'Too many facilities'],
    [34, 'Building too close'],
    [3, 'Area not clear'],
    [999, 'Error 999'],
  ])('forwards the server\'s result code %i as RESP_ERROR with the matching text', async (code, message) => {
    const { ctx, sent } = makeCtx(
      jest.fn().mockResolvedValue({ success: false, buildingId: null, errorCode: code }),
    );

    await handlePlaceBuilding(ctx, request);

    expect(sent).toHaveLength(1);
    const resp = sent[0] as WsRespError;
    expect(resp.type).toBe(WsMessageType.RESP_ERROR);
    expect(resp.code).toBe(code);
    expect(resp.errorMessage).toBe(message);
  });

  it('falls back to ERROR_Unknown when the refusal carries no code at all', async () => {
    const { ctx, sent } = makeCtx(
      jest.fn().mockResolvedValue({ success: false, buildingId: null }),
    );

    await handlePlaceBuilding(ctx, request);

    const resp = sent[0] as WsRespError;
    expect(resp.code).toBe(ErrorCodes.ERROR_Unknown);
    expect(resp.errorMessage).toBe('Unknown error');
  });

  it('reports success without a buildingId key when the protocol returned none', async () => {
    const { ctx, sent } = makeCtx(
      jest.fn().mockResolvedValue({ success: true, buildingId: null }),
    );

    await handlePlaceBuilding(ctx, request);

    const resp = sent[0] as WsRespBuildingPlaced;
    expect(resp.type).toBe(WsMessageType.RESP_BUILDING_PLACED);
    expect(resp.x).toBe(28);
    expect(resp.y).toBe(618);
    expect('buildingId' in resp).toBe(false);
  });
});
