/// <reference path="../../server/__tests__/matchers/rdo-matchers.d.ts" />

/**
 * `status-lamps` — driven end to end through the real halves: real push dispatcher ->
 * real browser event handler -> real store -> real `StatusPill`.
 *
 * Four frames, four resulting UI states, per the card's criterion: two watcher names, then
 * an empty companionship list, then a backup starting and a backup finishing.
 */

jest.mock('@/client/bridge/client-bridge', () => ({
  ClientBridge: {
    log: jest.fn(),
  },
}));

import { render, screen } from '@testing-library/react';
import { RdoProtocol } from '@/server/rdo';
import type { RdoPacket, WsMessage } from '@/shared/types';
import { WsMessageType } from '@/shared/types';
import { makePushCtx } from '@/server/__tests__/session/fake-session-context';
import { dispatchPush } from '@/server/session/push-dispatcher';
import { dispatchEvent } from '@/client/handlers/event-handler';
import { useGameStore } from '@/client/store/game-store';
import { useUiStore } from '@/client/store/ui-store';
import { hasSeenBackupNotice, markBackupNoticeSeen } from '@/client/store/backup-notice';
import { StatusPill } from '@/client/components/hud/StatusPill';
import type { ClientHandlerContext } from '@/client/handlers/client-context';
import { createStatusLampsScenario } from './status-lamps-scenario';

const { rdo } = createStatusLampsScenario();
const USERNAME = 'SPO_test3';

function parsePush(frame: string): RdoPacket {
  return RdoProtocol.parse(frame) as RdoPacket;
}

/** The exact frame the scenario ships for an id — never a copy. */
function frameForId(id: string): string {
  return rdo.exchanges.find((e) => e.id === id)!.response;
}

/** Drives a raw push frame through the real gateway dispatcher and returns every emitted event. */
function pushToEvents(frame: string): WsMessage[] {
  const push = makePushCtx();
  dispatchPush(push.ctx, 'world', parsePush(frame));
  return (push.ctx.emit as jest.Mock).mock.calls
    .filter(([channel]) => channel === 'ws_event')
    .map(([, event]) => event as WsMessage);
}

function makeClientDriver(): ClientHandlerContext {
  return {} as unknown as ClientHandlerContext;
}

beforeEach(() => {
  jest.clearAllMocks();
  useGameStore.setState({ username: USERNAME, watchers: [], serverBusy: false });
  useUiStore.setState({ modal: null, confirmPayload: null });
  localStorage.clear();
});

describe('status-lamps scenario — the catalogue', () => {
  it('passes strict RDO validation', () => {
    expect(rdo).toPassStrictRdoValidation();
  });

  it('every exchange is a push with no request and a "*" separator', () => {
    for (const ex of rdo.exchanges) {
      expect(ex.pushOnly).toBe(true);
      expect(ex.request).toBe('');
      expect(ex.response).toContain('"*"');
      expect(ex.response).not.toContain('"^"');
    }
  });
});

describe('status-lamps scenario — watchers', () => {
  it('two names light the lamp and name both watchers on hover', () => {
    const events = pushToEvents(frameForId('companionship-two'));
    const event = events.find((e) => e.type === WsMessageType.EVENT_COMPANIONSHIP);
    expect(event).toBeDefined();

    dispatchEvent(makeClientDriver(), event!);
    expect(useGameStore.getState().watchers).toEqual(['Crazz', 'SPO_test3']);

    render(<StatusPill />);
    const lamp = screen.getByText('2');
    expect(lamp.getAttribute('title')).toBe('Watching your area: Crazz, SPO_test3');
  });

  it('an empty list extinguishes the lamp', () => {
    useGameStore.setState({ watchers: ['Crazz', 'SPO_test3'] });

    const events = pushToEvents(frameForId('companionship-empty'));
    const event = events.find((e) => e.type === WsMessageType.EVENT_COMPANIONSHIP);
    expect(event).toBeDefined();

    dispatchEvent(makeClientDriver(), event!);
    expect(useGameStore.getState().watchers).toEqual([]);

    render(<StatusPill />);
    expect(screen.queryByText('2')).toBeNull();
  });
});

describe('status-lamps scenario — backup', () => {
  it('status 0 lights the Backup lamp and requests the first-time explanation', () => {
    expect(hasSeenBackupNotice(USERNAME)).toBe(false);

    const events = pushToEvents(frameForId('backup-started'));
    const event = events.find((e) => e.type === WsMessageType.EVENT_MODEL_STATUS_CHANGED);
    expect(event).toBeDefined();

    dispatchEvent(makeClientDriver(), event!);
    expect(useGameStore.getState().serverBusy).toBe(true);
    expect(useUiStore.getState().modal).toBe('confirm');
    expect(useUiStore.getState().confirmPayload).toMatchObject({ title: 'The world is saving' });
    expect(hasSeenBackupNotice(USERNAME)).toBe(true);

    render(<StatusPill />);
    expect(screen.getByText('Backup')).toBeTruthy();
  });

  it('status 1 clears the Backup lamp', () => {
    useGameStore.setState({ serverBusy: true });

    const events = pushToEvents(frameForId('backup-finished'));
    const event = events.find((e) => e.type === WsMessageType.EVENT_MODEL_STATUS_CHANGED);
    expect(event).toBeDefined();

    dispatchEvent(makeClientDriver(), event!);
    expect(useGameStore.getState().serverBusy).toBe(false);

    render(<StatusPill />);
    expect(screen.queryByText('Backup')).toBeNull();
  });

  it('a second backup, after the notice was already seen, does not ask again', () => {
    markBackupNoticeSeen(USERNAME);

    const events = pushToEvents(frameForId('backup-started'));
    const event = events.find((e) => e.type === WsMessageType.EVENT_MODEL_STATUS_CHANGED);
    dispatchEvent(makeClientDriver(), event!);

    expect(useGameStore.getState().serverBusy).toBe(true);
    expect(useUiStore.getState().modal).toBeNull();
  });
});
