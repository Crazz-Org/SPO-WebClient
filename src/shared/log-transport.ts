/**
 * File transport for structured logging with size-based rotation.
 *
 * Each transport writes through one append-mode stream, so logging a line never
 * blocks the main thread on a synchronous file call. Rotation is an ordered
 * asynchronous step between lines; `close()` flushes everything accepted.
 *
 * Server-only — entire module is a no-op when running in the browser.
 */

import { toErrorMessage } from './error-utils';

// Minimal structural types so this server-only module also typechecks under
// tsconfig.client.json (no @types/node there). The runtime objects are the
// real Node 'fs'/'path' modules; only the surface we use is declared.
interface WriteStreamLike {
  write(data: string): boolean;
  end(): void;
  destroy(): void;
  on(ev: 'error', fn: (err: unknown) => void): unknown;
  on(ev: 'open' | 'close', fn: () => void): unknown;
  readonly writableLength: number;
}
interface NodeFsLike {
  mkdirSync(dir: string, opts: { recursive: boolean }): void;
  statSync(p: string): { size: number };
  createWriteStream(p: string, opts: { flags: string }): WriteStreamLike;
  promises: {
    rename(oldPath: string, newPath: string): Promise<void>;
    unlink(p: string): Promise<void>;
  };
}
interface NodePathLike {
  dirname(p: string): string;
}

// Module-scoped ambient shadows: keep the browser tsconfig (no node globals)
// happy while the server build still resolves the real CommonJS require.
declare const process: unknown;
declare function require(id: string): unknown;

// Browser-safe guard: skip everything if we're not in Node.js
const isNode = typeof window === 'undefined' && typeof process !== 'undefined';


// Dynamic require so bundlers don't try to include 'fs' / 'path' in browser builds
const fs: NodeFsLike | null = isNode ? (require('fs') as NodeFsLike) : null;
const path: NodePathLike | null = isNode ? (require('path') as NodePathLike) : null;

/** Default cap on bytes held in memory waiting for the disk. */
export const MAX_BUFFERED_BYTES = 8 * 1024 * 1024;
/** Delay before a failed file is reopened. */
export const ERROR_RETRY_MS = 30_000;

/** Queue marker: rotate the files before writing the lines that follow. */
const ROTATE = Symbol('rotate');
type QueueItem = typeof ROTATE | { data: string; size: number };

/** One line straight to stderr — never through Logger, which would recurse. */
function stderrLine(msg: string): void {
  const proc = process as { stderr?: { write?: (s: string) => unknown } };
  proc.stderr?.write?.(msg + '\n');
}

/** End a stream and resolve once it has closed (every accepted byte is on disk). */
function endAndWait(stream: WriteStreamLike): Promise<void> {
  return new Promise<void>((resolve) => {
    stream.on('close', () => resolve());
    stream.end();
  });
}

export interface FileTransportOptions {
  filePath: string;
  maxFileSize: number;
  maxFiles: number;
  /** Bytes allowed in memory before lines are dropped (default MAX_BUFFERED_BYTES). */
  maxBufferedBytes?: number;
}

export class FileTransport {
  private readonly filePath: string;
  private readonly maxFileSize: number;
  private readonly maxFiles: number;
  private readonly maxBufferedBytes: number;
  private currentSize: number;

  private stream: WriteStreamLike | null = null;
  private readonly queue: QueueItem[] = [];
  private queuedBytes = 0;
  private pump: Promise<void> | null = null;

  /** Set while the file is unavailable; the time of the last failure. */
  private failedAt: number | null = null;
  /** True from the first write error until a reopen succeeds. */
  private suspended = false;
  private errorDropped = 0;
  private capDropped = 0;

  private closing: Promise<void> | null = null;

  constructor(options: FileTransportOptions) {
    this.filePath = options.filePath;
    this.maxFileSize = options.maxFileSize;
    this.maxFiles = options.maxFiles;
    this.maxBufferedBytes = options.maxBufferedBytes ?? MAX_BUFFERED_BYTES;
    this.currentSize = 0;

    if (!fs || !path) return;

    try {
      // Ensure log directory exists
      const dir = path.dirname(this.filePath);
      fs.mkdirSync(dir, { recursive: true });

      // Get current file size if it already exists
      const stat = fs.statSync(this.filePath);
      this.currentSize = stat.size;
    } catch {
      // Directory creation or stat failed (permissions, etc.) — the first
      // write reports the failure on stderr; console transport still works.
      this.currentSize = 0;
    }
  }

  /** Accept one line. Never throws; the line reaches the file asynchronously. */
  write(line: string): void {
    if (!fs || !path || this.closing) return;

    try {
      if (this.failedAt !== null) {
        if (Date.now() - this.failedAt < ERROR_RETRY_MS) {
          this.errorDropped++;
          return;
        }
        this.failedAt = null; // retry: the next open tries the file again
      }

      const data = line + '\n';
      // TextEncoder (global in Node ≥ 11 and browsers) — avoids the node-only Buffer global
      const dataSize = new TextEncoder().encode(data).length;

      const buffered = (this.stream?.writableLength ?? 0) + this.queuedBytes;
      if (buffered + dataSize > this.maxBufferedBytes) {
        if (this.capDropped === 0) {
          stderrLine(`[FileTransport] ${this.filePath}: write buffer full (${this.maxBufferedBytes} bytes), dropping log lines`);
        }
        this.capDropped++;
        return;
      }
      if (this.capDropped > 0) {
        stderrLine(`[FileTransport] ${this.filePath}: resumed, ${this.capDropped} lines dropped`);
        this.capDropped = 0;
      }

      // Rotation is decided here, synchronously, so each line is measured
      // against the file it will land in; the rotation itself is queued.
      if (this.currentSize + dataSize > this.maxFileSize && this.currentSize > 0) {
        this.queue.push(ROTATE);
        this.currentSize = 0;
      }
      this.currentSize += dataSize;

      if (this.queue.length > 0 || this.pump) {
        this.queue.push({ data, size: dataSize });
        this.queuedBytes += dataSize;
        if (!this.pump) {
          const fsMod = fs;
          this.pump = Promise.resolve().then(() => this.drain(fsMod));
        }
      } else {
        this.writeLine(fs, data);
      }
    } catch {
      // A logging failure must never crash the server.
    }
  }

  /** Drain the queue in order: rotations and lines, one at a time. */
  private async drain(fsMod: NodeFsLike): Promise<void> {
    for (let item = this.queue.shift(); item !== undefined; item = this.queue.shift()) {
      try {
        if (item === ROTATE) {
          await this.rotate(fsMod);
        } else {
          this.queuedBytes -= item.size;
          this.writeLine(fsMod, item.data);
        }
      } catch {
        // Never reject: the pump must keep draining.
      }
    }
    this.pump = null;
  }

  private writeLine(fsMod: NodeFsLike, data: string): void {
    if (this.failedAt !== null) {
      this.errorDropped++;
      return;
    }
    const stream = this.stream ?? this.openStream(fsMod);
    stream.write(data);
  }

  private openStream(fsMod: NodeFsLike): WriteStreamLike {
    const stream = fsMod.createWriteStream(this.filePath, { flags: 'a' });
    // An unhandled stream 'error' would crash the gateway — always listen.
    stream.on('error', (err) => this.onStreamError(stream, err));
    stream.on('open', () => this.onStreamOpen());
    this.stream = stream;
    return stream;
  }

  private onStreamError(stream: WriteStreamLike, err: unknown): void {
    if (this.stream === stream) this.stream = null;
    stream.destroy();
    if (!this.suspended) {
      this.suspended = true;
      stderrLine(`[FileTransport] ${this.filePath}: write failed (${toErrorMessage(err)}) — file logging suspended, retrying every ${ERROR_RETRY_MS / 1000} s`);
    }
    this.failedAt = Date.now();
  }

  private onStreamOpen(): void {
    if (!this.suspended) return;
    stderrLine(`[FileTransport] ${this.filePath}: resumed, ${this.errorDropped} lines dropped`);
    this.suspended = false;
    this.errorDropped = 0;
  }

  /** Close the current file, then shift current → .1 → … → .maxFiles (oldest deleted). */
  private async rotate(fsMod: NodeFsLike): Promise<void> {
    const stream = this.stream;
    if (stream) {
      this.stream = null;
      await endAndWait(stream);
    }

    // Delete the oldest rotated file if it would exceed maxFiles
    try { await fsMod.promises.unlink(`${this.filePath}.${this.maxFiles}`); } catch { /* doesn't exist */ }

    // Shift existing rotated files: .N-1 → .N, .N-2 → .N-1, ... .1 → .2
    for (let i = this.maxFiles - 1; i >= 1; i--) {
      try {
        await fsMod.promises.rename(`${this.filePath}.${i}`, `${this.filePath}.${i + 1}`);
      } catch {
        // File doesn't exist yet — skip
      }
    }

    // Rename current file to .1
    try {
      await fsMod.promises.rename(this.filePath, `${this.filePath}.1`);
    } catch {
      // Current file doesn't exist — skip
    }
    // The next line opens a fresh stream lazily.
  }

  /**
   * Flush every accepted line (finishing any queued rotation), end the stream
   * and resolve once it has closed. Idempotent; writes after close are dropped.
   */
  close(): Promise<void> {
    if (!this.closing) this.closing = this.flushAndClose();
    return this.closing;
  }

  private async flushAndClose(): Promise<void> {
    while (this.pump) await this.pump;
    const stream = this.stream;
    if (stream) {
      this.stream = null;
      await endAndWait(stream);
    }
  }
}
