import { describe, it, expect } from '@jest/globals';
import {
  WsMessageGuard,
  WS_MESSAGE_RATE_PER_SECOND,
  WS_MESSAGE_BURST,
  WS_MAX_QUEUED_MESSAGES,
  WS_GUARD_CLOSE_CODE,
  WS_RATE_EXCEEDED_REASON,
  WS_QUEUE_EXCEEDED_REASON,
} from './ws-message-guard';

function makeGuard(): { guard: WsMessageGuard; advance: (ms: number) => void } {
  let t = 0;
  const guard = new WsMessageGuard(
    { ratePerSecond: WS_MESSAGE_RATE_PER_SECOND, burst: WS_MESSAGE_BURST, maxQueued: WS_MAX_QUEUED_MESSAGES },
    () => t,
  );
  return { guard, advance: (ms: number) => { t += ms; } };
}

describe('WsMessageGuard constants (maintainer decision 2026-09-27, SEC-W-6)', () => {
  it('carries 20/s, burst 50, 100 queued, close 1008 and the exact reasons', () => {
    expect(WS_MESSAGE_RATE_PER_SECOND).toBe(20);
    expect(WS_MESSAGE_BURST).toBe(50);
    expect(WS_MAX_QUEUED_MESSAGES).toBe(100);
    expect(WS_GUARD_CLOSE_CODE).toBe(1008);
    expect(WS_RATE_EXCEEDED_REASON).toBe('Message rate exceeded');
    expect(WS_QUEUE_EXCEEDED_REASON).toBe('Too many queued messages');
  });
});

describe('WsMessageGuard token bucket', () => {
  it('allows a burst of 50 at once and refuses the 51st', () => {
    const { guard } = makeGuard();
    for (let i = 0; i < 50; i++) expect(guard.takeToken()).toBe(true);
    expect(guard.takeToken()).toBe(false);
  });

  it('refills one token every 50 ms (20/s)', () => {
    const { guard, advance } = makeGuard();
    for (let i = 0; i < 50; i++) guard.takeToken();
    expect(guard.takeToken()).toBe(false);
    advance(50);
    expect(guard.takeToken()).toBe(true);
    expect(guard.takeToken()).toBe(false);
  });

  it('never refuses a sender at 20 messages/s for 10 s', () => {
    const { guard, advance } = makeGuard();
    for (let i = 0; i < 200; i++) {
      expect(guard.takeToken()).toBe(true);
      advance(50);
    }
  });

  it('caps the bucket at the burst after a long idle', () => {
    const { guard, advance } = makeGuard();
    advance(60_000);
    for (let i = 0; i < 50; i++) expect(guard.takeToken()).toBe(true);
    expect(guard.takeToken()).toBe(false);
  });

  it('defaults to Date.now for the clock', () => {
    const guard = new WsMessageGuard({ ratePerSecond: 20, burst: 1, maxQueued: 1 });
    expect(guard.takeToken()).toBe(true);
  });
});

describe('WsMessageGuard queue depth', () => {
  it('accepts 100 unsettled enqueues, refuses the 101st, and frees one place per settle', () => {
    const { guard } = makeGuard();
    for (let i = 0; i < 100; i++) expect(guard.enqueue()).toBe(true);
    expect(guard.enqueue()).toBe(false);
    expect(guard.queued).toBe(100);
    guard.settle();
    expect(guard.queued).toBe(99);
    expect(guard.enqueue()).toBe(true);
    expect(guard.enqueue()).toBe(false);
  });

  it('never settles below zero', () => {
    const { guard } = makeGuard();
    guard.settle();
    expect(guard.queued).toBe(0);
    expect(guard.enqueue()).toBe(true);
    expect(guard.queued).toBe(1);
  });
});
