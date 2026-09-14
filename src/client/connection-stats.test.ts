import { ConnectionStats, utf8ByteLength, formatByteCount } from './connection-stats';

describe('utf8ByteLength', () => {
  it('counts ASCII as 1 byte per char', () => {
    expect(utf8ByteLength('abc')).toBe(3);
  });

  it('counts an accented character as 2 bytes', () => {
    expect(utf8ByteLength('é')).toBe(2);
  });

  it('counts a CJK character as 3 bytes', () => {
    expect(utf8ByteLength('中')).toBe(3);
  });

  it('counts an emoji surrogate pair as 4 bytes', () => {
    expect(utf8ByteLength('😀')).toBe(4);
  });
});

describe('formatByteCount', () => {
  it('formats sub-KB counts as bytes', () => {
    expect(formatByteCount(834)).toBe('834 B');
  });

  it('formats KB-range counts', () => {
    expect(formatByteCount(12_400)).toBe('12.1 KB');
  });

  it('formats MB-range counts', () => {
    expect(formatByteCount(3_250_000)).toBe('3.1 MB');
  });
});

describe('ConnectionStats', () => {
  it('accumulates byte totals', () => {
    const stats = new ConnectionStats();
    stats.recordSent(100, 0);
    stats.recordSent(50, 100);
    stats.recordReceived(200, 100);
    const snap = stats.snapshot(100);
    expect(snap.bytesSent).toBe(150);
    expect(snap.bytesReceived).toBe(200);
  });

  it('rolls the rate window at the threshold', () => {
    const stats = new ConnectionStats();
    stats.recordSent(2000, 0);
    // Not yet rolled
    expect(stats.snapshot(1000).sentBytesPerSec).toBe(0);
    // Rolls at 2000ms elapsed: 2000 bytes / 2s = 1000 B/s
    stats.recordSent(0, 2000);
    const snap = stats.snapshot(2000);
    expect(snap.sentBytesPerSec).toBe(1000);
  });

  it('decays the rate to 0 when only snapshot(now) advances', () => {
    const stats = new ConnectionStats();
    stats.recordSent(2000, 0);
    stats.snapshot(2000); // rolls, computes 1000 B/s, restarts window empty
    const decayed = stats.snapshot(4000); // rolls again with no new bytes
    expect(decayed.sentBytesPerSec).toBe(0);
  });

  it('leaves latencyMs null when set explicitly to null', () => {
    const stats = new ConnectionStats();
    stats.setLatency(null, 0);
    expect(stats.snapshot().latencyMs).toBeNull();
  });

  it('reflects a set latency', () => {
    const stats = new ConnectionStats();
    stats.setLatency(42, 3);
    const snap = stats.snapshot();
    expect(snap.latencyMs).toBe(42);
    expect(snap.latencySamples).toBe(3);
  });

  it('reset zeroes totals, rate and latency', () => {
    const stats = new ConnectionStats();
    stats.recordSent(500, 0);
    stats.recordReceived(500, 0);
    stats.setLatency(42, 3);
    stats.reset();
    const snap = stats.snapshot(0);
    expect(snap.bytesSent).toBe(0);
    expect(snap.bytesReceived).toBe(0);
    expect(snap.sentBytesPerSec).toBe(0);
    expect(snap.receivedBytesPerSec).toBe(0);
    expect(snap.latencyMs).toBeNull();
    expect(snap.latencySamples).toBe(0);
  });
});
