/**
 * StarpeaceSession ↔ PushLiveness wiring: selectCompany's onEventsEnabled
 * arms the watchdog, every push reaches it, it re-sends through the session's
 * own `set EnableEvents` without ever reconnecting, and leaving (destroy),
 * cleanup and the start of a reconnect each disarm it.
 * The watchdog's own behaviour is in session/push-liveness.test.ts.
 */

jest.mock('node-fetch', () => ({ __esModule: true, default: jest.fn() }));

import { StarpeaceSession } from '../spo_session';
import { SessionPhase } from '../../shared/types';
import type { RdoPacket } from '../../shared/types';
import { PushLiveness } from '../session/push-liveness';
import * as loginHandler from '../session/login-handler';

function liveness(session: StarpeaceSession): PushLiveness {
  return (session as unknown as { pushLiveness: PushLiveness }).pushLiveness;
}

function push(session: StarpeaceSession, member: string, args: string[]): void {
  (session as unknown as { handlePush(s: string, p: RdoPacket): void }).handlePush('world', {
    raw: `C sel 1 call ${member}`, type: 'PUSH', member, args,
  } as unknown as RdoPacket);
}

describe('StarpeaceSession push watchdog wiring', () => {
  let session: StarpeaceSession;

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    session = new StarpeaceSession();
  });

  afterEach(() => {
    session.destroy();
    jest.useRealTimers();
  });

  it('arms on onEventsEnabled and logs the first push at INFO', () => {
    const info = jest.spyOn(session.log, 'info').mockImplementation(() => undefined);
    expect(liveness(session).isArmed).toBe(false);

    session.onEventsEnabled('re-login');
    expect(liveness(session).isArmed).toBe(true);

    push(session, 'RefreshDate', ['"@45000.5"']);
    expect(info).toHaveBeenCalledWith(expect.stringMatching(
      /^\[Events\] First push after re-login: RefreshDate \d+\.\ds after EnableEvents$/,
    ));
  });

  it('disarms on destroy', () => {
    session.onEventsEnabled('login');
    session.destroy();
    expect(liveness(session).isArmed).toBe(false);
  });

  it('disarms on cleanupWorldSession', async () => {
    session.onEventsEnabled('login');
    await session.cleanupWorldSession();
    expect(liveness(session).isArmed).toBe(false);
  });

  it('disarms when a world reconnect starts', async () => {
    const relogin = jest.spyOn(loginHandler, 'reconnectWorldSocket').mockResolvedValue(undefined);
    try {
      session.setWorldContextId('8161308');
      session.setPhase(SessionPhase.WORLD_CONNECTED);
      session.onEventsEnabled('login');
      let armedAtRelogin: boolean | null = null;
      relogin.mockImplementation(async () => { armedAtRelogin = liveness(session).isArmed; });

      await session.attemptWorldReconnect();

      expect(relogin).toHaveBeenCalledTimes(1);
      expect(armedAtRelogin).toBe(false);
    } finally {
      relogin.mockRestore();
    }
  });

  it('re-sends `set EnableEvents` on the current ClientView and never reconnects', async () => {
    const relogin = jest.spyOn(loginHandler, 'reconnectWorldSocket').mockResolvedValue(undefined);
    const reconnect = jest.spyOn(session, 'attemptWorldReconnect');
    const send = jest.spyOn(session, 'sendRdoRequest').mockResolvedValue(
      { raw: 'A1', type: 'RESPONSE', rid: 1 } as RdoPacket,
    );
    const warn = jest.spyOn(session.log, 'warn').mockImplementation(() => undefined);
    const error = jest.spyOn(session.log, 'error').mockImplementation(() => undefined);
    try {
      session.setWorldContextId('8161308');
      session.setPhase(SessionPhase.WORLD_CONNECTED);
      session.onEventsEnabled('re-login');

      // Requests keep answering, RefreshDate never comes: well past the cap.
      for (let t = 0; t < 30 * 60_000; t += 5_000) {
        (session as unknown as { lastRdoAnswerAt: number }).lastRdoAnswerAt = Date.now();
        await jest.advanceTimersByTimeAsync(5_000);
      }

      const resends = send.mock.calls.filter(c => c[1].member === 'EnableEvents');
      expect(resends).toHaveLength(PushLiveness.MAX_CONSECUTIVE_RESENDS);
      expect(resends[0][0]).toBe('world');
      expect(resends[0][1]).toMatchObject({ member: 'EnableEvents', targetId: '8161308' });
      expect(warn).toHaveBeenCalledTimes(PushLiveness.MAX_CONSECUTIVE_RESENDS);
      expect(error).toHaveBeenCalledTimes(1);
      expect(reconnect).not.toHaveBeenCalled();
      expect(relogin).not.toHaveBeenCalled();
    } finally {
      relogin.mockRestore();
    }
  });

  it('does not re-send EnableEvents from a session that is not in the world', async () => {
    const send = jest.spyOn(session, 'sendRdoRequest');
    const resend = (session as unknown as { resendEnableEvents(): Promise<void> }).resendEnableEvents();
    await expect(resend).rejects.toThrow(/not in the world/);
    expect(send).not.toHaveBeenCalled();
  });
});
