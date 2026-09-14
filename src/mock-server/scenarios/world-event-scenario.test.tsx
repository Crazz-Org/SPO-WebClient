/// <reference path="../../server/__tests__/matchers/rdo-matchers.d.ts" />

/**
 * `world-event` — driven through the real gateway handler, the real browser
 * handler and the real HUD ticker (issue 612).
 *
 * `PickEvent` is a 1-argument `"^"` function on `TClientView`
 * (`Interface Server/InterfaceServer.pas:166`) forwarding to
 * `TWorld.RDOPickEvent` (`Kernel/World.pas:4840-4871`). What this proves is
 * the whole loop: the ticker asks for the newest event, renders the block the
 * world answered, and shows nothing new — never an error — when a later ask
 * answers the backup / empty-queue `''`.
 */

jest.mock('@/client/bridge/client-bridge', () => ({ ClientBridge: { log: jest.fn() } }));

import { act, render, screen, waitFor } from '@testing-library/react';
import { RdoProtocol } from '@/server/rdo';
import type { RdoPacket, WsMessage } from '@/shared/types';
import { WsMessageType, type WsRespWorldEvent } from '@/shared/types';
import { makeSessionCtx } from '@/server/__tests__/session/fake-session-context';
import { handleWorldEvent } from '@/server/ws-handlers/misc-handlers';
import { pickWorldEvent } from '@/server/session/world-events-handler';
import type { WsHandlerContext } from '@/server/ws-handlers/types';
import { RdoMock } from '../rdo-mock';
import { createWorldEventScenario, EVENT_FIXTURE, EVENT_TILE } from './world-event-scenario';
import { requestWorldEvent } from '@/client/handlers/world-event-handler';
import type { ClientHandlerContext } from '@/client/handlers/client-context';
import { WorldEventTicker, POLL_MS } from '@/client/components/hud/WorldEventTicker';
import { ClientContext } from '@/client/context/ClientContext';
import type { ClientCallbacks } from '@/client/bridge/client-bridge';
import { useMapStore } from '@/client/store/map-store';
import { ClientBridge } from '@/client/bridge/client-bridge';

/**
 * One mock standing in for the world server, plus the real gateway path on
 * top of it: `handleWorldEvent` -> `pickWorldEvent` -> a real RDO frame.
 */
function makeGateway(mock: RdoMock) {
  const fake = makeSessionCtx({ sockets: ['world'] });
  fake.respond((packet) => {
    const frame = `${RdoProtocol.format(packet as RdoPacket)};`;
    const r = mock.match(frame);
    return r ? (RdoProtocol.parse(r.response).payload ?? '') : '';
  });

  const ask = async (): Promise<WsRespWorldEvent> => {
    const sent: WsMessage[] = [];
    const ctx = {
      ws: { send: (payload: string) => sent.push(JSON.parse(payload) as WsMessage) },
      session: {
        pickWorldEvent: () => pickWorldEvent(fake.ctx),
      },
    } as unknown as WsHandlerContext;

    await handleWorldEvent(ctx, {
      type: WsMessageType.REQ_WORLD_EVENT,
      wsRequestId: 'req-1',
    } as unknown as WsMessage);

    expect(sent).toHaveLength(1);
    return sent[0] as WsRespWorldEvent;
  };

  return { fake, ask };
}

/** The real browser handler, answered by the real gateway path above. */
function makeCallbacks(ask: () => Promise<WsRespWorldEvent>): ClientCallbacks {
  const clientCtx = {
    sendRequest: jest.fn(async () => ask()),
  } as unknown as ClientHandlerContext;

  return {
    onRequestWorldEvent: () => requestWorldEvent(clientCtx),
  } as unknown as ClientCallbacks;
}

describe('world-event scenario', () => {
  afterEach(() => {
    jest.useRealTimers();
    useMapStore.setState({ source: null });
  });

  it('passes strict RDO validation', () => {
    const { rdo } = createWorldEventScenario();
    expect(rdo).toPassStrictRdoValidation();
  });

  it('the gateway answers the rendered event block', async () => {
    const mock = new RdoMock();
    mock.addScenario(createWorldEventScenario().rdo);
    const { ask } = makeGateway(mock);

    await expect(ask()).resolves.toMatchObject({
      event: {
        date: EVENT_FIXTURE.date,
        kind: EVENT_FIXTURE.kind,
        text: EVENT_FIXTURE.text,
        x: EVENT_TILE.x,
        y: EVENT_TILE.y,
      },
    });
    expect(mock.getConsumedIds().has('we-rdo-001')).toBe(true);
  });

  it('the ticker shows the first event and keeps it through an empty-answer poll — no error logged', async () => {
    jest.useFakeTimers();
    const mock = new RdoMock();
    mock.addScenario(createWorldEventScenario().rdo);
    const { ask } = makeGateway(mock);
    const callbacks = makeCallbacks(ask);

    render(
      <ClientContext.Provider value={callbacks}>
        <WorldEventTicker />
      </ClientContext.Provider>,
    );

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(EVENT_FIXTURE.text));
    expect(mock.getConsumedIds().has('we-rdo-001')).toBe(true);

    // Swap in the empty / backup-running variant for the next poll.
    mock.clearScenarios();
    mock.addScenario(createWorldEventScenario(undefined, { event: null }).rdo);

    await act(async () => { jest.advanceTimersByTime(POLL_MS); });

    await waitFor(() => expect(mock.getConsumedIds().has('we-rdo-002')).toBe(true));
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(screen.getByRole('status')).toHaveTextContent(EVENT_FIXTURE.text);
    expect(ClientBridge.log).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.stringMatching(/fail|error/i),
    );
  });

  it('clicking the event moves the camera to its tile and records the position', async () => {
    jest.useFakeTimers();
    const mock = new RdoMock();
    mock.addScenario(createWorldEventScenario().rdo);
    const { ask } = makeGateway(mock);
    const callbacks = makeCallbacks(ask);

    const centerOn = jest.fn();
    const getCameraPosition = jest.fn(() => ({ x: 0, y: 0 }));
    useMapStore.setState({ source: { centerOn, getCameraPosition } as never });

    render(
      <ClientContext.Provider value={callbacks}>
        <WorldEventTicker />
      </ClientContext.Provider>,
    );

    await waitFor(() => expect(screen.getByRole('button')).toBeInTheDocument());

    await act(async () => { screen.getByRole('button').click(); });

    expect(centerOn).toHaveBeenCalledWith(EVENT_TILE.x, EVENT_TILE.y);
    expect(useMapStore.getState().history).toContainEqual(EVENT_TILE);
  });
});
