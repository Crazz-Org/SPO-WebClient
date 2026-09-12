/**
 * The connection picker asks for road reachability right after the results it
 * enriches land on screen (issue #584), and merges the answer only when it
 * still matches the picker's identity — a stale or mismatched batch is ignored.
 * `ClientBridge` and the stores are real: only the transport (`ctx.rawSend`) is
 * a spy, the same shape as `mail-unread-badge.test.ts:24-31`.
 */

import { WsMessageType, type WsMessage, type WsRespSearchConnections, type WsRespConnectionReachability } from '@/shared/types';
import { dispatchEvent } from './event-handler';
import { useBuildingStore } from '../store/building-store';
import { useUiStore } from '../store/ui-store';
import type { ClientHandlerContext } from './client-context';

function makeCtx() {
  const rawSend = jest.fn();
  const ctx = { rawSend, soundManager: { play: jest.fn() } } as unknown as ClientHandlerContext;
  return { ctx, rawSend };
}

const PICKER = { fluidName: 'Cotton', fluidId: 'Cotton', direction: 'input' as const, buildingX: 706, buildingY: 436 };

function openPicker(): void {
  useBuildingStore.getState().setConnectionPicker(PICKER);
}

function searchResp(results: Array<{ x: number; y: number }>): WsMessage {
  return {
    type: WsMessageType.RESP_SEARCH_CONNECTIONS,
    results: results.map(({ x, y }) => ({ facilityName: 'Farm', companyName: 'ACME', x, y })),
    fluidId: 'Cotton',
    direction: 'input',
  } as unknown as WsRespSearchConnections as unknown as WsMessage;
}

function reachResp(over: Partial<WsRespConnectionReachability> = {}): WsMessage {
  return {
    type: WsMessageType.RESP_CONNECTION_REACHABILITY,
    buildingX: 706, buildingY: 436, fluidId: 'Cotton', direction: 'input',
    entries: [{ x: 480, y: 392, reachability: 'connected' }],
    ...over,
  } as unknown as WsMessage;
}

describe('connection picker road reachability dispatch', () => {
  beforeEach(() => {
    useBuildingStore.setState({ connectionPicker: null });
    useUiStore.setState({ modal: null });
  });

  it('sends REQ_CONNECTION_REACHABILITY with the candidates in row order once results land', () => {
    openPicker();
    const { ctx, rawSend } = makeCtx();

    dispatchEvent(ctx, searchResp([{ x: 480, y: 392 }, { x: 600, y: 700 }]));

    expect(rawSend).toHaveBeenCalledWith({
      type: WsMessageType.REQ_CONNECTION_REACHABILITY,
      buildingX: 706, buildingY: 436, fluidId: 'Cotton', direction: 'input',
      candidates: [{ x: 480, y: 392 }, { x: 600, y: 700 }],
    });
  });

  it('sends nothing when the results are empty', () => {
    openPicker();
    const { ctx, rawSend } = makeCtx();

    dispatchEvent(ctx, searchResp([]));

    expect(rawSend).not.toHaveBeenCalled();
  });

  it('sends nothing for the profile-level supplier search (no building to compare against)', () => {
    useUiStore.setState({ modal: 'supplierSearch' });
    const { ctx, rawSend } = makeCtx();

    dispatchEvent(ctx, searchResp([{ x: 480, y: 392 }]));

    expect(rawSend).not.toHaveBeenCalled();
  });

  it('merges a RESP_CONNECTION_REACHABILITY that matches the open picker', () => {
    openPicker();
    const { ctx } = makeCtx();

    dispatchEvent(ctx, reachResp());

    expect(useBuildingStore.getState().connectionPicker?.reachability).toEqual({ '480,392': 'connected' });
  });

  it('ignores a reply for a different building/fluid/direction', () => {
    openPicker();
    const { ctx } = makeCtx();

    dispatchEvent(ctx, reachResp({ buildingX: 1, buildingY: 1 }));
    expect(useBuildingStore.getState().connectionPicker?.reachability).toEqual({});

    dispatchEvent(ctx, reachResp({ fluidId: 'Oil' }));
    expect(useBuildingStore.getState().connectionPicker?.reachability).toEqual({});

    dispatchEvent(ctx, reachResp({ direction: 'output' }));
    expect(useBuildingStore.getState().connectionPicker?.reachability).toEqual({});
  });

  it('ignores a reply when no picker is open', () => {
    const { ctx } = makeCtx();

    dispatchEvent(ctx, reachResp());

    expect(useBuildingStore.getState().connectionPicker).toBeNull();
  });
});
