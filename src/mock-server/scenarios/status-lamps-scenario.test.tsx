/// <reference path="../../server/__tests__/matchers/rdo-matchers.d.ts" />

/**
 * `status-lamps` — driven through the real push dispatcher and the real
 * browser event handler into the real `StatusPill` (issue 611).
 *
 * One ordered flow, four assertions: a two-name `NotifyCompanionship` lights
 * the watchers lamp, an empty one extinguishes it, `ModelStatusChanged(0)`
 * shows the backup lamp, `ModelStatusChanged(1)` clears it. Isolated
 * assertions could each pass while the wiring between gateway and browser is
 * broken; only one continuous flow proves the whole loop.
 */

jest.mock('@/client/bridge/client-bridge', () => ({ ClientBridge: { log: jest.fn() } }));

import { act, render, screen } from '@testing-library/react';
import { RdoProtocol } from '@/server/rdo';
import type { RdoPacket, WsMessage } from '@/shared/types';
import { dispatchPush } from '@/server/session/push-dispatcher';
import { makePushCtx } from '@/server/__tests__/session/fake-session-context';
import { dispatchEvent } from '@/client/handlers/event-handler';
import type { ClientHandlerContext } from '@/client/handlers/client-context';
import { rdoGet } from '@/shared/rdo-frame';
import { useGameStore } from '@/client/store/game-store';
import { StatusPill } from '@/client/components/hud/StatusPill';
import { RdoMock } from '../rdo-mock';
import { mergeVariables } from './scenario-variables';
import {
  createStatusLampsScenario,
  companionshipPush,
  modelStatusPush,
  WATCHERS,
} from './status-lamps-scenario';

const CLIENT_VIEW_ID = mergeVariables().clientViewId;

/** Parse a raw push frame the way the real socket reader hands it to the dispatcher. */
function parsePush(frame: string): RdoPacket {
  return RdoProtocol.parse(frame) as RdoPacket;
}

/** Push one frame through the real gateway dispatcher, then the real browser handler. */
function drive(frame: string): void {
  const push = makePushCtx();
  dispatchPush(push.ctx, 'world', parsePush(frame));

  const events = (push.ctx.emit as jest.Mock).mock.calls
    .filter(([channel]) => channel === 'ws_event')
    .map(([, event]) => event as WsMessage);
  expect(events).toHaveLength(1);

  act(() => { dispatchEvent({} as ClientHandlerContext, events[0]); });
}

describe('status-lamps scenario', () => {
  beforeEach(() => {
    useGameStore.getState().reset();
  });

  it('passes strict RDO validation', () => {
    const { rdo } = createStatusLampsScenario();
    expect(rdo).toPassStrictRdoValidation();
  });

  it('matches the reconnect re-poll frame back to the scripted ServerBusy exchange', () => {
    const { rdo } = createStatusLampsScenario();
    const mock = new RdoMock();
    mock.addScenario(rdo);

    const frame = `${rdoGet('ServerBusy', CLIENT_VIEW_ID).toFrame()}`;
    const result = mock.match(frame);

    expect(result?.exchange.id).toBe('lamps-rdo-001');
  });

  it('one ordered flow: two watchers, then none, then busy, then not busy', () => {
    render(<StatusPill />);

    drive(companionshipPush(CLIENT_VIEW_ID, WATCHERS));
    const lamp = screen.getByText('2 watching');
    expect(lamp.getAttribute('title')).toBe(`Watching this area: ${WATCHERS.join(' · ')}`);

    drive(companionshipPush(CLIENT_VIEW_ID, []));
    expect(screen.queryByText(/watching/)).toBeNull();

    drive(modelStatusPush(CLIENT_VIEW_ID, 0));
    expect(screen.getByText('Backup')).toBeTruthy();

    drive(modelStatusPush(CLIENT_VIEW_ID, 1));
    expect(screen.queryByText('Backup')).toBeNull();
  });
});
