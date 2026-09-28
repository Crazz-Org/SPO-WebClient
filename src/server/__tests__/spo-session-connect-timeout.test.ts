/**
 * StarpeaceSession.createSocket — the 10 s connect deadline.
 *
 * A Delphi host that drops SYNs must fail the caller after 10 s (the pool's own
 * `connectTimeoutMs`), not after the OS gives up two minutes later.
 */

jest.mock('node-fetch', () => ({ __esModule: true, default: jest.fn() }));

import { EventEmitter } from 'events';
import type * as net from 'net';
import { StarpeaceSession } from '../spo_session';

class NeverConnectingSocket extends EventEmitter {
  setNoDelay = jest.fn();
  destroy = jest.fn();
  write = jest.fn();
  end = jest.fn();
  connectCb: (() => void) | null = null;
  connect(_port: number, _host: string, cb: () => void): this {
    this.connectCb = cb;
    return this;
  }
}

const HOST = '10.255.255.1';
const PORT = 8000;

describe('StarpeaceSession.createSocket connect timeout', () => {
  let session: StarpeaceSession;
  let fake: NeverConnectingSocket;

  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'] });
    fake = new NeverConnectingSocket();
    session = new StarpeaceSession();
    session.setSocketFactory(() => fake as unknown as net.Socket);
    jest.spyOn(session.log, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    session.destroy();
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('rejects at 10 000 ms, not before, destroying the socket and storing nothing', async () => {
    let settled = false;
    const p = session.createSocket('world', HOST, PORT);
    p.then(() => { settled = true; }, () => { settled = true; });

    await jest.advanceTimersByTimeAsync(9_999);
    expect(settled).toBe(false);
    expect(fake.destroy).not.toHaveBeenCalled();

    const assertion = expect(p).rejects.toThrow(/world.*10\.255\.255\.1:8000.*10000 ms/);
    await jest.advanceTimersByTimeAsync(1);
    await assertion;
    expect(fake.destroy).toHaveBeenCalledTimes(1);
    expect(session.getSocket('world')).toBeUndefined();
  });

  it('resolves a socket that connects at 9 999 ms and never destroys it later', async () => {
    const p = session.createSocket('world', HOST, PORT);
    await jest.advanceTimersByTimeAsync(9_999);
    fake.connectCb?.();
    await expect(p).resolves.toBe(fake);

    await jest.advanceTimersByTimeAsync(20_000);
    expect(fake.destroy).not.toHaveBeenCalled();
    expect(session.getSocket('world')).toBe(fake);
  });

  it('ignores a connect that arrives after the timeout', async () => {
    const p = session.createSocket('world', HOST, PORT);
    const assertion = expect(p).rejects.toThrow(/Connect timeout/);
    await jest.advanceTimersByTimeAsync(10_000);
    await assertion;

    fake.connectCb?.();
    expect(session.getSocket('world')).toBeUndefined();
  });

  it('rejects with a pre-connect error and clears the timer', async () => {
    const p = session.createSocket('world', HOST, PORT);
    await jest.advanceTimersByTimeAsync(5_000);
    const err = new Error('ECONNREFUSED');
    const assertion = expect(p).rejects.toBe(err);
    fake.emit('error', err);
    await assertion;

    await jest.advanceTimersByTimeAsync(10_000);
    expect(fake.destroy).not.toHaveBeenCalled();
  });
});
