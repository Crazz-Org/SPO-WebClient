import { LatencyTracker } from './latency-tracker';

describe('LatencyTracker', () => {
  it('returns null latency and 0 samples when empty', () => {
    const tracker = new LatencyTracker();
    expect(tracker.snapshot()).toEqual({ latencyMs: null, samples: 0 });
  });

  it('averages three round trips of known duration', () => {
    const tracker = new LatencyTracker();
    tracker.record(100);
    tracker.record(200);
    tracker.record(300);
    expect(tracker.snapshot()).toEqual({ latencyMs: 200, samples: 3 });
  });

  it('evicts samples past the window size', () => {
    const tracker = new LatencyTracker(2);
    tracker.record(100);
    tracker.record(200);
    tracker.record(300);
    // window keeps only the last 2: 200, 300 -> mean 250
    expect(tracker.snapshot()).toEqual({ latencyMs: 250, samples: 2 });
  });

  it('ignores NaN and negative durations', () => {
    const tracker = new LatencyTracker();
    tracker.record(100);
    tracker.record(NaN);
    tracker.record(-5);
    expect(tracker.snapshot()).toEqual({ latencyMs: 100, samples: 1 });
  });

  it('resets to empty', () => {
    const tracker = new LatencyTracker();
    tracker.record(100);
    tracker.reset();
    expect(tracker.snapshot()).toEqual({ latencyMs: null, samples: 0 });
  });
});
