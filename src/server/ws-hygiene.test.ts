import { EventEmitter } from 'events';
import { startHeartbeat, WS_HEARTBEAT_INTERVAL_MS, type HeartbeatSocket } from './ws-hygiene';

class FakeSocket implements HeartbeatSocket {
  ping = jest.fn();
  terminate = jest.fn();
  private pongListener: (() => void) | null = null;
  on(event: 'pong', listener: () => void): this {
    if (event === 'pong') this.pongListener = listener;
    return this;
  }
  pong(): void {
    this.pongListener?.();
  }
}

class FakeServer extends EventEmitter {
  readonly clients = new Set<FakeSocket>();
}

const TICK = WS_HEARTBEAT_INTERVAL_MS;

describe('startHeartbeat', () => {
  let wss: FakeServer;

  beforeEach(() => {
    jest.useFakeTimers();
    wss = new FakeServer();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('pings every 30 s (policy SEC-W-6)', () => {
    expect(WS_HEARTBEAT_INTERVAL_MS).toBe(30_000);
  });

  it('terminates a socket that never pongs on the second tick, not before', () => {
    const ws = new FakeSocket();
    wss.clients.add(ws);
    const stop = startHeartbeat(wss, TICK);

    jest.advanceTimersByTime(TICK - 1);
    expect(ws.ping).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1);
    expect(ws.ping).toHaveBeenCalledTimes(1);
    expect(ws.terminate).not.toHaveBeenCalled();

    jest.advanceTimersByTime(TICK - 1); // 59 999 ms
    expect(ws.terminate).not.toHaveBeenCalled();
    jest.advanceTimersByTime(1); // 60 000 ms
    expect(ws.terminate).toHaveBeenCalledTimes(1);
    expect(ws.ping).toHaveBeenCalledTimes(1);
    stop();
  });

  it('keeps a socket that answers every ping open across 5 ticks', () => {
    const ws = new FakeSocket();
    ws.ping.mockImplementation(() => ws.pong());
    wss.clients.add(ws);
    const stop = startHeartbeat(wss, TICK);

    jest.advanceTimersByTime(TICK * 5);
    expect(ws.ping).toHaveBeenCalledTimes(5);
    expect(ws.terminate).not.toHaveBeenCalled();
    stop();
  });

  it('terminates a socket within 60 s of its last pong', () => {
    const ws = new FakeSocket();
    wss.clients.add(ws);
    const stop = startHeartbeat(wss, TICK);

    jest.advanceTimersByTime(TICK); // ping #1
    jest.advanceTimersByTime(10_000);
    ws.pong(); // last sign of life at 40 000 ms
    const lastPongAt = TICK + 10_000;
    let elapsed = TICK + 10_000;
    while (ws.terminate.mock.calls.length === 0 && elapsed < lastPongAt + 120_000) {
      jest.advanceTimersByTime(1000);
      elapsed += 1000;
    }
    expect(ws.terminate).toHaveBeenCalledTimes(1);
    expect(elapsed - lastPongAt).toBeLessThanOrEqual(60_000);
    stop();
  });

  it('stop() clears the interval and is safe to call twice', () => {
    const ws = new FakeSocket();
    wss.clients.add(ws);
    const stop = startHeartbeat(wss, TICK);
    expect(jest.getTimerCount()).toBe(1);

    stop();
    stop();
    expect(jest.getTimerCount()).toBe(0);
    expect(wss.listenerCount('close')).toBe(0);
    jest.advanceTimersByTime(TICK * 5);
    expect(ws.ping).not.toHaveBeenCalled();
    expect(ws.terminate).not.toHaveBeenCalled();
  });

  it('stops when the server emits close', () => {
    const ws = new FakeSocket();
    wss.clients.add(ws);
    startHeartbeat(wss, TICK);

    wss.emit('close');
    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(TICK * 5);
    expect(ws.ping).not.toHaveBeenCalled();
  });

  it('a socket whose ping throws does not stop the loop', () => {
    const bad = new FakeSocket();
    bad.ping.mockImplementation(() => {
      throw new Error('WebSocket is not open: readyState 0 (CONNECTING)');
    });
    const good = new FakeSocket();
    wss.clients.add(bad);
    wss.clients.add(good);
    const stop = startHeartbeat(wss, TICK);

    jest.advanceTimersByTime(TICK);
    expect(bad.ping).toHaveBeenCalledTimes(1);
    expect(good.ping).toHaveBeenCalledTimes(1);
    stop();
  });

  it('registers one pong listener per socket, however many ticks', () => {
    const ws = new FakeSocket();
    const onSpy = jest.spyOn(ws, 'on');
    ws.ping.mockImplementation(() => ws.pong());
    wss.clients.add(ws);
    const stop = startHeartbeat(wss, TICK);

    jest.advanceTimersByTime(TICK * 3);
    expect(onSpy).toHaveBeenCalledTimes(1);
    stop();
  });
});
