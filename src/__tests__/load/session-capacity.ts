/**
 * Pure helpers for the session-memory measurement (`session-memory.load.ts`).
 *
 * They turn "what one logged-in game session costs the gateway in memory" into a
 * recommended global session cap under the container's memory limit, read from
 * `docker-compose.yml`. No Jest and no file access here — the unit test and the
 * measurement both import this module.
 */

/**
 * Share of the container limit held back from the session budget.
 *
 * The measurement sees the memory a quiet, fully logged-in session keeps alive.
 * It does not see:
 * - zone and property replies in flight while a player moves the map;
 * - an `RdoFramer` buffer filling toward its 5 MB bound (`RdoFramer.MAX_BUFFER_SIZE`
 *   in `src/server/rdo.ts`);
 * - the WebSocket objects (`ws`) the gateway holds per client;
 * - the world connection pool's extra connections (the harness keeps the pool off,
 *   `HarnessConfig.worldPool`);
 * - garbage-collector headroom.
 */
export const SESSION_MEMORY_RESERVE = 0.25;

/**
 * Assumed idle-gateway RSS, in MiB, used when no measured value is supplied.
 *
 * The local bench gateway read about 101 MiB RSS in `ps` on 2026-09-27 (one
 * reading); 128 rounds it up. Replaced by a measured value through
 * `LOAD_BASELINE_RSS_MIB` once the gateway's `METRICS` log line (`memory.rssBytes`
 * while `sessions.total` is 0, issue #1057) is available in production.
 */
export const DEFAULT_BASELINE_RSS_MIB = 128;

export interface SessionCapInputs {
  containerLimitBytes: number;
  baselineRssBytes: number;
  perSessionBytes: number;
}

/** The committed output of `npm run load:sessions` (`session-capacity.json`). */
export interface SessionCapacityRecord {
  measuredAt: string;
  node: string;
  sessions: number;
  perSessionHeapBytes: number;
  perSessionRssBytes: number;
  perSessionBytes: number;
  baselineRssBytes: number;
  baselineSource: 'assumed' | 'measured';
  containerLimitBytes: number;
  reserve: number;
  recommendedCap: number;
}

/**
 * cap = floor((limit × (1 − reserve) − baseline) / perSession), rounded down to a
 * multiple of 10. Throws when the budget is empty or the cap would be below 10.
 */
export function recommendSessionCap(inputs: SessionCapInputs): number {
  const { containerLimitBytes, baselineRssBytes, perSessionBytes } = inputs;
  if (!Number.isFinite(perSessionBytes) || perSessionBytes <= 0) {
    throw new Error(`perSessionBytes must be a finite number > 0, got ${perSessionBytes}`);
  }
  const budget = containerLimitBytes * (1 - SESSION_MEMORY_RESERVE) - baselineRssBytes;
  if (!(budget > 0)) {
    throw new Error(
      `no session budget: ${containerLimitBytes} bytes × ${1 - SESSION_MEMORY_RESERVE} − ` +
        `baseline ${baselineRssBytes} bytes = ${budget}`,
    );
  }
  const raw = Math.floor(budget / perSessionBytes);
  const cap = Math.floor(raw / 10) * 10;
  if (cap < 10) {
    throw new Error(
      `recommended cap ${cap} is below 10 (budget ${budget} bytes / ${perSessionBytes} bytes per session = ${raw})`,
    );
  }
  return cap;
}

const UNIT_MULTIPLIERS: Record<string, number> = {
  '': 1,
  k: 1024,
  m: 1024 * 1024,
  g: 1024 * 1024 * 1024,
};

/**
 * Returns the `spo-webclient` service's `deploy.resources.limits.memory` in bytes.
 * Docker reads `512M` as 512 × 1024², so the multipliers are binary.
 */
export function readComposeMemoryLimit(yamlText: string): number {
  const lines = yamlText.split(/\r?\n/);
  const start = lines.findIndex((l) => /^ {2}spo-webclient:\s*(#.*)?$/.test(l));
  if (start < 0) throw new Error('docker-compose: service "spo-webclient" not found');

  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^( {2})?[^\s#]/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const block = lines.slice(start + 1, end);

  const limitsAt = block.findIndex((l) => /^\s+limits:\s*(#.*)?$/.test(l));
  if (limitsAt < 0) throw new Error('docker-compose: "spo-webclient" has no "limits:" block');

  for (const line of block.slice(limitsAt + 1)) {
    const m = /^\s+memory:\s*["']?(\d+(?:\.\d+)?)\s*([a-zA-Z]*)["']?\s*(#.*)?$/.exec(line);
    if (!m) continue;
    const unit = m[2].toLowerCase().replace(/i?b$/, '').replace(/i$/, '');
    const mult = UNIT_MULTIPLIERS[unit];
    if (mult === undefined) throw new Error(`docker-compose: unknown memory unit "${m[2]}"`);
    return Math.round(Number(m[1]) * mult);
  }
  throw new Error('docker-compose: "spo-webclient" limits has no "memory:" line');
}

/** Returns the exposed `gc`, or throws — a figure is never taken without a forced GC. */
export function requireGc(g: { gc?: unknown }): () => void {
  const gc = g.gc;
  if (typeof gc !== 'function') {
    throw new Error(
      'session-memory.load.ts needs a forced GC: run it with `npm run load:sessions` (node --expose-gc, --runInBand)',
    );
  }
  return gc as () => void;
}
