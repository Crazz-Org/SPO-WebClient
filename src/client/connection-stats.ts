export interface ConnectionStatsSnapshot {
  latencyMs: number | null;
  latencySamples: number;
  bytesSent: number;
  bytesReceived: number;
  sentBytesPerSec: number;
  receivedBytesPerSec: number;
}

const RATE_WINDOW_MS = 2_000;

/** UTF-8 size without allocating a copy of the payload. */
export function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) {
      bytes += 1;
    } else if (code < 0x800) {
      bytes += 2;
    } else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i++;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

/** "834 B", "12.4 KB", "3.1 MB" */
export function formatByteCount(bytes: number): string {
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export class ConnectionStats {
  private bytesSent = 0;
  private bytesReceived = 0;
  private sentBytesPerSec = 0;
  private receivedBytesPerSec = 0;
  private windowStart: number | null = null;
  private windowSent = 0;
  private windowReceived = 0;
  private latencyMs: number | null = null;
  private latencySamples = 0;

  private rollWindow(now: number): void {
    if (this.windowStart === null) {
      this.windowStart = now;
      return;
    }
    const elapsed = now - this.windowStart;
    if (elapsed >= RATE_WINDOW_MS) {
      this.sentBytesPerSec = Math.round((this.windowSent * 1000) / elapsed);
      this.receivedBytesPerSec = Math.round((this.windowReceived * 1000) / elapsed);
      this.windowStart = now;
      this.windowSent = 0;
      this.windowReceived = 0;
    }
  }

  recordSent(bytes: number, now: number = Date.now()): void {
    this.rollWindow(now);
    this.bytesSent += bytes;
    this.windowSent += bytes;
  }

  recordReceived(bytes: number, now: number = Date.now()): void {
    this.rollWindow(now);
    this.bytesReceived += bytes;
    this.windowReceived += bytes;
  }

  setLatency(latencyMs: number | null, samples: number): void {
    this.latencyMs = latencyMs;
    this.latencySamples = samples;
  }

  snapshot(now: number = Date.now()): ConnectionStatsSnapshot {
    this.rollWindow(now);
    return {
      latencyMs: this.latencyMs,
      latencySamples: this.latencySamples,
      bytesSent: this.bytesSent,
      bytesReceived: this.bytesReceived,
      sentBytesPerSec: this.sentBytesPerSec,
      receivedBytesPerSec: this.receivedBytesPerSec,
    };
  }

  reset(): void {
    this.bytesSent = 0;
    this.bytesReceived = 0;
    this.sentBytesPerSec = 0;
    this.receivedBytesPerSec = 0;
    this.windowStart = null;
    this.windowSent = 0;
    this.windowReceived = 0;
    this.latencyMs = null;
    this.latencySamples = 0;
  }
}

export const connectionStats = new ConnectionStats();
