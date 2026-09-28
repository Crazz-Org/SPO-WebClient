# Logging System

Structured logging with session tracking, error context, NDJSON output, and file rotation.

## Architecture

```
                  Logger (src/shared/logger.ts)
                  ├── Console output (human-readable or NDJSON)
                  ├── FileTransport → logs/gateway.ndjson (all levels)
                  └── FileTransport → logs/errors.ndjson  (ERROR only, with recentContext)
```

Each server module creates its own logger via `createLogger(context)`. Each WebSocket connection gets a unique session ID (`sid`) that propagates to every log line via `.child()` inheritance. Session loggers also have a ring buffer that captures recent entries and attaches them as context when an error occurs.

## Quick Start

### Enable file logging

```bash
LOG_FILE=logs/gateway.ndjson        # All logs
LOG_ERROR_FILE=logs/errors.ndjson   # Errors only (with context)
LOG_JSON=true                       # NDJSON on console too
LOG_LEVEL=info                      # debug | info | warn | error
```

### Docker deployment

The `docker-compose.yml` bind-mounts `./logs` to the host:

```yaml
volumes:
  - ./logs:/app/logs
```

The container runs as user `spo` (UID 1001). Create the host directory with correct ownership:

```bash
sudo mkdir -p /opt/spo-webclient/logs
sudo chown 1001:1001 /opt/spo-webclient/logs
```

### Query logs

```bash
# All errors (small file, each includes recent context)
cat logs/errors.ndjson | jq .

# All logs for a specific session
cat logs/gateway.ndjson | jq 'select(.sid == "s-m1abc2d-x7k2")'

# All logs for a player
cat logs/gateway.ndjson | jq 'select(.player == "SPO_test3")'

# Session boundaries (start/end with duration)
cat logs/gateway.ndjson | jq 'select(.msg == "SESSION_START" or .msg == "SESSION_END")'

# Track a request chain by correlation ID
cat logs/gateway.ndjson | jq 'select(.corrId == "ws-1743608105000-req47")'

# Timeline for a player (compact)
cat logs/gateway.ndjson | jq -c 'select(.player == "SPO_test3") | {ts, level, ctx, msg}'
```

Requires [jq](https://jqlang.github.io/jq/).

## Configuration Reference

| Env Variable           | Default               | Description                                            |
|------------------------|-----------------------|--------------------------------------------------------|
| `LOG_LEVEL`            | `info`                | Minimum level: `debug`, `info`, `warn`, `error`        |
| `LOG_JSON`             | `false`               | NDJSON output on console (file is always NDJSON)        |
| `LOG_FILE`             | *(empty = disabled)*  | File path for all NDJSON output                         |
| `LOG_ERROR_FILE`       | *(empty = disabled)*  | Separate file for ERROR entries (with recent context)   |
| `LOG_MAX_SIZE`         | `10485760` (10 MB)    | Max file size before rotation                           |
| `LOG_MAX_FILES`        | `5`                   | Number of rotated files to keep                         |
| `LOG_RING_BUFFER_SIZE` | `20`                  | Recent entries kept per session for error context        |

**Rotation:** When a log file exceeds `LOG_MAX_SIZE`, it is renamed to `.1`, previous `.1` becomes `.2`, etc. Files beyond `LOG_MAX_FILES` are deleted. Both `LOG_FILE` and `LOG_ERROR_FILE` rotate independently. Each file keeps the current file plus `LOG_MAX_FILES` rotated ones, so its ceiling is `(LOG_MAX_FILES + 1) × LOG_MAX_SIZE`.

**Writing and shutdown:** each file is written through one append-mode stream (`FileTransport` in `src/shared/log-transport.ts`), so logging a line never blocks the gateway on a file call. The rotation is decided when the line is logged and carried out asynchronously between two lines: no line is lost, duplicated or put in the wrong file. Lines waiting for the disk are held in memory up to 8 MB per file; beyond that, whole lines are dropped. If the file cannot be written (full disk, broken mount), one line goes to stderr, lines are dropped while the file is unavailable, and the file is reopened every 30 s; on success a `resumed, N lines dropped` line follows on stderr. The console copy of every line is unaffected. Because writes are asynchronous, the last lines before `process.exit` are lost unless shutdown first awaits `closeLogTransports()` (`src/shared/logger.ts`), which flushes and closes both files.

**Production:** `LOG_LEVEL=debug` may log session IDs, so `info` is the default and the policy floor (SEC-L-2). With `NODE_ENV=production` the gateway **refuses to start** on an explicit `LOG_LEVEL=debug` (`src/server/production-config.ts`). Ask for `debug` explicitly when developing.

## Log Files

| File | Content | Typical size |
|------|---------|--------------|
| `logs/gateway.ndjson` | All log entries (DEBUG through ERROR) | Large — all session activity |
| `logs/errors.ndjson` | ERROR entries only, each with `recentContext` | Small — fast to scan |

## NDJSON Line Format

### Standard log entry

```json
{
  "ts": "2026-04-02T20:37:50.123Z",
  "level": "INFO",
  "ctx": "Session",
  "msg": "WS>> REQ_PLACE_BUILDING",
  "sid": "s-m1abc2d-x7k2",
  "player": "SPO_test3",
  "tycoonId": "T42",
  "corrId": "ws-1743608105000-req47"
}
```

### Error entry (in `errors.ndjson`)

```json
{
  "ts": "2026-04-02T20:37:52.456Z",
  "level": "ERROR",
  "ctx": "Session",
  "msg": "[Construction] Failed to place building",
  "sid": "s-m1abc2d-x7k2",
  "player": "SPO_test3",
  "tycoonId": "T42",
  "corrId": "ws-1743608105000-req47",
  "meta": { "error": "Socket timeout", "stack": "..." },
  "recentContext": [
    { "ts": "...", "level": "INFO", "msg": "WS>> REQ_PLACE_BUILDING", "sid": "s-m1abc2d-x7k2", "player": "SPO_test3" },
    { "ts": "...", "level": "DEBUG", "msg": "Sending CreateObj to map socket", "sid": "s-m1abc2d-x7k2" },
    { "ts": "...", "level": "DEBUG", "msg": "Response timeout after 10000ms", "sid": "s-m1abc2d-x7k2" }
  ]
}
```

### Session lifecycle markers

```json
{"ts": "...", "level": "INFO", "ctx": "Session", "msg": "SESSION_START", "sid": "s-m1abc2d-x7k2", "meta": {"ip": "1.2.3.4"}}
{"ts": "...", "level": "INFO", "ctx": "Session", "msg": "SESSION_END", "sid": "s-m1abc2d-x7k2", "player": "SPO_test3", "meta": {"ip": "1.2.3.4", "durationMs": "45230", "phase": "5"}}
```

### CLIENT_ERROR (browser error report)

A report posted by a player's browser to `POST /api/client-error` (uncaught error, unhandled
rejection, error-boundary catch, failed lazy chunk) becomes exactly one line in `gateway.ndjson`:

```json
{"ts": "...", "level": "WARN", "ctx": "ClientError", "msg": "CLIENT_ERROR", "meta": {"sig": "3f9a1c0b7d2e", "kind": "error", "build": "1.4.2#317", "message": "x is undefined", "frames": ["main.abc.js:1:2345"], "screen": "game", "surface": "building", "ua": "firefox", "mobile": false}}
```

- `sig` is the first 12 hex characters of sha1 over `kind`, `message` and `frames`, so identical
  errors group together.
- The line **never** contains a client IP, a session id, a username, a world or a tycoon: the
  endpoint is anonymous and refuses any field outside the list above. It is logged at `warn`,
  so it never reaches the ERROR-only error file, which stays for the gateway's own failures.
- `CLIENT_ERROR_CAP_REACHED` (`warn`, `ctx: "ClientError"`) is written at most once per minute,
  when the gateway-wide cap of 60 accepted reports per minute is hit.

Most frequent browser errors:

```bash
jq 'select(.msg=="CLIENT_ERROR") | .meta.sig' gateway.ndjson | sort | uniq -c | sort -rn
```

### Field reference

| Field            | Always present | Description                                          |
|------------------|----------------|------------------------------------------------------|
| `ts`             | yes            | ISO 8601 timestamp                                   |
| `level`          | yes            | `DEBUG`, `INFO`, `WARN`, `ERROR`                     |
| `ctx`            | yes            | Logger context (`Gateway`, `Session`, `ClientWire`, `ClientError`) |
| `msg`            | yes            | Human-readable message                               |
| `sid`            | session logs   | Unique session ID per WebSocket connection             |
| `player`         | after login    | Player username (inherited via child logger)          |
| `tycoonId`       | after login    | Tycoon ID (inherited via child logger)                |
| `corrId`         | per-request    | Correlation ID for request/response pairing           |
| `meta`           | optional       | Extra data (errors include `error` + `stack`)         |
| `recentContext`  | errors only    | Ring buffer drain — last N entries before this error   |

## AI Triage Workflow

When diagnosing an issue from a log dump:

```bash
# 1. Start with errors.ndjson — small, each error has full context inline
cat logs/errors.ndjson | jq .

# 2. Each error has recentContext[] — no cross-referencing needed

# 3. To get the full session timeline for a specific error's session:
SID="s-m1abc2d-x7k2"
cat logs/gateway.ndjson | jq "select(.sid == \"$SID\")"

# 4. Find session boundaries:
cat logs/gateway.ndjson | jq "select(.sid == \"$SID\" and (.msg == \"SESSION_START\" or .msg == \"SESSION_END\"))"

# 5. All active sessions in a time window:
cat logs/gateway.ndjson | jq 'select(.msg == "SESSION_START") | {ts, sid, meta}'
```

## Usage in Code

### Create a logger

```typescript
import { createLogger } from '../shared/logger';

const logger = createLogger('MyService');

logger.info('Service started');
logger.debug('Processing item', { itemId: 42 });
logger.error('Failed to connect', error);  // Error stack included in meta
```

### Session loggers (automatic sid + ring buffer)

`StarpeaceSession` creates a logger with session ID and ring buffer automatically:

```typescript
// In spo_session.ts — done for you:
public readonly sid = generateSessionId();
public log = createLogger('Session').child({ sid: this.sid }).withRingBuffer(20);

// After player logs in — all subsequent logs include player + sid
this.log = this.log.child({ player: username });

// After tycoon loaded — adds tycoonId too
this.log = this.log.child({ tycoonId: id });
```

All child loggers share the same ring buffer, so the error context includes logs from both parent and child loggers.

### Child loggers (inherit fields)

```typescript
const parent = createLogger('Session').child({ sid: 's-abc-1234' });
const child = parent.child({ player: 'Alice' });
child.info('logged in');
// → {"ctx":"Session", "msg":"logged in", "sid":"s-abc-1234", "player":"Alice", ...}
```

### Mutable fields (per-request context)

```typescript
logger.setField('corrId', requestId);
logger.info('Handling request');        // includes corrId
logger.setField('corrId', null);        // clear after request
```

### Ring buffer for error context

```typescript
// Enable on any logger (usually only session loggers)
const log = createLogger('Session').withRingBuffer(20);

log.info('step 1');    // buffered
log.debug('step 2');   // buffered
log.error('crashed');  // recentContext: [{step 1}, {step 2}] attached to this entry
log.info('step 3');    // buffer was drained, starts fresh
log.error('again');    // recentContext: [{step 3}]
```

## Client-Side Debug Reports

Players can submit their WebSocket wire history to the server for analysis.

### How it works

1. The client tracks all WebSocket messages in `window.__spoDebug.history`
2. The **Settings dialog** has a **"Send Debug Report"** button
3. It POSTs to `POST /api/debug-log` with the player name and wire history
4. The server writes each entry to the NDJSON log file with context `ClientWire`

### Endpoint: `POST /api/debug-log`

**Request:**
```json
{
  "player": "SPO_test3",
  "history": [
    { "dir": "SEND", "type": "TycoonGetMain", "ts": 1743676670123, "reqId": "ws-42" },
    { "dir": "RECV", "type": "TycoonMain", "ts": 1743676670456 }
  ]
}
```

**Response:**
```json
{ "ok": true, "entries": 2 }
```

**Constraints:**
- Requires `LOG_FILE` to be set (returns 503 otherwise)
- Rate limited: 2 reports per IP per 60 seconds (429)
- Max payload: 512 KB (413)
- Max entries per report: 200 (capped silently)

### Querying client wire logs

```bash
cat logs/gateway.ndjson | jq 'select(.ctx == "ClientWire" and .player == "SPO_test3")'
```

## File Locations

| File | Purpose |
|------|---------|
| `src/shared/logger.ts` | Logger class, ring buffer, session ID, NDJSON formatting |
| `src/shared/log-transport.ts` | FileTransport with size-based rotation |
| `src/shared/config.ts` | `config.logging.*` — env var parsing |
| `src/server/spo_session.ts` | Session with sid, startedAt, child loggers |
| `src/server/server.ts` | SESSION_START/END markers, `POST /api/debug-log` |
| `logs/gateway.ndjson` | All log entries (git-ignored) |
| `logs/errors.ndjson` | Error entries with context (git-ignored) |
