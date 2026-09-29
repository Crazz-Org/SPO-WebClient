/**
 * L2 live-drive configuration — accounts, targets, limits.
 *
 * Every value here is a policy constant, not a preference. The accounts are LOCKED
 * (doc/E2E-POLICY.md §9); changing one needs explicit developer approval.
 */

import * as os from 'os';
import * as path from 'path';
import { WORLD_ZONES } from '../shared/types/protocol-types';

export interface E2eAccount {
  /** Login name — LOCKED. */
  username: string;
  /** Password — LOCKED. */
  password: string;
  /** What this account is for, used in reports. */
  role: string;
}

/** Primary: mayor of Helartia, Minister of Agriculture. Drives governance flows. */
export const PRIMARY_ACCOUNT: E2eAccount = {
  username: 'SPO_test3',
  password: 'test3',
  role: 'mayor + minister',
};

/** Secondary: basic account, two buildings. Drives permission-negative and two-party flows. */
export const SECONDARY_ACCOUNT: E2eAccount = {
  username: 'Crazz',
  password: 'test',
  role: 'basic',
};

/** The town the primary account governs — the only town a probe may mutate. */
export const GOVERNED_TOWN = 'Helartia';

export const WORLD_NAME = 'planitia';

/** Free Space, not BETA — planitia lives under America (protocol-types.ts:85). */
export const ZONE_PATH =
  WORLD_ZONES.find(z => z.name === 'Free Space')?.path ?? 'Root/Areas/America/Worlds';

/** The local gateway the driver speaks to. It, not the driver, holds the RDO sockets. */
export const GATEWAY_URL = process.env.E2E_GATEWAY_URL || 'ws://localhost:8080';

/**
 * The gateway rejects a WebSocket with no Origin unless SINGLE_USER_MODE
 * (server.ts:1079). The driver is not a browser, so it sends one explicitly.
 */
export const GATEWAY_ORIGIN = process.env.E2E_GATEWAY_ORIGIN || 'http://localhost:8080';

export const HTTP_BASE = GATEWAY_URL.replace(/^ws/, 'http');

/** Open IIS listing of the Delphi server logs — read-only, no auth. */
export const LIVE_LOG_BASE =
  process.env.E2E_LOG_BASE || 'http://158.69.153.134/logs/FIVEMODELSERVER/';

/** The Interface Server's Survival logs, beside the model server's — where a ClientView's teardown is logged. */
export const INTERFACE_LOG_BASE = new URL('../FIVEINTERFACESERVER/', LIVE_LOG_BASE).href;

/**
 * President-only members. A diff touching one of these makes the gate read, from the
 * server, whether the test account holds the presidency (doc/E2E-POLICY.md §7): granted
 * means the change must be driven by a flow; refused is a recorded capability exception.
 *
 * Source: TPresidentialHall, Kernel/WorldPolitics.pas:261-266, indexed in
 * doc/civic-roles-reference.md:101-106.
 */
export const PRESIDENT_MEMBERS = [
  'RDOSetMinSalaryValue',
  'RDOSetTownTaxes',
  'RDOSitMayor',
  'RDOSitMinister',
  'RDOBanMinister',
  'RDOSetMinistryBudget',
] as const;

export const TIMEOUTS = {
  /** One request/response round trip through the gateway. */
  request: 30_000,
  /** WebSocket open. */
  connect: 15_000,
  /** World login is the slow one — directory + world + company. */
  login: 60_000,
  /** How long a write may take to appear in the model-server log. */
  logSettle: 20_000,
  /**
   * Gap between Inbox re-reads while waiting for `DeleteMessage` — a fire-and-forget RDO
   * procedure — to remove the message before the next `MessageList.asp` fetch (issue #1025).
   */
  mailDeleteReread: 1_000,
  /** How long session-resume keeps the WebSocket closed before resuming the parked session. */
  resumeGap: 20_000,
  /**
   * How long a round trip polls its read-back for the written value. The town-hall
   * facility's object-cache entry lives two minutes (`Kernel/Population.pas:1192`,
   * `CreateTTL(0, 0, 2, 0)`, OB-29), plus a 30 s margin. Never widen it past TTL + margin:
   * a read-back that outlasts it FAILs.
   */
  readBack: 150_000,
  /** Gap between read-back polls. */
  readBackPoll: 5_000,
  /**
   * Gap between context-status re-reads: `ContextStatusText` answers `''` while the
   * ClientView is `fServerBusy` (`Interface Server/InterfaceServer.pas:837-839`).
   */
  contextStatusReread: 3_000,
} as const;

export const LIMITS = {
  /** How long a gate attestation stays valid for a push. */
  gateMaxAgeMinutes: numberFromEnv('GATE_MAX_AGE_MINUTES', 60),
  /** Attempts before the loop gives up and reports (doc/E2E-POLICY.md §8). */
  maxAttempts: 3,
  /** Inbox re-reads mail-roundtrip takes after REQ_MAIL_DELETE before it gives up (issue #1025). */
  mailDeleteMaxReads: 5,
  /** Context-status reads world-readers takes before FAIL (`''` while `fServerBusy`, `Interface Server/InterfaceServer.pas:837-839`). */
  contextStatusMaxReads: 3,
} as const;

/** Where run artifacts live. Gitignored — evidence is per-machine, per-worktree. */
export const REPORT_DIR = 'report/e2e';

/**
 * Where the world lock, dirty flag and run history live. This must be ONE directory for
 * the whole machine, not one per worktree: the thing being locked is the live world and
 * the LOCKED accounts, which every worktree shares. A relative default here is exactly
 * the bug the bench worker fixed — two worktrees each holding "the" lock.
 */
export const WORLD_STATE_DIR =
  process.env.E2E_WORLD_STATE_DIR || path.join(os.homedir(), '.spo-bench', 'world');

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
