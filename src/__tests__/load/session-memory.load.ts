/**
 * Session memory measurement — what one logged-in game session costs the gateway.
 *
 * Logs in N real `StarpeaceSession`s in-process against the L1 mock transport
 * (`createProtocolTestHarness`: `MockTcpSocket` replaces `net.Socket`, no socket is
 * opened, the live world is never touched), keeps them all alive, and compares
 * `heapUsed` / `rss` after a forced GC before the first login and after the last.
 * The result, with the recommended global session cap under the container's memory
 * limit (`docker-compose.yml`), is written to `session-capacity.json` next to this
 * file, which `session-capacity.test.ts` keeps honest.
 *
 * Run:  npm run load:sessions
 *   LOAD_SESSIONS=<n>            sessions to log in (default 100)
 *   LOAD_BASELINE_RSS_MIB=<MiB>  measured idle-gateway RSS (default: assumed 128 MiB)
 *
 * The name does not match `*.test.ts`, so `npm test` never runs it.
 *
 * The figure is conservative: each session's delta also carries the harness's own
 * mock objects (per-socket `RdoMock`, validator, captured command lists), which stay
 * alive with the session.
 *
 * Replacing the assumed baseline: once the gateway's `METRICS` log line is in
 * production (#1057), read `memory.rssBytes` from a line logged while
 * `sessions.total` is 0, rerun with `LOAD_BASELINE_RSS_MIB=<that value in MiB>`, and
 * commit the new JSON. The gateway's session-cap pinning test then fails until its
 * default constant follows the new `recommendedCap`. Same when the compose memory
 * limit changes.
 */

jest.mock('net', () => ({
  Socket: jest.fn(),
}));
jest.mock('node-fetch', () => ({
  __esModule: true,
  default: jest.fn(),
}));

import * as fs from 'fs';
import * as path from 'path';
import { describe, it } from '@jest/globals';
import {
  createProtocolTestHarness,
  buildWorldPropertyFallbacks,
  buildLoginPushTriggers,
  ProtocolTestHarness,
} from '../../server/__tests__/protocol-validation/protocol-test-harness';
import { createAuthScenario } from '../../mock-server/scenarios/auth-scenario';
import { createWorldListScenario } from '../../mock-server/scenarios/world-list-scenario';
import { createWorldLoginScenario } from '../../mock-server/scenarios/world-login-scenario';
import { createCompanyListScenario } from '../../mock-server/scenarios/company-list-scenario';
import { createSelectCompanyScenario } from '../../mock-server/scenarios/select-company-scenario';
import {
  recommendSessionCap,
  readComposeMemoryLimit,
  requireGc,
  SESSION_MEMORY_RESERVE,
  DEFAULT_BASELINE_RSS_MIB,
  SessionCapacityRecord,
} from './session-capacity';

const MIB = 1024 * 1024;
const VARS = { username: 'SPO_test3', password: 'test3' } as const;
const COMPANY_VARS = {
  ...VARS,
  worldName: 'Shamba',
  worldIp: '142.44.158.91',
  worldPort: 8000,
} as const;
const CONTEXT_ID = '8161308';

function newHarness(): ProtocolTestHarness {
  const selectCompany = createSelectCompanyScenario();
  const companyList = createCompanyListScenario(COMPANY_VARS);
  return createProtocolTestHarness({
    socketConfigs: [
      { rdoScenarios: [createAuthScenario(VARS).rdo], disableStrictValidation: true },
      { rdoScenarios: [createWorldListScenario(VARS).rdo], disableStrictValidation: true },
      {
        rdoScenarios: [createWorldLoginScenario(VARS).rdo, companyList.rdo, selectCompany.rdo],
        fallbackResponses: buildWorldPropertyFallbacks({
          worldName: 'Shamba',
          worldIp: COMPANY_VARS.worldIp,
          worldPort: '8000',
          mailAddr: COMPANY_VARS.worldIp,
          mailPort: '1234',
        }),
        pushTriggers: buildLoginPushTriggers(CONTEXT_ID),
        disableStrictValidation: true,
      },
    ],
    httpScenarios: [companyList.http, selectCompany.http],
  });
}

async function loginOne(h: ProtocolTestHarness): Promise<void> {
  const worlds = await h.session.connectDirectory('SPO_test3', 'test3', 'Root/Areas/Asia/Worlds');
  const shamba = worlds.find((w) => w.name === 'shamba');
  if (!shamba) throw new Error('world list fixture has no "shamba"');
  await h.session.loginWorld('SPO_test3', 'test3', shamba);
  await h.session.selectCompany('28');
}

function releaseAll(harnesses: ProtocolTestHarness[]): void {
  for (const h of harnesses) {
    h.session.destroy();
    h.cleanup();
  }
  harnesses.length = 0;
}

function parseSessions(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 100;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) throw new Error(`LOAD_SESSIONS must be an integer ≥ 1, got "${raw}"`);
  return n;
}

function parseBaseline(raw: string | undefined): {
  baselineRssBytes: number;
  baselineSource: SessionCapacityRecord['baselineSource'];
} {
  if (raw === undefined || raw === '') {
    return { baselineRssBytes: DEFAULT_BASELINE_RSS_MIB * MIB, baselineSource: 'assumed' };
  }
  const mib = Number(raw);
  if (!Number.isFinite(mib) || mib <= 0) {
    throw new Error(`LOAD_BASELINE_RSS_MIB must be a number > 0, got "${raw}"`);
  }
  return { baselineRssBytes: Math.round(mib * MIB), baselineSource: 'measured' };
}

describe('session memory measurement', () => {
  it('logs in N sessions and records the per-session cost', async () => {
    const gc = requireGc(globalThis as { gc?: unknown });
    const sessions = parseSessions(process.env.LOAD_SESSIONS);
    const { baselineRssBytes, baselineSource } = parseBaseline(process.env.LOAD_BASELINE_RSS_MIB);
    const repoRoot = path.join(__dirname, '..', '..', '..');
    const containerLimitBytes = readComposeMemoryLimit(
      fs.readFileSync(path.join(repoRoot, 'docker-compose.yml'), 'utf8'),
    );

    // Warm-up: the harness loads the server module graph on its first session;
    // without this, that one-time cost would be billed to the measured sessions.
    const warm = [newHarness()];
    try {
      await loginOne(warm[0]);
    } finally {
      releaseAll(warm);
    }
    jest.clearAllMocks();

    const harnesses: ProtocolTestHarness[] = [];
    let before: NodeJS.MemoryUsage;
    let after: NodeJS.MemoryUsage;
    try {
      gc();
      gc();
      before = process.memoryUsage();
      // One after another: each harness re-points the shared net.Socket mock.
      for (let i = 0; i < sessions; i++) {
        const h = newHarness();
        harnesses.push(h);
        await loginOne(h);
      }
      gc();
      gc();
      after = process.memoryUsage();
    } finally {
      releaseAll(harnesses);
    }

    const perSessionHeapBytes = Math.ceil((after.heapUsed - before.heapUsed) / sessions);
    const perSessionRssBytes = Math.ceil((after.rss - before.rss) / sessions);
    const perSessionBytes = Math.max(perSessionHeapBytes, perSessionRssBytes);

    const record: SessionCapacityRecord = {
      measuredAt: new Date().toISOString(),
      node: process.version,
      sessions,
      perSessionHeapBytes,
      perSessionRssBytes,
      perSessionBytes,
      baselineRssBytes,
      baselineSource,
      containerLimitBytes,
      reserve: SESSION_MEMORY_RESERVE,
      recommendedCap: recommendSessionCap({ containerLimitBytes, baselineRssBytes, perSessionBytes }),
    };

    fs.writeFileSync(path.join(__dirname, 'session-capacity.json'), JSON.stringify(record, null, 2) + '\n');
    console.table(record);
  });
});
