/**
 * Push liveness watchdog.
 *
 * TClientView.RegisterEventsById (Interface Server/InterfaceServer.pas) ends
 * with `EnableEvents := false`, and RefreshDate/RefreshTycoon push only when
 * `fConnected and fEnableEvents`. A session whose EnableEvents lost that race
 * answers every request and never receives a push. The watchdog re-sends
 * `set EnableEvents #-1` when RefreshDate is silent for 2 min while requests
 * still answer, at most every 2 min, and gives up after 3 re-sends in a row
 * with no RefreshDate between them (#1336).
 */

import { PushLiveness } from './push-liveness';
import type { PushLivenessDeps } from './push-liveness';

interface Harness {
  wd: PushLiveness;
  clock: { t: number };
  lastAnswer: { t: number };
  resend: jest.Mock<Promise<void>, []>;
  log: { info: jest.Mock; warn: jest.Mock; error: jest.Mock; debug: jest.Mock };
  /** Advance the fake clock and the interval timer together. */
  advance(ms: number): Promise<void>;
}

const START = 1_000_000;

function harness(resendImpl: () => Promise<void> = async () => undefined): Harness {
  const clock = { t: START };
  const lastAnswer = { t: 0 };
  const resend = jest.fn(resendImpl);
  const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  const deps: PushLivenessDeps = {
    log,
    now: () => clock.t,
    lastAnswerAt: () => lastAnswer.t,
    resendEnableEvents: resend,
  };
  const wd = new PushLiveness(deps);
  return {
    wd, clock, lastAnswer, resend, log,
    async advance(ms: number) {
      clock.t += ms;
      await jest.advanceTimersByTimeAsync(ms);
    },
  };
}

/** Requests keep answering: refresh the last-answer stamp as time passes. */
async function advanceAnswering(h: Harness, ms: number, step = 5_000): Promise<void> {
  for (let done = 0; done < ms; done += step) {
    await h.advance(Math.min(step, ms - done));
    h.lastAnswer.t = h.clock.t;
  }
}

beforeEach(() => { jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });

describe('PushLiveness — the watchdog', () => {
  it('does nothing while unarmed', async () => {
    const h = harness();
    await advanceAnswering(h, 10 * 60_000);
    expect(h.resend).not.toHaveBeenCalled();
  });

  it('re-sends EnableEvents when no RefreshDate arrives within 2 min while requests answer', async () => {
    const h = harness();
    h.wd.arm('re-login');

    await advanceAnswering(h, 105_000);
    expect(h.resend).not.toHaveBeenCalled();

    await advanceAnswering(h, 30_000);
    expect(h.resend).toHaveBeenCalledTimes(1);
    expect(h.log.warn).toHaveBeenCalledWith(expect.stringMatching(
      /^\[Events\] No RefreshDate push for 1\d\ds after re-login while requests still answer — re-sending EnableEvents \(#1\)$/,
    ));
  });

  it('re-sends at most once every 2 min', async () => {
    const h = harness();
    const sentAt: number[] = [];
    h.resend.mockImplementation(async () => { sentAt.push(h.clock.t); });
    h.wd.arm('re-login');

    await advanceAnswering(h, 6 * 60_000 + 30_000);
    // 2:00, 4:00, 6:00 — three re-sends, each at least 2 min after the last.
    expect(sentAt).toHaveLength(3);
    for (let i = 1; i < sentAt.length; i++) {
      expect(sentAt[i] - sentAt[i - 1]).toBeGreaterThanOrEqual(120_000);
    }
  });

  it('stays quiet while RefreshDate keeps arriving', async () => {
    const h = harness();
    h.wd.arm('login');
    for (let i = 0; i < 20; i++) {
      await advanceAnswering(h, 60_000);
      h.wd.onPush('RefreshDate');
    }
    expect(h.resend).not.toHaveBeenCalled();
  });

  it('does not count other pushes as RefreshDate', async () => {
    const h = harness();
    h.wd.arm('login');
    for (let i = 0; i < 4; i++) {
      await advanceAnswering(h, 40_000);
      h.wd.onPush('RefreshTycoon');
    }
    expect(h.resend).toHaveBeenCalledTimes(1);
  });

  it('catches RefreshDate going silent later in the session too', async () => {
    const h = harness();
    h.wd.arm('login');
    await advanceAnswering(h, 30_000);
    h.wd.onPush('RefreshDate');
    await advanceAnswering(h, 110_000);
    expect(h.resend).not.toHaveBeenCalled();
    await advanceAnswering(h, 25_000);
    expect(h.resend).toHaveBeenCalledTimes(1);
  });

  it('does not re-send when requests are not answering either (a stall, not lost events)', async () => {
    const h = harness();
    h.wd.arm('re-login');
    h.lastAnswer.t = h.clock.t;
    await h.advance(10 * 60_000); // no answers at all
    expect(h.resend).not.toHaveBeenCalled();
    expect(h.log.debug).toHaveBeenCalledWith(expect.stringContaining('not re-sending EnableEvents'));
  });

  it('stops after disarm', async () => {
    const h = harness();
    h.wd.arm('re-login');
    h.wd.disarm();
    await advanceAnswering(h, 10 * 60_000);
    expect(h.resend).not.toHaveBeenCalled();
    expect(h.wd.isArmed).toBe(false);
  });

  it('re-arming restarts the 2 min window', async () => {
    const h = harness();
    h.wd.arm('login');
    await advanceAnswering(h, 100_000);
    h.wd.arm('re-login');
    await advanceAnswering(h, 100_000);
    expect(h.resend).not.toHaveBeenCalled();
  });

  it('logs a failed re-send at WARN and tries again 2 min later', async () => {
    const h = harness(async () => { throw new Error('session not in the world'); });
    h.wd.arm('re-login');
    await advanceAnswering(h, 135_000);
    expect(h.resend).toHaveBeenCalledTimes(1);
    expect(h.log.warn).toHaveBeenCalledWith('[Events] EnableEvents re-send #1 failed: session not in the world');
    await advanceAnswering(h, 120_000);
    expect(h.resend).toHaveBeenCalledTimes(2);
  });

  it('never overlaps two re-sends', async () => {
    let release: () => void = () => undefined;
    const h = harness(() => new Promise<void>((resolve) => { release = resolve; }));
    h.wd.arm('re-login');
    await advanceAnswering(h, 135_000);
    expect(h.resend).toHaveBeenCalledTimes(1);
    await advanceAnswering(h, 5 * 60_000);
    expect(h.resend).toHaveBeenCalledTimes(1);
    release();
    await advanceAnswering(h, 20_000);
    expect(h.resend).toHaveBeenCalledTimes(2);
  });
});

describe('PushLiveness — the re-send cap', () => {
  it('stops after 3 re-sends with no RefreshDate between them, and logs ERROR once', async () => {
    const h = harness();
    h.wd.arm('re-login');

    await advanceAnswering(h, 30 * 60_000);

    expect(PushLiveness.MAX_CONSECUTIVE_RESENDS).toBe(3);
    expect(h.resend).toHaveBeenCalledTimes(3);
    expect(h.log.error).toHaveBeenCalledTimes(1);
    expect(h.log.error).toHaveBeenCalledWith(expect.stringMatching(
      /^\[Events\] No RefreshDate push for \d+s after re-login and 3 EnableEvents re-sends — no longer re-sending for this session$/,
    ));
    // Still armed: a RefreshDate can bring it back.
    expect(h.wd.isArmed).toBe(true);
  });

  it('counts failed re-sends toward the cap', async () => {
    const h = harness(async () => { throw new Error('EnableEvents answered errIllegalObject 2'); });
    h.wd.arm('login');
    await advanceAnswering(h, 30 * 60_000);
    expect(h.resend).toHaveBeenCalledTimes(3);
    expect(h.log.error).toHaveBeenCalledTimes(1);
  });

  it('a RefreshDate resets the count', async () => {
    const h = harness();
    h.wd.arm('re-login');

    await advanceAnswering(h, 4 * 60_000 + 30_000);
    expect(h.resend).toHaveBeenCalledTimes(2);
    h.wd.onPush('RefreshDate');

    // Silent again: three fresh re-sends are allowed before the cap.
    await advanceAnswering(h, 30 * 60_000);
    expect(h.resend).toHaveBeenCalledTimes(5);
    expect(h.log.error).toHaveBeenCalledTimes(1);
  });

  it('resumes re-sending after the cap once a RefreshDate came through', async () => {
    const h = harness();
    h.wd.arm('re-login');
    await advanceAnswering(h, 30 * 60_000);
    expect(h.resend).toHaveBeenCalledTimes(3);

    h.wd.onPush('RefreshDate');
    await advanceAnswering(h, 30 * 60_000);
    expect(h.resend).toHaveBeenCalledTimes(6);
    expect(h.log.error).toHaveBeenCalledTimes(2);
  });

  it('a re-arm (next login) resets the cap', async () => {
    const h = harness();
    h.wd.arm('login');
    await advanceAnswering(h, 30 * 60_000);
    expect(h.resend).toHaveBeenCalledTimes(3);

    h.wd.arm('re-login');
    await advanceAnswering(h, 2 * 60_000 + 15_000);
    expect(h.resend).toHaveBeenCalledTimes(4);
  });
});

describe('PushLiveness — diagnostics', () => {
  it('logs the first push after a re-login at INFO, once', async () => {
    const h = harness();
    h.wd.arm('re-login');
    await h.advance(4_500);
    h.wd.onPush('RefreshTycoon');
    h.wd.onPush('RefreshDate');
    const firsts = h.log.info.mock.calls.map(c => String(c[0])).filter(m => m.includes('First push'));
    expect(firsts).toEqual(['[Events] First push after re-login: RefreshTycoon 4.5s after EnableEvents']);
  });

  it('logs the first push again after the next login', async () => {
    const h = harness();
    h.wd.arm('login');
    h.wd.onPush('RefreshDate');
    h.wd.arm('re-login');
    h.wd.onPush('RefreshDate');
    const firsts = h.log.info.mock.calls.map(c => String(c[0])).filter(m => m.includes('First push'));
    expect(firsts).toHaveLength(2);
    expect(firsts[1]).toContain('after re-login');
  });

  it('ignores pushes before EnableEvents (InitClient during the handshake)', () => {
    const h = harness();
    h.wd.onPush('InitClient');
    expect(h.log.info).not.toHaveBeenCalled();
  });

  it('logs at INFO when RefreshDate resumes after a re-send', async () => {
    const h = harness();
    h.wd.arm('re-login');
    await advanceAnswering(h, 135_000);
    expect(h.resend).toHaveBeenCalledTimes(1);
    await advanceAnswering(h, 3_000);
    h.wd.onPush('RefreshDate');
    expect(h.log.info).toHaveBeenCalledWith(expect.stringMatching(
      /^\[Events\] RefreshDate resumed \d+\.\ds after EnableEvents re-send #1$/,
    ));
  });
});
