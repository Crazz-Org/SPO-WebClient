/// <reference path="../../server/__tests__/matchers/rdo-matchers.d.ts" />

/**
 * `context-status` — driven through the real gateway handler, the real browser
 * handler and the real HUD strip (issue 589).
 *
 * `ContextStatusText` is a 2-argument `"^"` function on `TClientView`
 * (`Interface Server/InterfaceServer.pas:149`) forwarding to
 * `TWorld.RDOContextStatusText` (`Kernel/World.pas:4233`). What this proves is
 * the whole loop: the strip asks for the tile under the camera, renders the
 * sentence the world answered, asks again when the camera moves to another tile
 * (Voyager's own trigger beside the 20 s idle timer, `MapIsoHandler.pas:188`),
 * and shows nothing at all where the world answers `''` (`World.pas:4243`).
 */

jest.mock('@/client/bridge/client-bridge', () => ({ ClientBridge: { log: jest.fn() } }));

import { act, render, screen, waitFor } from '@testing-library/react';
import { RdoProtocol } from '@/server/rdo';
import type { RdoPacket, WsMessage } from '@/shared/types';
import { WsMessageType, type WsRespContextStatus } from '@/shared/types';
import { makeSessionCtx } from '@/server/__tests__/session/fake-session-context';
import { handleContextStatus } from '@/server/ws-handlers/map-handlers';
import { getContextStatusText } from '@/server/session/context-status-handler';
import type { WsHandlerContext } from '@/server/ws-handlers/types';
import { RdoMock } from '../rdo-mock';
import { createContextStatusScenario, TOWN_TILE, EMPTY_TILE } from './context-status-scenario';
import { requestContextStatusText } from '@/client/handlers/context-status-handler';
import type { ClientHandlerContext } from '@/client/handlers/client-context';
import { ContextStatusStrip, CAMERA_POLL_MS } from '@/client/components/hud/ContextStatusStrip';
import { ClientContext } from '@/client/context/ClientContext';
import type { ClientCallbacks } from '@/client/bridge/client-bridge';
import { useMapStore } from '@/client/store/map-store';
import { useBuildingStore } from '@/client/store/building-store';
import type { MinimapRendererAPI } from '@/client/ui/minimap-colormap';

const SENTENCE = 'Podan, population 12,400';

/**
 * One mock standing in for the world server, plus the real gateway path on top
 * of it: `handleContextStatus` -> `getContextStatusText` -> a real RDO frame.
 */
function makeGateway() {
  const { rdo } = createContextStatusScenario(undefined, { text: SENTENCE });
  const mock = new RdoMock();
  mock.addScenario(rdo);

  const fake = makeSessionCtx({ sockets: ['world'] });
  fake.respond((packet) => {
    const frame = `${RdoProtocol.format(packet as RdoPacket)};`;
    const r = mock.match(frame);
    return r ? (RdoProtocol.parse(r.response).payload ?? '') : '';
  });

  const ask = async (x: number, y: number): Promise<WsRespContextStatus> => {
    const sent: WsMessage[] = [];
    const ctx = {
      ws: { send: (payload: string) => sent.push(JSON.parse(payload) as WsMessage) },
      session: {
        getContextStatusText: (cx: number, cy: number) => getContextStatusText(fake.ctx, cx, cy),
      },
    } as unknown as WsHandlerContext;

    await handleContextStatus(ctx, {
      type: WsMessageType.REQ_CONTEXT_STATUS,
      wsRequestId: 'req-1',
      x, y,
    } as unknown as WsMessage);

    expect(sent).toHaveLength(1);
    return sent[0] as WsRespContextStatus;
  };

  return { mock, ask, fake, rdo };
}

/** The real browser handler, answered by the real gateway path above. */
function makeCallbacks(ask: (x: number, y: number) => Promise<WsRespContextStatus>): ClientCallbacks {
  const clientCtx = {
    sendRequest: jest.fn(async (msg: { x: number; y: number }) => ask(msg.x, msg.y)),
  } as unknown as ClientHandlerContext;

  return {
    onRequestContextStatus: (x: number, y: number) => requestContextStatusText(clientCtx, x, y),
  } as unknown as ClientCallbacks;
}

function setCamera(x: number, y: number): void {
  useMapStore.setState({
    source: { getCameraPosition: () => ({ x, y }) } as unknown as MinimapRendererAPI,
  });
}

describe('context-status scenario', () => {
  afterEach(() => {
    jest.useRealTimers();
    useMapStore.setState({ source: null });
    useBuildingStore.getState().clearFocus();
  });

  it('the gateway answers the world sentence for a town tile and "" for a tile with no town', async () => {
    const { mock, ask, fake, rdo } = makeGateway();

    await expect(ask(TOWN_TILE.x, TOWN_TILE.y)).resolves.toMatchObject({ text: SENTENCE });
    await expect(ask(EMPTY_TILE.x, EMPTY_TILE.y)).resolves.toMatchObject({ text: '' });

    expect(mock.getConsumedIds().has('cs-rdo-001')).toBe(true);
    expect(mock.getConsumedIds().has('cs-rdo-002')).toBe(true);
    // Each fixture request is byte-for-byte the frame production emitted.
    const frames = fake.sent.map(s => `${RdoProtocol.format(s.packet as RdoPacket)};`);
    expect(frames.map(f => mock.match(f)!.exchange.id)).toEqual(['cs-rdo-001', 'cs-rdo-002']);
    expect(frames).toEqual(frames.map(f => mock.match(f)!.exchange.request));
    expect(frames).toPassStrictRdoValidation(rdo);
  });

  it('the strip renders the sentence, asks again after a camera move, and disappears on the empty answer', async () => {
    jest.useFakeTimers();
    const { mock, ask } = makeGateway();
    const callbacks = makeCallbacks(ask);

    setCamera(TOWN_TILE.x, TOWN_TILE.y);

    render(
      <ClientContext.Provider value={callbacks}>
        <ContextStatusStrip />
      </ClientContext.Provider>,
    );

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(SENTENCE));

    // The camera moves to a tile with no town — the next poll must ask about it.
    setCamera(EMPTY_TILE.x, EMPTY_TILE.y);
    await act(async () => { jest.advanceTimersByTime(CAMERA_POLL_MS); });

    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());

    // Both exchanges consumed: the camera move really did produce a second ask.
    expect(mock.getConsumedIds().has('cs-rdo-001')).toBe(true);
    expect(mock.getConsumedIds().has('cs-rdo-002')).toBe(true);
  });

  it('says nothing while a building is selected, and comes back when the selection is cleared', async () => {
    const { ask } = makeGateway();
    const callbacks = makeCallbacks(ask);

    setCamera(TOWN_TILE.x, TOWN_TILE.y);
    useBuildingStore.setState({
      focusedBuilding: { id: '1', name: 'Farm', x: TOWN_TILE.x, y: TOWN_TILE.y },
    } as unknown as Parameters<typeof useBuildingStore.setState>[0]);

    render(
      <ClientContext.Provider value={callbacks}>
        <ContextStatusStrip />
      </ClientContext.Provider>,
    );

    expect(screen.queryByRole('status')).toBeNull();

    await act(async () => { useBuildingStore.getState().clearFocus(); });

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(SENTENCE));
  });
});
