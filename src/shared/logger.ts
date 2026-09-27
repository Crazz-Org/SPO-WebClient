/**
 * Structured logging system for SPO v2
 *
 * Supports structured fields (player, correlationId), NDJSON output mode,
 * file transport with rotation, per-session ring buffer for error context,
 * and a separate error-only log file for fast AI triage.
 */

import { config } from './config';
import { FileTransport } from './log-transport';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
}

const LOG_LEVEL_NAMES: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: 'DEBUG',
  [LogLevel.INFO]: 'INFO',
  [LogLevel.WARN]: 'WARN',
  [LogLevel.ERROR]: 'ERROR',
};

const LOG_LEVEL_COLORS: Record<LogLevel, string> = {
  [LogLevel.DEBUG]: '\x1b[36m', // Cyan
  [LogLevel.INFO]: '\x1b[32m',  // Green
  [LogLevel.WARN]: '\x1b[33m',  // Yellow
  [LogLevel.ERROR]: '\x1b[31m', // Red
};

const RESET_COLOR = '\x1b[0m';

function parseLogLevel(level: string): LogLevel {
  switch (level.toLowerCase()) {
    case 'debug': return LogLevel.DEBUG;
    case 'info': return LogLevel.INFO;
    case 'warn': return LogLevel.WARN;
    case 'error': return LogLevel.ERROR;
    default: return LogLevel.INFO;
  }
}

const currentLogLevel = parseLogLevel(config.logging.level);

// ── File Transports (server-only singletons) ──────────────────────────

let fileTransport: FileTransport | null = null;
if (config.logging.filePath && typeof window === 'undefined') {
  fileTransport = new FileTransport({
    filePath: config.logging.filePath,
    maxFileSize: config.logging.maxFileSize,
    maxFiles: config.logging.maxFiles,
  });
}

let errorFileTransport: FileTransport | null = null;
if (config.logging.errorFilePath && typeof window === 'undefined') {
  errorFileTransport = new FileTransport({
    filePath: config.logging.errorFilePath,
    maxFileSize: config.logging.maxFileSize,
    maxFiles: config.logging.maxFiles,
  });
}

// ── Ring Buffer ────────────────────────────────────────────────────────

/** Circular buffer that keeps the last N log entries for error context. */
export class LogRingBuffer {
  private entries: Record<string, unknown>[] = [];
  constructor(private maxSize: number) {}

  push(entry: Record<string, unknown>): void {
    if (this.entries.length >= this.maxSize) {
      this.entries.shift();
    }
    this.entries.push(entry);
  }

  /** Return all buffered entries and clear the buffer. */
  drain(): Record<string, unknown>[] {
    const result = [...this.entries];
    this.entries = [];
    return result;
  }

  get size(): number {
    return this.entries.length;
  }
}

// ── Session ID Generator ───────────────────────────────────────────────

/** Generate a unique, sortable session ID. */
export function generateSessionId(): string {
  const ts = Date.now().toString(36);
  return `s-${ts}-${crypto.randomUUID().replace(/-/g, '').substring(0, 12)}`;
}

// ── Logger ─────────────────────────────────────────────────────────────

/** Structured fields attached to every log line from this logger instance. */
export type LogFields = Record<string, string>;

export class Logger {
  private fields: LogFields;
  private ringBuffer: LogRingBuffer | null = null;

  constructor(private context: string, fields?: LogFields) {
    this.fields = fields ? { ...fields } : {};
  }

  /** Create a child logger that inherits this logger's fields plus extras.
   *  The ring buffer reference is shared (not copied) so all child loggers
   *  contribute to the same context window. */
  child(extraFields: LogFields): Logger {
    const c = new Logger(this.context, { ...this.fields, ...extraFields });
    c.ringBuffer = this.ringBuffer;
    return c;
  }

  /** Enable a ring buffer on this logger. Returns `this` for chaining. */
  withRingBuffer(size: number): Logger {
    this.ringBuffer = new LogRingBuffer(size);
    return this;
  }

  /** Set or clear a mutable field (e.g. correlationId that changes per-request). */
  setField(key: string, value: string | null): void {
    if (value === null) {
      delete this.fields[key];
    } else {
      this.fields[key] = value;
    }
  }

  debug(message: string, meta?: unknown) {
    this.log(LogLevel.DEBUG, message, meta);
  }

  info(message: string, meta?: unknown) {
    this.log(LogLevel.INFO, message, meta);
  }

  warn(message: string, meta?: unknown) {
    this.log(LogLevel.WARN, message, meta);
  }

  error(message: string, meta?: unknown) {
    this.log(LogLevel.ERROR, message, meta);
  }

  /**
   * Write a line whatever `LOG_LEVEL` says.
   *
   * Reserved for the boot-time compliance record (policy SEC-R-2): the effective security
   * configuration must be readable in the log of *any* production deployment, and `warn`
   * and `error` are both compliant levels (SEC-L-2 asks for "info or stricter"). A plain
   * `info` line would therefore be filtered away on exactly the deployments that are most
   * locked down. `level` still tags the entry, so a warning still reads and routes as one.
   *
   * Nothing else should use this — an unfiltered line defeats the point of LOG_LEVEL.
   */
  always(level: LogLevel, message: string, meta?: unknown) {
    this.log(level, message, meta, true);
  }

  private log(level: LogLevel, message: string, meta?: unknown, force = false) {
    if (!force && level < currentLogLevel) {
      return;
    }

    const timestamp = new Date().toISOString();
    const levelName = LOG_LEVEL_NAMES[level];

    // --- NDJSON line (always built for file transport, and for console in JSON mode) ---
    const jsonEntry: Record<string, unknown> = {
      ts: timestamp,
      level: levelName,
      ctx: this.context,
      msg: message,
      ...this.fields,
    };

    if (meta !== undefined) {
      jsonEntry.meta = meta instanceof Error
        ? { error: meta.message, stack: meta.stack }
        : meta;
    }

    // --- Ring buffer: capture context for errors ---
    if (this.ringBuffer) {
      if (level < LogLevel.ERROR) {
        // Buffer non-error entries as context
        this.ringBuffer.push({ ...jsonEntry });
      } else {
        // On error: drain recent context and attach to this entry
        const context = this.ringBuffer.drain();
        if (context.length > 0) {
          jsonEntry.recentContext = context;
        }
      }
    }

    // Write to main file transport (always NDJSON regardless of console mode)
    if (fileTransport) {
      fileTransport.write(JSON.stringify(jsonEntry));
    }

    // Write to error-only file transport
    if (errorFileTransport && level >= LogLevel.ERROR) {
      errorFileTransport.write(JSON.stringify(jsonEntry));
    }

    // --- Console output ---
    if (config.logging.jsonMode) {
      // JSON mode: emit NDJSON to console too
      const jsonLine = JSON.stringify(jsonEntry);
      this.consoleWrite(level, jsonLine);
    } else {
      // Human-readable mode (existing behavior)
      const contextStr = this.context ? `[${this.context}]` : '';
      const fieldsStr = Object.keys(this.fields).length > 0
        ? ` {${Object.entries(this.fields).map(([k, v]) => `${k}=${v}`).join(', ')}}`
        : '';

      let logMessage: string;
      if (config.logging.colorize) {
        const color = LOG_LEVEL_COLORS[level];
        logMessage = `${color}${timestamp} ${levelName.padEnd(5)}${RESET_COLOR} ${contextStr}${fieldsStr} ${message}`;
      } else {
        logMessage = `${timestamp} ${levelName.padEnd(5)} ${contextStr}${fieldsStr} ${message}`;
      }

      if (meta !== undefined) {
        logMessage += ` ${meta instanceof Error ? (meta.stack ?? meta.message) : JSON.stringify(meta)}`;
      }

      this.consoleWrite(level, logMessage);
    }
  }

  private consoleWrite(level: LogLevel, message: string): void {
    switch (level) {
      case LogLevel.DEBUG:
      case LogLevel.INFO:
        console.log(message);
        break;
      case LogLevel.WARN:
        console.warn(message);
        break;
      case LogLevel.ERROR:
        console.error(message);
        break;
    }
  }
}

/** Access the module-level file transport (for the debug-log endpoint). */
export function getFileTransport(): FileTransport | null {
  return fileTransport;
}

/** Access the error-only file transport (for client debug reports). */
export function getErrorFileTransport(): FileTransport | null {
  return errorFileTransport;
}

/** Flush and close both file transports (whichever exist). Awaited by graceful shutdown before process.exit. */
export async function closeLogTransports(): Promise<void> {
  await Promise.all([fileTransport?.close(), errorFileTransport?.close()]);
}

export function createLogger(context: string): Logger {
  return new Logger(context);
}
