export interface LatencySnapshot {
  /** Rounded mean of the window, or null when no round trip has been measured yet. */
  latencyMs: number | null;
  /** How many round trips the mean averages. */
  samples: number;
}

const DEFAULT_WINDOW_SIZE = 10;

/** A rolling mean over the last N resolved RDO round trips. Pure — fed durations, no clock of its own. */
export class LatencyTracker {
  private readonly windowSize: number;
  private durations: number[] = [];

  constructor(windowSize: number = DEFAULT_WINDOW_SIZE) {
    this.windowSize = windowSize;
  }

  /** Ignores anything not finite or negative — a clock that went backwards is not a sample. */
  record(durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) return;
    this.durations.push(durationMs);
    if (this.durations.length > this.windowSize) {
      this.durations.shift();
    }
  }

  snapshot(): LatencySnapshot {
    if (this.durations.length === 0) {
      return { latencyMs: null, samples: 0 };
    }
    const sum = this.durations.reduce((a, b) => a + b, 0);
    return {
      latencyMs: Math.round(sum / this.durations.length),
      samples: this.durations.length,
    };
  }

  reset(): void {
    this.durations = [];
  }
}
