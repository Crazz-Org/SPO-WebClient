import { describe, it, expect, afterEach } from '@jest/globals';
import { WebSocket } from 'ws';
import {
  ConnectionDrain,
  createSessionTeardown,
  createShutdownSequence,
  SHUTDOWN_DEADLINE_MS,
  WS_CLOSE_SERVICE_RESTART,
  WS_CLOSE_SERVICE_RESTART_REASON,
  type ShutdownSequenceDeps,
} from './gateway-shutdown';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>(r => { resolve = r; });
  return { promise, resolve };
}

function fakeSocket(readyState: number) {
  return { readyState, close: jest.fn() };
}

function deps(overrides: Partial<ShutdownSequenceDeps> = {}): ShutdownSequenceDeps {
  return {
    server: { close: jest.fn() },
    drain: new ConnectionDrain(),
    registry: { shutdown: jest.fn(() => Promise.resolve()) },
    closeLogTransports: jest.fn(() => Promise.resolve()),
    exit: jest.fn(),
    log: { info: jest.fn(), error: jest.fn() },
    ...overrides,
  };
}

afterEach(() => {
  jest.useRealTimers();
});

describe('constants', () => {
  it('uses the IANA Service Restart code and a deadline under Docker\'s 10 s', () => {
    expect(WS_CLOSE_SERVICE_RESTART).toBe(1012);
    expect(WS_CLOSE_SERVICE_RESTART_REASON).toBe('Server restarting');
    expect(SHUTDOWN_DEADLINE_MS).toBeLessThan(10_000);
    expect(SHUTDOWN_DEADLINE_MS).toBeGreaterThan(5000);
  });
});

describe('createSessionTeardown', () => {
  it('runs endSession once and returns the same promise to every caller', async () => {
    const gate = deferred();
    const session = { endSession: jest.fn(() => gate.promise), destroy: jest.fn() };
    const teardown = createSessionTeardown(session, jest.fn());
    const a = teardown();
    const b = teardown();
    expect(a).toBe(b);
    expect(session.endSession).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(session.destroy).not.toHaveBeenCalled();
    gate.resolve();
    await a;
    expect(session.destroy).toHaveBeenCalledTimes(1);
    await teardown();
    expect(session.endSession).toHaveBeenCalledTimes(1);
    expect(session.destroy).toHaveBeenCalledTimes(1);
  });

  it('reports a rejected endSession and still destroys', async () => {
    const err = new Error('boom');
    const session = { endSession: jest.fn(() => Promise.reject(err)), destroy: jest.fn() };
    const onError = jest.fn();
    await createSessionTeardown(session, onError)();
    expect(onError).toHaveBeenCalledWith(err);
    expect(session.destroy).toHaveBeenCalledTimes(1);
  });
});

describe('ConnectionDrain', () => {
  it('closes open and connecting sockets with 1012 and skips closing/closed ones, awaiting every teardown', async () => {
    const drain = new ConnectionDrain();
    const sockets = [
      fakeSocket(WebSocket.OPEN),
      fakeSocket(WebSocket.CONNECTING),
      fakeSocket(WebSocket.CLOSING),
      fakeSocket(WebSocket.CLOSED),
    ];
    const teardowns = sockets.map(() => jest.fn(() => Promise.resolve()));
    sockets.forEach((s, i) => drain.track(s, teardowns[i]));

    expect(drain.isDraining()).toBe(false);
    await drain.drain();
    expect(drain.isDraining()).toBe(true);

    expect(sockets[0].close).toHaveBeenCalledWith(1012, 'Server restarting');
    expect(sockets[1].close).toHaveBeenCalledWith(1012, 'Server restarting');
    expect(sockets[2].close).not.toHaveBeenCalled();
    expect(sockets[3].close).not.toHaveBeenCalled();
    for (const t of teardowns) expect(t).toHaveBeenCalledTimes(1);
  });

  it('awaits a rejecting teardown without failing the drain', async () => {
    const drain = new ConnectionDrain();
    drain.track(fakeSocket(WebSocket.OPEN), () => Promise.reject(new Error('x')));
    await expect(drain.drain()).resolves.toBeUndefined();
  });

  it('forgets an untracked socket', async () => {
    const drain = new ConnectionDrain();
    const ws = fakeSocket(WebSocket.OPEN);
    const teardown = jest.fn(() => Promise.resolve());
    drain.track(ws, teardown);
    drain.untrack(ws);
    await drain.drain();
    expect(ws.close).not.toHaveBeenCalled();
    expect(teardown).not.toHaveBeenCalled();
  });
});

describe('createShutdownSequence', () => {
  it('runs close → drain → registry → logs → exit(0) in order', async () => {
    const d = deps();
    const drainSpy = jest.spyOn(d.drain, 'drain');
    await createShutdownSequence(d)('SIGTERM');
    const order = [
      (d.server.close as jest.Mock).mock.invocationCallOrder[0],
      drainSpy.mock.invocationCallOrder[0],
      (d.registry.shutdown as jest.Mock).mock.invocationCallOrder[0],
      (d.closeLogTransports as jest.Mock).mock.invocationCallOrder[0],
      (d.exit as jest.Mock).mock.invocationCallOrder[0],
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(d.exit).toHaveBeenCalledWith(0);
  });

  it('runs once when called twice', async () => {
    const d = deps();
    const run = createShutdownSequence(d);
    const a = run('SIGTERM');
    const b = run('SIGINT');
    expect(a).toBe(b);
    await a;
    expect(d.registry.shutdown).toHaveBeenCalledTimes(1);
    expect(d.exit).toHaveBeenCalledTimes(1);
  });

  it('exits 1 when a step throws, and never exits twice', async () => {
    jest.useFakeTimers();
    const d = deps({ closeLogTransports: jest.fn(() => Promise.reject(new Error('disk'))) });
    await createShutdownSequence(d)('SIGTERM');
    expect(d.exit).toHaveBeenCalledWith(1);
    expect(d.log.error).toHaveBeenCalledWith(expect.stringContaining('disk'));
    await jest.advanceTimersByTimeAsync(SHUTDOWN_DEADLINE_MS * 2);
    expect(d.exit).toHaveBeenCalledTimes(1);
  });

  it('exits 0 at the deadline when a step hangs, honouring a custom deadline', async () => {
    jest.useFakeTimers();
    const d = deps({ registry: { shutdown: () => new Promise<void>(() => undefined) }, deadlineMs: 100 });
    void createShutdownSequence(d)('SIGTERM');
    await jest.advanceTimersByTimeAsync(99);
    expect(d.exit).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(1);
    expect(d.exit).toHaveBeenCalledWith(0);
    expect(d.closeLogTransports).not.toHaveBeenCalled();
  });
});
