import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WsMessageType } from '@/shared/types/message-types';
import type { WsMessage, FavoritesItem, WsRespResumeSession } from '@/shared/types/message-types';
import type { MailMessageHeader } from '@/shared/types/domain-types';
import { FLOWS, flowByName, nudge, runFlow, type Flow, type FlowResult } from './flows';
import { ROUTES, NIGHTLY_ONLY, GATE_ONLY } from './routing';
import { CLUSTER_IDS } from '@/shared/cluster-data';
import { WorldLock } from './world-lock';
import { WsDriver, WsDriverError } from './ws-driver';
import * as session from './session';
import * as probeModule from './probe';
import * as liveLog from './live-log';
import { LIMITS, PRIMARY_ACCOUNT, SECONDARY_ACCOUNT, TIMEOUTS } from './config';

function stubSession(responder: (msg: WsMessage) => unknown): session.LiveSession {
  return {
    driver: {
      close: jest.fn(),
      log: [{ direction: 'sent' }, { direction: 'received' }],
      errors: [],
      send: jest.fn(),
      seen: jest.fn(() => []),
      request: jest.fn(async (msg: WsMessage) => responder(msg)),
    } as unknown as WsDriver,
    account: PRIMARY_ACCOUNT,
    company: { id: '1', name: 'SPO_test3 - Green' },
    worlds: 3,
    companies: [],
    playerX: 0,
    playerY: 0,
  };
}

const ctx = { lock: new WorldLock('report/e2e') };

/** A lock in a fresh temp dir — the shared report/e2e lock is not deterministic. */
function cleanLock(): WorldLock {
  return new WorldLock(fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-lock-')));
}

afterEach(() => jest.restoreAllMocks());

describe('the catalogue', () => {
  it('defines every flow name the routing table asks for', () => {
    const defined = new Set(FLOWS.map(f => f.name));
    for (const rule of ROUTES) {
      for (const flow of rule.flows) expect(defined).toContain(flow);
    }
  });

  it('exposes the login spine', () => {
    expect(flowByName('login-spine').mutates).toBe(false);
  });

  it('marks exactly the writing flows as mutating', () => {
    const mutating = FLOWS.filter(f => f.mutates).map(f => f.name).sort();
    expect(mutating).toEqual(
      ['favorites-folders', 'favorites-roundtrip', 'mail-roundtrip', 'politics-write', 'zoning-alert-read'],
    );
  });

  it('names the known flows when asked for one that does not exist', () => {
    expect(() => flowByName('nope')).toThrow(/Known: login-spine/);
  });
});

describe('runFlow', () => {
  it('turns an unexpected throw into a reportable FAIL rather than killing the run', async () => {
    const result = await runFlow(
      { name: 'boom', what: '', mutates: false, run: async () => Promise.reject(new Error('socket died')) },
      ctx,
    );
    expect(result).toMatchObject({ name: 'boom', status: 'FAIL', error: 'socket died' });
  });

  it('passes a successful flow through untouched', async () => {
    const passing = {
      name: 'ok',
      what: '',
      mutates: false,
      run: async () => ({
        name: 'ok',
        status: 'PASS' as const,
        assertions: [],
        unproven: [],
        probes: [],
        messagesSent: 1,
        messagesReceived: 1,
        wireErrors: 0,
      }),
    };
    expect((await runFlow(passing, ctx)).status).toBe('PASS');
  });

  describe('a seeded flow', () => {
    const pass = (name: string): FlowResult => ({
      name,
      status: 'PASS',
      assertions: [],
      unproven: [],
      probes: [],
      messagesSent: 1,
      messagesReceived: 1,
      wireErrors: 0,
    });

    function seeded(over: Partial<Flow> = {}): { flow: Flow; calls: string[] } {
      const calls: string[] = [];
      const flow: Flow = {
        name: 'seeded',
        what: '',
        mutates: true,
        seed: async () => {
          calls.push('seed');
          return {
            outcome: { what: 'plant', ok: true },
            cleanup: async () => {
              calls.push('cleanup');
              return [{ what: 'mailbox', ok: true }];
            },
          };
        },
        run: async () => {
          calls.push('run');
          return pass('seeded');
        },
        ...over,
      };
      return { flow, calls };
    }

    it('runs seed, then run, then the cleanup, and reports both', async () => {
      const { flow, calls } = seeded();
      const result = await runFlow(flow, ctx);
      expect(calls).toEqual(['seed', 'run', 'cleanup']);
      expect(result.status).toBe('PASS');
      expect(result.seed).toEqual({ what: 'plant', ok: true });
      expect(result.cleanup).toEqual([{ what: 'mailbox', ok: true }]);
    });

    it('still runs the cleanup when run throws', async () => {
      const { flow, calls } = seeded();
      flow.run = async () => {
        calls.push('run');
        throw new Error('socket died');
      };
      const result = await runFlow(flow, ctx);
      expect(calls).toEqual(['seed', 'run', 'cleanup']);
      expect(result).toMatchObject({ status: 'FAIL', error: 'socket died' });
    });

    it('a seed that throws is UNPROVEN, and run is never called', async () => {
      const { flow, calls } = seeded({ seed: async () => Promise.reject(new Error('no login')) });
      const result = await runFlow(flow, ctx);
      expect(calls).toEqual([]);
      expect(result.status).toBe('UNPROVEN');
      expect(result.seed).toEqual({ what: 'seed', ok: false, detail: 'no login' });
      expect(result.unproven[0]).toBe("the flow's data — seed failed: seed (no login)");
      expect(result.cleanup).toEqual([]);
    });

    it('a failed seed with no detail still names what failed, and still cleans up', async () => {
      const calls: string[] = [];
      const { flow } = seeded({
        seed: async () => ({
          outcome: { what: 'plant', ok: false },
          cleanup: async () => {
            calls.push('cleanup');
            return [{ what: 'mailbox', ok: true }];
          },
        }),
      });
      const result = await runFlow(flow, ctx);
      expect(calls).toEqual(['cleanup']);
      expect(result.status).toBe('UNPROVEN');
      expect(result.unproven).toEqual(["the flow's data — seed failed: plant"]);
    });

    it('a cleanup that throws turns a PASS into a FAIL', async () => {
      const { flow } = seeded({
        seed: async () => ({
          outcome: { what: 'plant', ok: true },
          cleanup: async () => Promise.reject(new Error('mailbox gone')),
        }),
      });
      const result = await runFlow(flow, ctx);
      expect(result.status).toBe('FAIL');
      expect(result.cleanup).toEqual([{ what: 'seed cleanup', ok: false, detail: 'mailbox gone' }]);
    });

    it('a cleanup that leaves data behind turns a PASS into a FAIL', async () => {
      const { flow } = seeded({
        seed: async () => ({
          outcome: { what: 'plant', ok: true },
          cleanup: async () => [{ what: 'inbox', ok: true }, { what: 'sent', ok: false, detail: '0/1 deleted' }],
        }),
      });
      expect((await runFlow(flow, ctx)).status).toBe('FAIL');
    });

    it('a seed skipped by a login refusal ends SKIPPED, and run is never called', async () => {
      const { flow, calls } = seeded({
        seed: async () => ({
          outcome: { what: 'plant', ok: false, skipped: 'Crazz refused' },
          cleanup: async () => [{ what: 'mailbox', ok: true }],
        }),
      });
      const result = await runFlow(flow, { lock: cleanLock() });
      expect(calls).toEqual([]);
      expect(result).toMatchObject({ status: 'SKIPPED', skipped: 'Crazz refused', unproven: [] });
    });

    it('a flow without a seed carries no seed or cleanup keys', async () => {
      const { flow } = seeded({ seed: undefined });
      const result = await runFlow(flow, ctx);
      expect(result).not.toHaveProperty('seed');
      expect(result).not.toHaveProperty('cleanup');
    });
  });
});

describe('runFlow and a SKIPPED flow', () => {
  const skipping: Flow = {
    name: 'needs-crazz',
    what: '',
    mutates: true,
    run: async () => ({
      name: 'needs-crazz',
      status: 'SKIPPED',
      skipped: 'Crazz refused',
      assertions: [],
      unproven: [],
      probes: [],
      messagesSent: 0,
      messagesReceived: 0,
      wireErrors: 0,
    }),
  };

  it('passes a skip through as SKIPPED when the lock holds no pending restore', async () => {
    const result = await runFlow(skipping, { lock: cleanLock() });
    expect(result).toMatchObject({ status: 'SKIPPED', skipped: 'Crazz refused' });
  });

  it('turns a skip into a FAIL while the lock holds a pending restore', async () => {
    const lock = cleanLock();
    lock.addPendingRestore({ what: 'tax', x: 1, y: 2, propertyName: 'Tax0', originalValue: '5' });
    const result = await runFlow(skipping, { lock });
    expect(result.status).toBe('FAIL');
    expect(result.error).toMatch(/skipped after a write \(Crazz refused\) — 1 pending restore/);
  });

  it('turns a seeded flow\'s skip into a FAIL while the lock holds a pending restore', async () => {
    const lock = cleanLock();
    lock.addPendingRestore({ what: 'tax', x: 1, y: 2, propertyName: 'Tax0', originalValue: '5' });
    const result = await runFlow(
      { ...skipping, seed: async () => ({ outcome: { what: 'plant', ok: false, skipped: 'Crazz refused' } }) },
      { lock },
    );
    expect(result.status).toBe('FAIL');
  });
});

describe('login-spine', () => {
  it('passes on a clean spine and logs off afterwards', async () => {
    const stub = stubSession(() => undefined);
    jest.spyOn(session, 'login').mockResolvedValue(stub);
    jest.spyOn(session, 'logoff').mockResolvedValue(undefined);

    const result = await flowByName('login-spine').run(ctx);

    expect(result.status).toBe('PASS');
    expect(session.logoff).toHaveBeenCalled();
  });

  it('fails when the selected company is a civic role company', async () => {
    const stub = stubSession(() => undefined);
    stub.company = { id: '2', name: 'Mayor of Helartia', ownerRole: 'Mayor' };
    jest.spyOn(session, 'login').mockResolvedValue(stub);
    jest.spyOn(session, 'logoff').mockResolvedValue(undefined);

    const result = await flowByName('login-spine').run(ctx);

    expect(result.status).toBe('FAIL');
    expect(result.assertions.find(a => !a.ok)?.what).toMatch(/civic role/);
  });

  it('logs off even when an assertion fails', async () => {
    const stub = stubSession(() => undefined);
    stub.worlds = 0;
    jest.spyOn(session, 'login').mockResolvedValue(stub);
    const off = jest.spyOn(session, 'logoff').mockResolvedValue(undefined);

    await flowByName('login-spine').run(ctx);
    expect(off).toHaveBeenCalled();
  });
});

describe('permission-negative', () => {
  const town = {
    name: 'Helartia',
    iconUrl: '',
    mayor: 'SPO_test3',
    population: 0,
    unemploymentPercent: 0,
    qualityOfLife: 0,
    x: 1,
    y: 2,
    path: '',
    classId: '512',
  };

  function arrange(canGovern: boolean) {
    jest.spyOn(session, 'login').mockResolvedValue(stubSession(() => undefined));
    jest.spyOn(session, 'loginSecondary').mockImplementation(async () => session.login(SECONDARY_ACCOUNT));
    jest.spyOn(session, 'logoff').mockResolvedValue(undefined);
    jest.spyOn(session, 'findTown').mockResolvedValue(town);
  jest.spyOn(session, 'resolveVisualClass').mockResolvedValue('7010');
    jest.spyOn(session, 'readBuildingDetails').mockResolvedValue({
      canGovern,
      visualClass: '512',
      tabs: [],
      groups: {},
    } as unknown as Awaited<ReturnType<typeof session.readBuildingDetails>>);
  }

  it('passes when the basic account is refused governance', async () => {
    arrange(false);
    expect((await flowByName('permission-negative').run(ctx)).status).toBe('PASS');
  });

  it('fails when a non-mayor is handed the mayor controls', async () => {
    arrange(true);
    const result = await flowByName('permission-negative').run(ctx);
    expect(result.status).toBe('FAIL');
    expect(result.assertions.find(a => !a.ok)?.detail).toBe('canGovern=true');
  });

  it('ends SKIPPED, not FAIL, when the second account is refused at login', async () => {
    arrange(false);
    jest.spyOn(session, 'loginSecondary').mockResolvedValue({ skipped: 'Crazz refused' });
    const result = await runFlow(flowByName('permission-negative'), { lock: cleanLock() });
    expect(result).toMatchObject({ status: 'SKIPPED', skipped: 'Crazz refused' });
    expect(session.findTown).not.toHaveBeenCalled();
    expect(session.logoff).not.toHaveBeenCalled();
  });
});

describe('building-details', () => {
  const TOWN = {
    name: 'Helartia',
    iconUrl: '',
    mayor: 'SPO_test3',
    population: 0,
    unemploymentPercent: 0,
    qualityOfLife: 0,
    x: 1,
    y: 2,
    path: '',
    classId: '512',
  };

  /**
   * The flow is two round-trips now: the opening read, then the section read.
   * Both are stubbed so a test can move one and hold the other still.
   */
  function arrange(
    details: { tabs: unknown[]; groups: Record<string, unknown> },
    section: { groups?: Record<string, unknown> } = { groups: { townTaxes: [{ name: 'Tax0', value: '7' }] } },
  ) {
    jest.spyOn(session, 'login').mockResolvedValue(stubSession(() => undefined));
    jest.spyOn(session, 'logoff').mockResolvedValue(undefined);
    jest.spyOn(session, 'resolveVisualClass').mockResolvedValue('7010');
    jest.spyOn(session, 'findTown').mockResolvedValue(TOWN);
    jest.spyOn(session, 'readBuildingDetails').mockResolvedValue(
      details as unknown as Awaited<ReturnType<typeof session.readBuildingDetails>>,
    );
    jest.spyOn(session, 'readBuildingTabData').mockResolvedValue(
      section as unknown as Awaited<ReturnType<typeof session.readBuildingTabData>>,
    );
  }

  const TOWN_HALL_TABS = [{ id: 'townGeneral' }, { id: 'townTaxes' }];

  it('passes when the header group opens and the section arrives on demand', async () => {
    arrange({ tabs: TOWN_HALL_TABS, groups: { townGeneral: [{ name: 'Town', value: 'Helartia' }] } });
    expect((await flowByName('building-details').run(ctx)).status).toBe('PASS');
  });

  it('fails when the inspector serves no tabs', async () => {
    arrange({ tabs: [], groups: {} });
    expect((await flowByName('building-details').run(ctx)).status).toBe('FAIL');
  });

  /** The load-time contract: a section nobody opened must cost nothing. */
  it('fails when the opening read carries a section nobody opened', async () => {
    arrange({
      tabs: TOWN_HALL_TABS,
      groups: { townGeneral: [], townTaxes: [{ name: 'Tax0', value: '7' }] },
    });
    const result = await flowByName('building-details').run(ctx);
    expect(result.status).toBe('FAIL');
    expect(result.assertions.find(a => !a.ok)?.what).toMatch(/nobody opened/);
  });

  it('fails when opening the section brings its group back empty', async () => {
    arrange({ tabs: TOWN_HALL_TABS, groups: { townGeneral: [] } }, { groups: { townTaxes: [] } });
    const result = await flowByName('building-details').run(ctx);
    expect(result.status).toBe('FAIL');
    expect(result.assertions.find(a => !a.ok)?.what).toMatch(/property values/);
  });

  it('fails when the section read answers with no groups at all', async () => {
    arrange({ tabs: TOWN_HALL_TABS, groups: { townGeneral: [] } }, {});
    const result = await flowByName('building-details').run(ctx);
    expect(result.status).toBe('FAIL');
    expect(result.assertions.find(a => !a.ok)?.what).toMatch(/reads its group/);
  });
});

describe('people-search', () => {
  it('passes when the known alias is found', async () => {
    jest.spyOn(session, 'login').mockResolvedValue(
      stubSession(msg =>
        msg.type === WsMessageType.REQ_SEARCH_MENU_PEOPLE_SEARCH
          ? { type: WsMessageType.RESP_SEARCH_MENU_PEOPLE_SEARCH, results: [SECONDARY_ACCOUNT.username] }
          : undefined,
      ),
    );
    jest.spyOn(session, 'logoff').mockResolvedValue(undefined);

    const result = await flowByName('people-search').run(ctx);

    expect(result.status).toBe('PASS');
    expect(session.logoff).toHaveBeenCalled();
  });

  it('fails when the search does not find the known alias', async () => {
    jest.spyOn(session, 'login').mockResolvedValue(
      stubSession(msg =>
        msg.type === WsMessageType.REQ_SEARCH_MENU_PEOPLE_SEARCH
          ? { type: WsMessageType.RESP_SEARCH_MENU_PEOPLE_SEARCH, results: [] }
          : undefined,
      ),
    );
    jest.spyOn(session, 'logoff').mockResolvedValue(undefined);

    const result = await flowByName('people-search').run(ctx);

    expect(result.status).toBe('FAIL');
    expect(result.assertions.find(a => !a.ok)?.what).toMatch(/finds it/);
  });

  it('searches for the secondary account, not the one logged in', async () => {
    const sent: WsMessage[] = [];
    jest.spyOn(session, 'login').mockResolvedValue(
      stubSession(msg => {
        sent.push(msg);
        return msg.type === WsMessageType.REQ_SEARCH_MENU_PEOPLE_SEARCH
          ? { type: WsMessageType.RESP_SEARCH_MENU_PEOPLE_SEARCH, results: [SECONDARY_ACCOUNT.username] }
          : undefined;
      }),
    );
    jest.spyOn(session, 'logoff').mockResolvedValue(undefined);

    await flowByName('people-search').run(ctx);

    const req = sent.find(m => m.type === WsMessageType.REQ_SEARCH_MENU_PEOPLE_SEARCH);
    expect(req).toMatchObject({ searchStr: SECONDARY_ACCOUNT.username });
  });
});

describe('nudge', () => {
  it('moves a low rate up and stays in range', () => {
    expect(nudge('7')).toBe('8');
  });

  it('moves a high rate down rather than past 100', () => {
    expect(nudge('100')).toBe('99');
  });

  it('never produces a negative rate', () => {
    expect(Number(nudge('0'))).toBeGreaterThanOrEqual(0);
  });

  it('falls back to a safe value when the original is not a number', () => {
    expect(nudge('')).toBe('1');
    expect(nudge('n/a')).toBe('1');
  });

  it('always changes the value, so the write is observable', () => {
    for (const original of ['0', '1', '49', '50', '51', '99', '100']) {
      expect(nudge(original)).not.toBe(original);
    }
  });
});

describe('the politics-read flow', () => {
  it('fails when the gateway returns no politics payload', async () => {
    jest.spyOn(session, 'login').mockResolvedValue(
      stubSession(msg =>
        msg.type === WsMessageType.REQ_POLITICS_DATA
          ? { type: WsMessageType.RESP_POLITICS_DATA, data: null }
          : undefined,
      ),
    );
    jest.spyOn(session, 'logoff').mockResolvedValue(undefined);
    jest.spyOn(session, 'resolveVisualClass').mockResolvedValue('7010');
    jest.spyOn(session, 'findTown').mockResolvedValue({
      name: 'Helartia',
      iconUrl: '',
      mayor: 'SPO_test3',
      population: 0,
      unemploymentPercent: 0,
      qualityOfLife: 0,
      x: 1,
      y: 2,
      path: '',
      classId: '512',
    });

    const result = await flowByName('politics-read').run(ctx);
    expect(result.status).toBe('FAIL');
  });
});

const helartia = {
  name: 'Helartia',
  iconUrl: '',
  mayor: 'SPO_test3',
  population: 0,
  unemploymentPercent: 0,
  qualityOfLife: 0,
  x: 100,
  y: 200,
  path: '',
  classId: '512',
};

/**
 * The opening read answers `canGovern` and the header group; the tax table is a
 * section, and `readSectionGroups` is the request that brings it. Stubbing them
 * apart is the point — a tax value that came back on the opening response would
 * no longer be reachable in production.
 */
function governedTownHall(canGovern: boolean, taxValue?: string) {
  jest.spyOn(session, 'login').mockResolvedValue(stubSession(() => undefined));
  jest.spyOn(session, 'logoff').mockResolvedValue(undefined);
  jest.spyOn(session, 'findTown').mockResolvedValue(helartia);
  jest.spyOn(session, 'resolveVisualClass').mockResolvedValue('7010');
  jest.spyOn(session, 'readBuildingDetails').mockResolvedValue({
    canGovern,
    visualClass: '512',
    tabs: [{ id: 'townTaxes' }],
    groups: { townGeneral: [] },
  } as unknown as Awaited<ReturnType<typeof session.readBuildingDetails>>);
  jest.spyOn(session, 'readSectionGroups').mockResolvedValue(
    taxValue === undefined ? {} : { townTaxes: [{ name: 'Tax0Percent', value: taxValue }] },
  );
}

describe('politics-write', () => {
  const passingProbe = {
    what: 'Helartia tax row 0 rate',
    member: 'RDOSetTaxValue',
    status: 'PASS' as const,
    original: '7',
    written: '8',
    logLine: 'Setting Tax value: 8',
    readBack: 'CONFIRMED' as const,
    restored: true,
  };

  it('probes the tax row of the town this account governs', async () => {
    governedTownHall(true, '7');
    jest.spyOn(liveLog, 'findCurrentSurvivalLog').mockResolvedValue('http://logs/S.log');
    const runProbe = jest.spyOn(probeModule, 'runProbe').mockResolvedValue(passingProbe);

    const result = await flowByName('politics-write').run(ctx);

    expect(result.status).toBe('PASS');
    expect(result.probes).toHaveLength(1);
    const spec = runProbe.mock.calls[0][1];
    expect(spec).toMatchObject({
      x: 100,
      y: 200,
      visualClass: '7010',
      writeProperty: 'RDOSetTaxValue',
      additionalParams: { index: '0' },
    });
    expect(spec.testValue('7')).toBe('8');
  });

  it('refuses to write when the account cannot govern the town hall', async () => {
    governedTownHall(false, '7');
    const runProbe = jest.spyOn(probeModule, 'runProbe');

    const result = await flowByName('politics-write').run(ctx);

    expect(result.status).toBe('FAIL');
    expect(runProbe).not.toHaveBeenCalled();
  });

  it('refuses to write when no tax row can be read', async () => {
    governedTownHall(true, undefined);
    const runProbe = jest.spyOn(probeModule, 'runProbe');

    const result = await flowByName('politics-write').run(ctx);

    expect(result.status).toBe('FAIL');
    expect(runProbe).not.toHaveBeenCalled();
  });

  it('records a probe that threw instead of losing the run', async () => {
    governedTownHall(true, '7');
    jest.spyOn(liveLog, 'findCurrentSurvivalLog').mockResolvedValue('http://logs/S.log');
    jest.spyOn(probeModule, 'runProbe').mockRejectedValue(new Error('socket died'));

    const result = await flowByName('politics-write').run(ctx);

    expect(result.status).toBe('FAIL');
    expect(result.probes[0].note).toBe('socket died');
  });

  it('uses the log url the run resolved rather than looking it up again', async () => {
    governedTownHall(true, '7');
    const find = jest.spyOn(liveLog, 'findCurrentSurvivalLog');
    const runProbe = jest.spyOn(probeModule, 'runProbe').mockResolvedValue(passingProbe);

    await flowByName('politics-write').run({ ...ctx, survivalLogUrl: 'http://given/S.log' });

    expect(find).not.toHaveBeenCalled();
    expect(runProbe.mock.calls[0][4]).toBe('http://given/S.log');
  });
});

describe('mail-roundtrip', () => {
  // A real gap between re-reads would make this suite slow for no reason (issue #1025) —
  // every test in this block injects a no-op sleep so a bounded retry loop resolves at
  // in-memory speed.
  const mailCtx = { ...ctx, sleep: async () => {} };

  // Crazz logs in first (before the compose), through the same stub `login` as SPO_test3.
  beforeEach(() => {
    jest.spyOn(session, 'loginSecondary').mockImplementation(async () => session.login(SECONDARY_ACCOUNT));
  });

  function mailSession(
    inboxSubjects: string[] | (() => string[]),
    record?: (msg: WsMessage) => void,
    opts: {
      unreadCount?: number;
      afterUnreadCount?: number;
      ignoreDelete?: boolean;
      /** Inbox re-reads after REQ_MAIL_DELETE before the message actually disappears. */
      deleteLandsOnRead?: number;
    } = {},
  ) {
    const { unreadCount = 1, afterUnreadCount = 0, ignoreDelete = false, deleteLandsOnRead = 1 } = opts;
    const deleted = new Set<string>();
    let pendingDeleteId: string | undefined;
    let readsSinceDelete = 0;
    return stubSession(msg => {
      record?.(msg);
      switch (msg.type) {
        case WsMessageType.REQ_MAIL_DELETE:
          if (!ignoreDelete) pendingDeleteId = (msg as unknown as { messageId: string }).messageId;
          return { type: WsMessageType.RESP_MAIL_DELETED, success: true };
        case WsMessageType.RESP_MAIL_CONNECTED:
        case WsMessageType.REQ_MAIL_CONNECT:
          return { type: WsMessageType.RESP_MAIL_CONNECTED, unreadCount };
        case WsMessageType.REQ_MAIL_COMPOSE:
          return { type: WsMessageType.RESP_MAIL_SENT };
        case WsMessageType.REQ_MAIL_GET_FOLDER:
          if (pendingDeleteId && !deleted.has(pendingDeleteId)) {
            readsSinceDelete += 1;
            if (readsSinceDelete >= deleteLandsOnRead) deleted.add(pendingDeleteId);
          }
          return {
            type: WsMessageType.RESP_MAIL_FOLDER,
            folder: 'Inbox',
            messages: (typeof inboxSubjects === 'function' ? inboxSubjects() : inboxSubjects)
              .map((subject, i) => ({ messageId: String(i), subject }))
              .filter(m => !deleted.has(m.messageId)),
          };
        case WsMessageType.REQ_MAIL_READ_MESSAGE:
          return { type: WsMessageType.RESP_MAIL_MESSAGE, message: {} };
        case WsMessageType.REQ_MAIL_GET_UNREAD_COUNT:
          return { type: WsMessageType.RESP_MAIL_UNREAD_COUNT, count: afterUnreadCount };
        default:
          return { type: WsMessageType.RESP_MAIL_DELETED };
      }
    });
  }

  it('fails when the message never arrives in the recipient inbox', async () => {
    jest.spyOn(session, 'login').mockResolvedValue(mailSession([]));
    jest.spyOn(session, 'logoff').mockResolvedValue(undefined);

    const result = await flowByName('mail-roundtrip').run(mailCtx);

    expect(result.status).toBe('FAIL');
    expect(result.assertions.find(a => !a.ok)?.what).toMatch(/arrived in the recipient inbox/);
  });

  it('deletes the probe message once it has been seen', async () => {
    const sent: WsMessage[] = [];
    let subject = '';
    jest.spyOn(session, 'login').mockImplementation(async () =>
      mailSession(() => (subject ? [subject] : []), msg => {
        sent.push(msg);
        if (msg.type === WsMessageType.REQ_MAIL_COMPOSE) {
          subject = (msg as unknown as { subject: string }).subject;
        }
      }),
    );
    jest.spyOn(session, 'logoff').mockResolvedValue(undefined);

    const result = await flowByName('mail-roundtrip').run(mailCtx);

    expect(result.status).toBe('PASS');
    expect(sent.some(m => m.type === WsMessageType.REQ_MAIL_DELETE)).toBe(true);
  });

  it('PASSes with a single re-read when the delete has already landed', async () => {
    let subject = '';
    jest.spyOn(session, 'login').mockImplementation(async () =>
      mailSession(
        () => (subject ? [subject] : []),
        msg => {
          if (msg.type === WsMessageType.REQ_MAIL_COMPOSE) {
            subject = (msg as unknown as { subject: string }).subject;
          }
        },
        { deleteLandsOnRead: 1 },
      ),
    );
    jest.spyOn(session, 'logoff').mockResolvedValue(undefined);

    const result = await flowByName('mail-roundtrip').run(mailCtx);

    expect(result.status).toBe('PASS');
    const checked = result.assertions.find(a => a.what === 'the probe message was deleted again');
    expect(checked?.detail).toMatch(/reads=1$/);
  });

  it('PASSes once the delete lands by the third re-read', async () => {
    let subject = '';
    jest.spyOn(session, 'login').mockImplementation(async () =>
      mailSession(
        () => (subject ? [subject] : []),
        msg => {
          if (msg.type === WsMessageType.REQ_MAIL_COMPOSE) {
            subject = (msg as unknown as { subject: string }).subject;
          }
        },
        { deleteLandsOnRead: 3 },
      ),
    );
    jest.spyOn(session, 'logoff').mockResolvedValue(undefined);

    const result = await flowByName('mail-roundtrip').run(mailCtx);

    expect(result.status).toBe('PASS');
    const checked = result.assertions.find(a => a.what === 'the probe message was deleted again');
    expect(checked?.detail).toMatch(/reads=3$/);
  });

  it('FAILs and names the read count when the message is still listed after the bound', async () => {
    let subject = '';
    jest.spyOn(session, 'login').mockImplementation(async () =>
      mailSession(
        () => (subject ? [subject] : []),
        msg => {
          if (msg.type === WsMessageType.REQ_MAIL_COMPOSE) {
            subject = (msg as unknown as { subject: string }).subject;
          }
        },
        { ignoreDelete: true },
      ),
    );
    jest.spyOn(session, 'logoff').mockResolvedValue(undefined);

    const result = await flowByName('mail-roundtrip').run(mailCtx);

    expect(result.status).toBe('FAIL');
    const failed = result.assertions.find(a => !a.ok);
    expect(failed?.what).toMatch(/deleted again/);
    expect(failed?.detail).toMatch(/reads=5$/);
  });

  it('waits on a real timer between re-reads when the flow injects no sleep', async () => {
    jest.useFakeTimers();
    try {
      let subject = '';
      jest.spyOn(session, 'login').mockImplementation(async () =>
        mailSession(
          () => (subject ? [subject] : []),
          msg => {
            if (msg.type === WsMessageType.REQ_MAIL_COMPOSE) {
              subject = (msg as unknown as { subject: string }).subject;
            }
          },
          { deleteLandsOnRead: 2 },
        ),
      );
      jest.spyOn(session, 'logoff').mockResolvedValue(undefined);

      const resultPromise = flowByName('mail-roundtrip').run(ctx);
      await jest.advanceTimersByTimeAsync(TIMEOUTS.mailDeleteReread);
      const result = await resultPromise;

      expect(result.status).toBe('PASS');
      const checked = result.assertions.find(a => a.what === 'the probe message was deleted again');
      expect(checked?.detail).toMatch(/reads=2$/);
    } finally {
      jest.useRealTimers();
    }
  });

  it('FAILs when the unread count does not drop after the read', async () => {
    const sent: WsMessage[] = [];
    let subject = '';
    jest.spyOn(session, 'login').mockImplementation(async () =>
      mailSession(
        () => (subject ? [subject] : []),
        msg => {
          sent.push(msg);
          if (msg.type === WsMessageType.REQ_MAIL_COMPOSE) {
            subject = (msg as unknown as { subject: string }).subject;
          }
        },
        { unreadCount: 1, afterUnreadCount: 1 },
      ),
    );
    jest.spyOn(session, 'logoff').mockResolvedValue(undefined);

    const result = await flowByName('mail-roundtrip').run(mailCtx);

    expect(result.status).toBe('FAIL');
    const failed = result.assertions.find(a => !a.ok);
    expect(failed?.what).toMatch(/lowered CheckNewMail by one/);
    expect(failed?.detail).toMatch(/messageId=\d+ before=1 after=1/);
  });

  it('ends SKIPPED with no compose sent when the second account is refused at login', async () => {
    const sent: WsMessage[] = [];
    const primary = jest.spyOn(session, 'login').mockResolvedValue(mailSession([], msg => sent.push(msg)));
    jest.spyOn(session, 'loginSecondary').mockResolvedValue({ skipped: 'Crazz refused' });
    jest.spyOn(session, 'logoff').mockResolvedValue(undefined);

    const result = await flowByName('mail-roundtrip').run(mailCtx);

    expect(result).toMatchObject({ status: 'SKIPPED', skipped: 'Crazz refused' });
    expect(sent.some(m => m.type === WsMessageType.REQ_MAIL_COMPOSE)).toBe(false);
    expect(primary).not.toHaveBeenCalled();
  });

  it('logs Crazz in before the compose', async () => {
    const order: string[] = [];
    jest.spyOn(session, 'login').mockImplementation(async account => {
      order.push(`login ${account.username}`);
      return mailSession([], msg => {
        if (msg.type === WsMessageType.REQ_MAIL_COMPOSE) order.push('compose');
      });
    });
    jest.spyOn(session, 'logoff').mockResolvedValue(undefined);

    await flowByName('mail-roundtrip').run(mailCtx);

    expect(order.slice(0, 3)).toEqual(['login Crazz', 'login SPO_test3', 'compose']);
  });

  it('addresses the probe message to the second account', async () => {
    const sent: WsMessage[] = [];
    jest.spyOn(session, 'login').mockResolvedValue(mailSession([], msg => sent.push(msg)));
    jest.spyOn(session, 'logoff').mockResolvedValue(undefined);

    await flowByName('mail-roundtrip').run(mailCtx);

    const compose = sent.find(m => m.type === WsMessageType.REQ_MAIL_COMPOSE);
    expect(compose).toMatchObject({ to: 'Crazz' });
  });
});

describe('favorites-roundtrip', () => {
  interface FavRow { id: number; name: string; x: number; y: number; path: string }

  /**
   * A stub tree that behaves like `TFavorites`: the add assigns the next id
   * and the listing serves what the writes actually did. That is what makes
   * these tests worth having — a flow that asserted against its own request
   * instead of against the tree would pass while the tree stayed empty.
   */
  function favSession(
    seed: FavRow[] = [],
    opts: { refuseAdd?: boolean; renameLies?: boolean } = {},
  ) {
    const tree: FavRow[] = [...seed];
    let nextId = 100;
    const sent: WsMessage[] = [];
    const s = stubSession(msg => {
      sent.push(msg);
      const m = msg as unknown as { name?: string; x?: number; y?: number; path?: string };
      switch (msg.type) {
        case WsMessageType.REQ_EMPIRE_FACILITIES:
          return { type: WsMessageType.RESP_EMPIRE_FACILITIES, facilities: [...tree] };
        case WsMessageType.REQ_FAVORITE_ADD: {
          if (opts.refuseAdd) return { type: WsMessageType.RESP_FAVORITE_ADD, success: false };
          const id = nextId++;
          tree.push({ id, name: m.name!, x: m.x!, y: m.y!, path: String(id) });
          return { type: WsMessageType.RESP_FAVORITE_ADD, success: true, id };
        }
        case WsMessageType.REQ_FAVORITE_RENAME: {
          // `renameLies` is the case only a read-back can catch: the write is
          // acknowledged and nothing changes.
          if (opts.renameLies) return { type: WsMessageType.RESP_FAVORITE_RENAME, success: true };
          const row = tree.find(f => f.path === m.path);
          if (row) row.name = m.name!;
          return { type: WsMessageType.RESP_FAVORITE_RENAME, success: true };
        }
        default: {
          const i = tree.findIndex(f => f.path === m.path);
          if (i >= 0) tree.splice(i, 1);
          return { type: WsMessageType.RESP_FAVORITE_DELETE, success: true };
        }
      }
    });
    return { session: s, tree, sent };
  }

  function install(fav: ReturnType<typeof favSession>): void {
    jest.spyOn(session, 'login').mockResolvedValue(fav.session);
    jest.spyOn(session, 'logoff').mockResolvedValue(undefined);
  }

  it('adds, renames and deletes, leaving the tree exactly as it found it', async () => {
    const fav = favSession();
    install(fav);

    const result = await flowByName('favorites-roundtrip').run(ctx);

    expect(result.status).toBe('PASS');
    expect(fav.tree).toEqual([]);
  });

  it('sweeps a marker left by an earlier run that died mid-flow', async () => {
    const fav = favSession([{ id: 9, name: 'e2e-favorite 2026-01-01', x: 1, y: 2, path: '9' }]);
    install(fav);

    const result = await flowByName('favorites-roundtrip').run(ctx);

    expect(result.status).toBe('PASS');
    expect(fav.tree).toEqual([]);
    expect(fav.sent.filter(m => m.type === WsMessageType.REQ_FAVORITE_DELETE)).toHaveLength(2);
  });

  it('leaves a favourite that is not its own alone', async () => {
    const mine: FavRow = { id: 3, name: 'Farm 1', x: 641, y: 66, path: '3' };
    const fav = favSession([mine]);
    install(fav);

    await flowByName('favorites-roundtrip').run(ctx);

    expect(fav.tree).toEqual([mine]);
  });

  it('fails when the add is refused — a refusal is never read as a success', async () => {
    const fav = favSession([], { refuseAdd: true });
    install(fav);

    const result = await flowByName('favorites-roundtrip').run(ctx);

    expect(result.status).toBe('FAIL');
    expect(result.assertions.find(a => !a.ok)?.what).toMatch(/add was accepted/);
  });

  it('fails when the rename is acknowledged but the tree still serves the old name', async () => {
    const fav = favSession([], { renameLies: true });
    install(fav);

    const result = await flowByName('favorites-roundtrip').run(ctx);

    expect(result.status).toBe('FAIL');
    expect(result.assertions.find(a => !a.ok)?.what).toMatch(/serves the new name/);
  });
});

describe('favorites-folders', () => {
  interface Row { id: number; name: string; x: number; y: number; path: string; isFolder: boolean }

  /**
   * A tree-aware stub: a flat table of rows, each carrying its own Location,
   * with `REQ_EMPIRE_FACILITIES` rebuilding the nested tree from it on every
   * read — so the same dishonesty class as `favSession`'s `renameLies` is
   * expressible here as `moveLies`.
   */
  function favFolderSession(
    seed: Row[] = [],
    opts: { refuseCreate?: boolean; moveLies?: boolean } = {},
  ) {
    const table: Row[] = [...seed];
    let nextId = 100;
    const sent: WsMessage[] = [];

    const childrenOf = (path: string): FavoritesItem[] =>
      table
        .filter(r => {
          const idx = r.path.lastIndexOf('/');
          const parent = idx < 0 ? '' : r.path.slice(0, idx);
          return parent === path;
        })
        .map(r => (r.isFolder
          ? { id: r.id, name: r.name, x: 0, y: 0, path: r.path, isFolder: true, children: childrenOf(r.path) }
          : { id: r.id, name: r.name, x: r.x, y: r.y, path: r.path }));

    const s = stubSession(msg => {
      sent.push(msg);
      const m = msg as unknown as { name?: string; x?: number; y?: number; path?: string; destPath?: string; parentPath?: string };
      switch (msg.type) {
        case WsMessageType.REQ_EMPIRE_FACILITIES:
          return { type: WsMessageType.RESP_EMPIRE_FACILITIES, facilities: childrenOf('') };
        case WsMessageType.REQ_FAVORITE_FOLDER_CREATE: {
          if (opts.refuseCreate) return { type: WsMessageType.RESP_FAVORITE_FOLDER_CREATE, success: false };
          const id = nextId++;
          const path = m.parentPath ? `${m.parentPath}/${id}` : String(id);
          table.push({ id, name: m.name!, x: 0, y: 0, path, isFolder: true });
          return { type: WsMessageType.RESP_FAVORITE_FOLDER_CREATE, success: true, id };
        }
        case WsMessageType.REQ_FAVORITE_ADD: {
          const id = nextId++;
          table.push({ id, name: m.name!, x: m.x!, y: m.y!, path: String(id), isFolder: false });
          return { type: WsMessageType.RESP_FAVORITE_ADD, success: true, id };
        }
        case WsMessageType.REQ_FAVORITE_MOVE: {
          if (!opts.moveLies) {
            const row = table.find(r => r.path === m.path);
            if (row) row.path = m.destPath ? `${m.destPath}/${row.id}` : String(row.id);
          }
          return { type: WsMessageType.RESP_FAVORITE_MOVE, success: true };
        }
        default: {
          const i = table.findIndex(r => r.path === m.path);
          if (i >= 0) table.splice(i, 1);
          return { type: WsMessageType.RESP_FAVORITE_DELETE, success: true };
        }
      }
    });
    return { session: s, table, sent };
  }

  function install(fav: ReturnType<typeof favFolderSession>): void {
    jest.spyOn(session, 'login').mockResolvedValue(fav.session);
    jest.spyOn(session, 'logoff').mockResolvedValue(undefined);
  }

  it('creates a folder, moves a link in, moves it back out, deletes the folder — restoring the tree', async () => {
    const fav = favFolderSession();
    install(fav);

    const result = await flowByName('favorites-folders').run(ctx);

    expect(result.status).toBe('PASS');
    expect(fav.table).toEqual([]);
  });

  it('sweeps a marker folder and its marker link left by an interrupted run, deepest path first', async () => {
    const fav = favFolderSession([
      { id: 9, name: 'e2e-favfolder 2026-01-01', x: 0, y: 0, path: '9', isFolder: true },
      { id: 10, name: 'e2e-favfolder-link', x: 1, y: 2, path: '9/10', isFolder: false },
    ]);
    install(fav);

    const result = await flowByName('favorites-folders').run(ctx);

    expect(result.status).toBe('PASS');
    expect(fav.table).toEqual([]);
    const deletePaths = fav.sent
      .filter(m => m.type === WsMessageType.REQ_FAVORITE_DELETE)
      .map(m => (m as unknown as { path: string }).path);
    // The link (the deeper path) is swept before the folder that held it.
    expect(deletePaths.indexOf('9/10')).toBeLessThan(deletePaths.indexOf('9'));
  });

  it('fails when the folder create is refused', async () => {
    const fav = favFolderSession([], { refuseCreate: true });
    install(fav);

    const result = await flowByName('favorites-folders').run(ctx);

    expect(result.status).toBe('FAIL');
    expect(result.assertions.find(a => !a.ok)?.what).toMatch(/folder create was accepted/);
  });

  it('fails when the move is acknowledged but the read-back still serves the link at the root', async () => {
    const fav = favFolderSession([], { moveLies: true });
    install(fav);

    const result = await flowByName('favorites-folders').run(ctx);

    expect(result.status).toBe('FAIL');
    expect(result.assertions.find(a => !a.ok)?.what).toMatch(/moved link.*path now sits under the folder/);
  });
});

describe('newspaper-read', () => {
  const TOWN = {
    name: 'Helartia',
    iconUrl: '',
    mayor: 'SPO_test3',
    population: 0,
    unemploymentPercent: 0,
    qualityOfLife: 0,
    x: 1,
    y: 2,
    path: '',
    classId: '512',
  };

  const ISSUES = [
    { folder: '002147483640@3-1-2027', date: '3/1/2027' },
    { folder: '002147483641@2-28-2027', date: '2/28/2027' },
  ];

  const ISSUE = {
    paperName: 'Helartia Herald',
    folder: '002147483640@3-1-2027',
    townName: 'Helartia',
    title: 'Helartia Herald',
    date: 'Monday, March 01, 2027',
    stories: [{ headline: 'Domestic Wars!', byline: '', body: 'One person died.' }],
    error: '',
  };

  /**
   * The flow is three round-trips: the inspector read that names the paper,
   * the bar, then one issue. The first is a session helper, the other two go
   * through the driver — so each can be moved while the others hold still.
   */
  function arrange(over: {
    paper?: string;
    list?: { paperName: string; issues: typeof ISSUES; error: string };
    issue?: typeof ISSUE;
  } = {}) {
    const {
      paper = 'Helartia Herald',
      list = { paperName: paper, issues: ISSUES, error: '' },
      issue = ISSUE,
    } = over;

    const requests: WsMessage[] = [];
    jest.spyOn(session, 'login').mockResolvedValue(stubSession((msg) => {
      requests.push(msg);
      if (msg.type === WsMessageType.REQ_NEWSPAPER_ISSUES) return { list };
      if (msg.type === WsMessageType.REQ_NEWSPAPER_ISSUE) return { issue };
      return undefined;
    }));
    jest.spyOn(session, 'logoff').mockResolvedValue(undefined);
    jest.spyOn(session, 'resolveVisualClass').mockResolvedValue('7010');
    jest.spyOn(session, 'findTown').mockResolvedValue(TOWN);
    jest.spyOn(session, 'readBuildingDetails').mockResolvedValue({
      tabs: [{ id: 'townGeneral' }],
      groups: paper === ''
        ? { townGeneral: [{ name: 'Town', value: 'Helartia' }] }
        : { townGeneral: [{ name: 'NewspaperName', value: paper }] },
    } as unknown as Awaited<ReturnType<typeof session.readBuildingDetails>>);

    return requests;
  }

  it('passes when the paper lists issues and the newest one opens', async () => {
    arrange();
    expect((await flowByName('newspaper-read').run(ctx)).status).toBe('PASS');
  });

  it('fails when the town hall names no paper', async () => {
    arrange({ paper: '' });
    const result = await flowByName('newspaper-read').run(ctx);
    expect(result.status).toBe('FAIL');
    expect(result.assertions.find(a => !a.ok)?.what).toMatch(/names its paper/);
  });

  // A bar that parses but lists nothing is the world running no news server —
  // an environment exception. It is recorded, and no issue is opened.
  it('is UNPROVEN, and opens no issue, when the paper keeps none', async () => {
    const requests = arrange({ list: { paperName: 'Helartia Herald', issues: [], error: '' } });
    const result = await flowByName('newspaper-read').run(ctx);
    expect(result.status).toBe('UNPROVEN');
    expect(result.unproven).toHaveLength(1);
    expect(result.unproven[0]).toMatch(/Helartia Herald: 0 issues/);
    expect(result.assertions.every(a => a.ok)).toBe(true);
    expect(requests.some(m => m.type === WsMessageType.REQ_NEWSPAPER_ISSUE)).toBe(false);
  });

  it('fails when the bar itself could not be read — a failure wins over UNPROVEN', async () => {
    arrange({ list: { paperName: 'Helartia Herald', issues: [], error: 'HTTP 500' } });
    const result = await flowByName('newspaper-read').run(ctx);
    expect(result.status).toBe('FAIL');
    expect(result.unproven).toHaveLength(1);
    expect(result.assertions.find(a => !a.ok)?.detail).toBe('HTTP 500');
  });

  it('fails when the issue answers with an error', async () => {
    arrange({ issue: { ...ISSUE, stories: [], error: 'The issue could not be read.' } });
    const result = await flowByName('newspaper-read').run(ctx);
    expect(result.status).toBe('FAIL');
    expect(result.assertions.find(a => !a.ok)?.what).toMatch(/newest issue was read/);
  });

  it('fails when the issue opens with no story in it', async () => {
    arrange({ issue: { ...ISSUE, stories: [] } });
    const result = await flowByName('newspaper-read').run(ctx);
    expect(result.status).toBe('FAIL');
    expect(result.assertions.find(a => !a.ok)?.what).toMatch(/opens with stories/);
  });

  it('fails when the issue answers for another folder', async () => {
    arrange({ issue: { ...ISSUE, folder: '002147483641@2-28-2027' } });
    const result = await flowByName('newspaper-read').run(ctx);
    expect(result.status).toBe('FAIL');
    expect(result.assertions.find(a => !a.ok)?.what).toMatch(/folder that was asked for/);
  });

  // `ShowBar.asp:87` selects the first folder when nothing is chosen, and the
  // gateway hands the list back newest first.
  it('requests the newest folder, and the paper the town hall named', async () => {
    const requests = arrange();
    await flowByName('newspaper-read').run(ctx);

    const bar = requests.find(m => m.type === WsMessageType.REQ_NEWSPAPER_ISSUES);
    expect(bar).toMatchObject({
      paperName: 'Helartia Herald',
      townName: 'Helartia',
      isCapitol: false,
      buildingX: 1,
      buildingY: 2,
    });
    const opened = requests.find(m => m.type === WsMessageType.REQ_NEWSPAPER_ISSUE);
    expect(opened).toMatchObject({ folder: '002147483640@3-1-2027' });
  });
});

describe('zoning-alert-read', () => {
  const ZONED_ANCHOR = 'http://local.asp?frame_Id=MapIsoView&frame_Action=SELECT&x=220&y=41';

  function arrange(over: {
    inboxSubjects?: string[];
    htmlBody?: string | undefined;
    noHtmlBody?: boolean;
    onRequest?: (msg: WsMessage) => void;
    focusResult?: 'ok' | 'error';
    focusBuildingId?: string;
  } = {}) {
    const {
      focusBuildingId = '42',
      inboxSubjects = ['Zoning Alert!'],
      htmlBody = over.noHtmlBody ? undefined : `<a href="${ZONED_ANCHOR}">Demolished Building</a>`,
      onRequest,
      focusResult = 'ok',
    } = over;

    const requests: WsMessage[] = [];
    jest.spyOn(session, 'login').mockResolvedValue(
      stubSession(msg => {
        requests.push(msg);
        onRequest?.(msg);
        switch (msg.type) {
          case WsMessageType.REQ_MAIL_CONNECT:
            return { type: WsMessageType.RESP_MAIL_CONNECTED, unreadCount: 0 };
          case WsMessageType.REQ_MAIL_GET_FOLDER:
            return {
              type: WsMessageType.RESP_MAIL_FOLDER,
              folder: 'Inbox',
              messages: inboxSubjects.map((subject, i) => ({ messageId: String(i), subject })),
            };
          case WsMessageType.REQ_MAIL_READ_MESSAGE:
            return { type: WsMessageType.RESP_MAIL_MESSAGE, message: { htmlBody } };
          case WsMessageType.REQ_BUILDING_FOCUS:
            if (focusResult === 'error') {
              throw new WsDriverError('not found', 404, WsMessageType.REQ_BUILDING_FOCUS);
            }
            return { type: WsMessageType.RESP_BUILDING_FOCUS, building: { buildingId: focusBuildingId } };
          case WsMessageType.REQ_BUILDING_UNFOCUS:
            return { type: WsMessageType.RESP_CHAT_SUCCESS };
          default:
            return undefined;
        }
      }),
    );
    jest.spyOn(session, 'logoff').mockResolvedValue(undefined);
    return requests;
  }

  it('opens the newest alert, translates the link and drives REQ_BUILDING_FOCUS', async () => {
    const requests = arrange();

    const result = await flowByName('zoning-alert-read').run(ctx);

    expect(result.status).toBe('PASS');
    expect(requests).toContainEqual(
      expect.objectContaining({ type: WsMessageType.REQ_BUILDING_FOCUS, x: 220, y: 41 }),
    );
    expect(requests.some(m => m.type === WsMessageType.REQ_BUILDING_UNFOCUS)).toBe(true);
  });

  it('an empty inbox is UNPROVEN, and sends no REQ_BUILDING_FOCUS', async () => {
    const requests = arrange({ inboxSubjects: [] });

    const result = await flowByName('zoning-alert-read').run(ctx);

    expect(result.status).toBe('UNPROVEN');
    expect(result.unproven).toHaveLength(1);
    expect(result.unproven[0]).toMatch(/no "Zoning Alert!" in the inbox/);
    expect(requests.some(m => m.type === WsMessageType.REQ_BUILDING_FOCUS)).toBe(false);
  });

  it('FAILs when the focus reply names no building', async () => {
    arrange({ focusBuildingId: '' });

    const result = await flowByName('zoning-alert-read').run(ctx);

    expect(result.status).toBe('FAIL');
    expect(result.assertions.find(a => !a.ok)?.what).toMatch(/focus opened on a building/);
  });

  it('FAILs when the alert page has no htmlBody', async () => {
    arrange({ noHtmlBody: true });

    const result = await flowByName('zoning-alert-read').run(ctx);

    expect(result.status).toBe('FAIL');
    expect(result.assertions.find(a => !a.ok)?.what).toMatch(/map-select link/);
  });

  it('accepts a demolished-building focus error without failing the flow', async () => {
    arrange({ focusResult: 'error' });

    const result = await flowByName('zoning-alert-read').run(ctx);

    expect(result.status).toBe('PASS');
    expect(result.assertions.find(a => /building is gone/.test(a.what))).toMatchObject({ ok: true });
  });
});

describe('zoning-alert-read seed', () => {
  const HALL = {
    name: 'Helartia',
    iconUrl: '',
    mayor: 'SPO_test3',
    population: 0,
    unemploymentPercent: 0,
    qualityOfLife: 0,
    x: 220,
    y: 41,
    path: '',
    classId: '512',
  };
  const ZONED_ANCHOR = 'http://local.asp?frame_Id=MapIsoView&frame_Action=SELECT&x=220&y=41';

  function header(messageId: string, subject: string, from: string, to: string): MailMessageHeader {
    return {
      messageId, subject, from, to, fromAddr: '', toAddr: '', date: '', dateFmt: '', read: false, stamp: 0, noReply: false,
    };
  }

  interface Logged { account: string; msg: WsMessage }

  function arrange(over: {
    inbox?: MailMessageHeader[];
    sent?: MailMessageHeader[];
    compose?: 'ok' | 'refused' | 'throws';
    readThrows?: boolean;
    noIp?: boolean;
    loginRejects?: boolean;
    refuseDeleteOf?: string;
    /** Which loginSecondary calls answer `{ skipped }`: 1 pre-sweep, 2 seed, 3 cleanup. */
    refuseSecondaryOn?: number[];
  } = {}) {
    const mailboxes: Record<string, MailMessageHeader[]> = {
      [`${PRIMARY_ACCOUNT.username}/Inbox`]: [...(over.inbox ?? [])],
      [`${SECONDARY_ACCOUNT.username}/Sent`]: [...(over.sent ?? [])],
    };
    const requests: Logged[] = [];
    let seq = 0;
    jest.spyOn(session, 'login').mockImplementation(async account => {
      if (over.loginRejects) throw new Error('login refused');
      const stub = stubSession(msg => {
        requests.push({ account: account.username, msg });
        const m = msg as WsMessage & { folder?: string; messageId?: string; to?: string; subject?: string };
        switch (msg.type) {
          case WsMessageType.REQ_MAIL_CONNECT:
            return { type: WsMessageType.RESP_MAIL_CONNECTED, unreadCount: 0 };
          case WsMessageType.REQ_MAIL_GET_FOLDER:
            return {
              type: WsMessageType.RESP_MAIL_FOLDER,
              folder: m.folder,
              messages: [...(mailboxes[`${account.username}/${m.folder}`] ?? [])],
            };
          case WsMessageType.REQ_MAIL_DELETE: {
            if (m.messageId === over.refuseDeleteOf) return { type: WsMessageType.RESP_MAIL_DELETED, success: false };
            const box = mailboxes[`${account.username}/${m.folder}`] ?? [];
            const i = box.findIndex(h => h.messageId === m.messageId);
            if (i >= 0) box.splice(i, 1);
            return { type: WsMessageType.RESP_MAIL_DELETED, success: i >= 0 };
          }
          case WsMessageType.REQ_MAIL_COMPOSE: {
            if (over.compose === 'throws') throw new WsDriverError('mail socket closed', 500, msg.type);
            if (over.compose === 'refused') {
              return { type: WsMessageType.RESP_MAIL_SENT, success: false, message: 'Post refused' };
            }
            seq++;
            mailboxes[`${m.to}/Inbox`].push(header(`seeded${seq}`, m.subject ?? '', account.username, m.to ?? ''));
            mailboxes[`${account.username}/Sent`].push(
              header(`seededSent${seq}`, m.subject ?? '', account.username, m.to ?? ''),
            );
            return { type: WsMessageType.RESP_MAIL_SENT, success: true };
          }
          case WsMessageType.REQ_MAIL_READ_MESSAGE:
            if (over.readThrows) throw new Error('read blew up');
            return {
              type: WsMessageType.RESP_MAIL_MESSAGE,
              message: { htmlBody: `<a href="${ZONED_ANCHOR}">e2e-seed</a>` },
            };
          case WsMessageType.REQ_BUILDING_FOCUS:
            return { type: WsMessageType.RESP_BUILDING_FOCUS, building: { buildingId: '42' } };
          case WsMessageType.REQ_BUILDING_UNFOCUS:
            return { type: WsMessageType.RESP_CHAT_SUCCESS };
          default:
            return undefined;
        }
      });
      return {
        ...stub,
        account,
        world: over.noIp ? undefined : { name: 'planitia', url: '', ip: '10.1.2.3', port: 0 },
      };
    });
    // Crazz goes through loginSecondary; call N (1-based) of it is refused when listed.
    let secondaryCalls = 0;
    jest.spyOn(session, 'loginSecondary').mockImplementation(async () => {
      secondaryCalls++;
      if (over.refuseSecondaryOn?.includes(secondaryCalls)) return { skipped: `Crazz refused (call ${secondaryCalls})` };
      return session.login(SECONDARY_ACCOUNT);
    });
    jest.spyOn(session, 'logoff').mockResolvedValue(undefined);
    jest.spyOn(session, 'findTown').mockResolvedValue(HALL);
    return { requests, mailboxes };
  }

  const composeOf = (requests: Logged[]): Logged | undefined =>
    requests.find(r => r.msg.type === WsMessageType.REQ_MAIL_COMPOSE);
  const indexOf = (requests: Logged[], pred: (r: Logged) => boolean): number => requests.findIndex(pred);
  const isDelete = (account: string, folder: string, messageId: string) => (r: Logged): boolean =>
    r.account === account &&
    r.msg.type === WsMessageType.REQ_MAIL_DELETE &&
    (r.msg as WsMessage & { folder: string }).folder === folder &&
    (r.msg as WsMessage & { messageId: string }).messageId === messageId;

  it('sends the compose as Crazz, to SPO_test3, with the server alert\'s subject and header', async () => {
    const { requests } = arrange();

    const result = await runFlow(flowByName('zoning-alert-read'), ctx);

    const compose = composeOf(requests);
    expect(compose?.account).toBe(SECONDARY_ACCOUNT.username);
    expect(compose?.msg).toMatchObject({
      to: 'SPO_test3',
      subject: 'Zoning Alert!',
      headers: 'ContentType=text/html',
    });
    expect(result.seed?.ok).toBe(true);
    expect(result.status).toBe('PASS');
  });

  it('writes the three-line body, its META URL on the world IP and pointing at the hall tile', async () => {
    const { requests } = arrange();

    await runFlow(flowByName('zoning-alert-read'), ctx);

    const body = (composeOf(requests)?.msg as WsMessage & { body: string[] }).body;
    expect(body).toHaveLength(3);
    expect(body[0]).toBe('<HEAD>');
    expect(body[2]).toBe('</HEAD>');
    const match = /^<META HTTP-EQUIV="REFRESH" CONTENT="0; URL=([^">\s]+)">$/.exec(body[1]);
    expect(match).not.toBeNull();
    const url = new URL(match?.[1] ?? '');
    expect(url.hostname).toBe('10.1.2.3');
    expect(url.pathname.endsWith('MsgZoned.asp')).toBe(true);
    expect(url.searchParams.get('BuildX0')).toBe('220');
    expect(url.searchParams.get('BuildY0')).toBe('41');
    expect(url.searchParams.get('BuildName0')).toContain('e2e-seed');
  });

  it('sweeps stale Crazz-sent alerts from both mailboxes before the compose, sparing a server alert', async () => {
    const { requests } = arrange({
      inbox: [
        header('stale', 'Zoning Alert!', 'Crazz', 'SPO_test3'),
        header('srv', 'Zoning Alert!', 'mailer@GlobalPlanitia.net', 'SPO_test3'),
      ],
      sent: [header('staleSent', 'Zoning Alert!', 'Crazz', 'SPO_test3')],
    });

    const result = await runFlow(flowByName('zoning-alert-read'), ctx);

    const compose = indexOf(requests, r => r.msg.type === WsMessageType.REQ_MAIL_COMPOSE);
    const inboxDelete = indexOf(requests, isDelete('SPO_test3', 'Inbox', 'stale'));
    const sentDelete = indexOf(requests, isDelete('Crazz', 'Sent', 'staleSent'));
    expect(inboxDelete).toBeGreaterThanOrEqual(0);
    expect(sentDelete).toBeGreaterThanOrEqual(0);
    expect(inboxDelete).toBeLessThan(compose);
    expect(sentDelete).toBeLessThan(compose);
    expect(requests.some(r => (r.msg as WsMessage & { messageId?: string }).messageId === 'srv'
      && r.msg.type === WsMessageType.REQ_MAIL_DELETE)).toBe(false);
    expect(result.seed?.ok).toBe(true);
  });

  it('deletes the seeded message from both mailboxes after the flow', async () => {
    const { requests, mailboxes } = arrange();

    const result = await runFlow(flowByName('zoning-alert-read'), ctx);

    const focus = indexOf(requests, r => r.msg.type === WsMessageType.REQ_BUILDING_FOCUS);
    expect(focus).toBeGreaterThanOrEqual(0);
    expect(indexOf(requests, isDelete('SPO_test3', 'Inbox', 'seeded1'))).toBeGreaterThan(focus);
    expect(indexOf(requests, isDelete('Crazz', 'Sent', 'seededSent1'))).toBeGreaterThan(focus);
    expect(result.cleanup).toHaveLength(2);
    expect(result.cleanup?.every(c => c.ok)).toBe(true);
    expect(mailboxes['SPO_test3/Inbox']).toEqual([]);
    expect(mailboxes['Crazz/Sent']).toEqual([]);
  });

  it('still deletes the seeded message from both mailboxes when the flow throws', async () => {
    const { requests } = arrange({ readThrows: true });

    const result = await runFlow(flowByName('zoning-alert-read'), ctx);

    expect(result.status).toBe('FAIL');
    expect(result.error).toBe('read blew up');
    expect(indexOf(requests, isDelete('SPO_test3', 'Inbox', 'seeded1'))).toBeGreaterThanOrEqual(0);
    expect(indexOf(requests, isDelete('Crazz', 'Sent', 'seededSent1'))).toBeGreaterThanOrEqual(0);
  });

  it('a refused compose fails the seed, and the flow is not PASS and never focuses', async () => {
    const { requests } = arrange({
      compose: 'refused',
      inbox: [header('srv', 'Zoning Alert!', 'mailer@GlobalPlanitia.net', 'SPO_test3')],
    });

    const result = await runFlow(flowByName('zoning-alert-read'), ctx);

    expect(result.seed).toMatchObject({ ok: false, detail: 'Post refused' });
    expect(result.status).not.toBe('PASS');
    expect(result.status).toBe('UNPROVEN');
    expect(result.unproven[0]).toMatch(/seed failed/);
    expect(requests.some(r => r.msg.type === WsMessageType.REQ_BUILDING_FOCUS)).toBe(false);
  });

  it('a compose that throws fails the seed', async () => {
    arrange({ compose: 'throws' });

    const result = await runFlow(flowByName('zoning-alert-read'), ctx);

    expect(result.seed).toMatchObject({ ok: false, detail: 'mail socket closed' });
    expect(result.status).toBe('UNPROVEN');
  });

  it('a login with no world IP fails the seed, and sends no compose', async () => {
    const { requests } = arrange({ noIp: true });

    const result = await runFlow(flowByName('zoning-alert-read'), ctx);

    expect(result.seed).toMatchObject({ ok: false, detail: 'the login carried no world IP' });
    expect(composeOf(requests)).toBeUndefined();
  });

  it('ends SKIPPED when Crazz is refused in the pre-sweep, and sends no compose', async () => {
    const { requests } = arrange({ refuseSecondaryOn: [1] });

    const result = await runFlow(flowByName('zoning-alert-read'), { lock: cleanLock() });

    expect(result).toMatchObject({ status: 'SKIPPED', skipped: 'Crazz refused (call 1)' });
    expect(result.seed).toMatchObject({ ok: false, skipped: 'Crazz refused (call 1)' });
    expect(composeOf(requests)).toBeUndefined();
    expect(result.cleanup?.every(c => c.ok)).toBe(true);
  });

  it('ends SKIPPED when Crazz is refused at the seed login, and sends no compose', async () => {
    const { requests } = arrange({ refuseSecondaryOn: [2] });

    const result = await runFlow(flowByName('zoning-alert-read'), { lock: cleanLock() });

    expect(result).toMatchObject({ status: 'SKIPPED', skipped: 'Crazz refused (call 2)' });
    expect(composeOf(requests)).toBeUndefined();
    expect(requests.some(r => r.msg.type === WsMessageType.REQ_BUILDING_FOCUS)).toBe(false);
  });

  it('stays SKIPPED when the seed was skipped and the cleanup is refused too', async () => {
    arrange({ refuseSecondaryOn: [2, 3] });

    const result = await runFlow(flowByName('zoning-alert-read'), { lock: cleanLock() });

    expect(result.status).toBe('SKIPPED');
    expect(result.cleanup?.[1]).toMatchObject({ ok: false, skipped: 'Crazz refused (call 3)' });
  });

  it('FAILs, naming the leftover, when Crazz is refused in the cleanup after a successful seed', async () => {
    const { mailboxes } = arrange({ refuseSecondaryOn: [3] });

    const result = await runFlow(flowByName('zoning-alert-read'), { lock: cleanLock() });

    expect(result.seed?.ok).toBe(true);
    expect(result.status).toBe('FAIL');
    expect(result.cleanup?.[1]).toMatchObject({ ok: false, skipped: 'Crazz refused (call 3)' });
    expect(result.cleanup?.[1].detail).toMatch(/left in Crazz's Sent/);
    expect(mailboxes['Crazz/Sent']).toHaveLength(1);
  });

  it('a stale sweep that cannot log in fails the seed, and the cleanup reports it', async () => {
    arrange({ loginRejects: true });

    const result = await runFlow(flowByName('zoning-alert-read'), ctx);

    expect(result.seed?.ok).toBe(false);
    expect(result.seed?.detail).toMatch(/stale sweep/);
    expect(result.status).toBe('FAIL');
    expect(result.cleanup).toEqual([
      expect.objectContaining({ ok: false, detail: 'login refused' }),
      expect.objectContaining({ ok: false, detail: 'login refused' }),
    ]);
  });

  it('a delete the server refuses leaves that mailbox\'s cleanup not ok, and the flow FAILs', async () => {
    arrange({ refuseDeleteOf: 'seededSent1' });

    const result = await runFlow(flowByName('zoning-alert-read'), ctx);

    expect(result.cleanup).toEqual([
      expect.objectContaining({ ok: true, detail: '1/1 deleted' }),
      expect.objectContaining({ ok: false, detail: '0/1 deleted' }),
    ]);
    expect(result.status).toBe('FAIL');
  });
});

describe('nearest-town-hall', () => {
  const HELARTIA = { name: 'Helartia', iconUrl: '', mayor: null, population: 1, unemploymentPercent: 0, qualityOfLife: 0, x: 10, y: 10, path: '', classId: '' };
  const FARAWAY = { name: 'Faraway', iconUrl: '', mayor: null, population: 1, unemploymentPercent: 0, qualityOfLife: 0, x: 40, y: 0, path: '', classId: '' };

  function arrange(over: {
    towns?: typeof HELARTIA[];
    focusBuilding?: { buildingId: string; buildingName: string };
    tabs?: { id: string }[];
  } = {}) {
    const {
      towns = [HELARTIA, FARAWAY],
      focusBuilding = { buildingId: '1', buildingName: 'Helartia Town Hall' },
      tabs = [{ id: 'townTaxes' }],
    } = over;

    const requests: WsMessage[] = [];
    jest.spyOn(session, 'login').mockResolvedValue(
      stubSession(msg => {
        requests.push(msg);
        switch (msg.type) {
          case WsMessageType.REQ_SEARCH_MENU_TOWNS:
            return { type: WsMessageType.RESP_SEARCH_MENU_TOWNS, towns };
          case WsMessageType.REQ_MAP_LOAD:
            return { type: WsMessageType.RESP_MAP_DATA, data: { buildings: [{ x: HELARTIA.x, y: HELARTIA.y, visualClass: '5' }] } };
          case WsMessageType.REQ_BUILDING_FOCUS:
            return { type: WsMessageType.RESP_BUILDING_FOCUS, building: focusBuilding };
          case WsMessageType.REQ_BUILDING_DETAILS:
            return { type: WsMessageType.RESP_BUILDING_DETAILS, details: { tabs } };
          case WsMessageType.REQ_BUILDING_UNFOCUS:
            return { type: WsMessageType.RESP_CHAT_SUCCESS };
          default:
            return undefined;
        }
      }),
    );
    jest.spyOn(session, 'logoff').mockResolvedValue(undefined);
    return requests;
  }

  it('is read-only', () => {
    expect(flowByName('nearest-town-hall').mutates).toBe(false);
  });

  it('picks the governed town, focuses its hall and reads the taxes tab', async () => {
    const requests = arrange();

    const result = await flowByName('nearest-town-hall').run(ctx);

    expect(result.status).toBe('PASS');
    expect(requests).toContainEqual(
      expect.objectContaining({ type: WsMessageType.REQ_BUILDING_FOCUS, x: HELARTIA.x, y: HELARTIA.y }),
    );
    expect(requests.some(m => m.type === WsMessageType.REQ_BUILDING_UNFOCUS)).toBe(true);
  });

  it('FAILs when the governed town is missing from the list', async () => {
    arrange({ towns: [FARAWAY] });

    const result = await flowByName('nearest-town-hall').run(ctx);

    expect(result.status).toBe('FAIL');
    expect(result.assertions.find(a => !a.ok)?.what).toMatch(/still listed/);
  });

  it('FAILs when the focus reply has an empty buildingName', async () => {
    arrange({ focusBuilding: { buildingId: '', buildingName: '' } });

    const result = await flowByName('nearest-town-hall').run(ctx);

    expect(result.status).toBe('FAIL');
    expect(result.assertions.find(a => !a.ok)?.what).toMatch(/focus opened/);
  });

  it('FAILs when the tabs lack townTaxes', async () => {
    arrange({ tabs: [{ id: 'general' }] });

    const result = await flowByName('nearest-town-hall').run(ctx);

    expect(result.status).toBe('FAIL');
    expect(result.assertions.find(a => !a.ok)?.what).toMatch(/Town Hall template/);
  });
});

describe('directory-browse', () => {
  const TOWN = {
    name: 'Helartia',
    iconUrl: '',
    mayor: 'SPO_test3',
    population: 0,
    unemploymentPercent: 0,
    qualityOfLife: 0,
    x: 1,
    y: 2,
    path: 'Towns\\Helartia.five',
    classId: '512',
  };

  const CARD = {
    name: 'Cheap House 1',
    company: 'Crazz Ltd',
    iconUrl: '',
    netProfitText: '$1,234',
    costText: '-$500',
    roiText: 'Already.',
    creator: 'SPO_test3',
    x: 1,
    y: 2,
  };

  const ROW = {
    name: 'Cheap House 1',
    itemName: 'Cheap House 1',
    path: 'Towns\\Helartia.five\\Facilities\\Residentials',
    iconUrl: '',
    company: 'Crazz Ltd',
    x: 1,
    y: 2,
  };

  /** One responder keyed on the ref kind, plus the refs the flow actually sent. */
  function arrange(over: {
    town?: typeof TOWN;
    townName?: string;
    kinds?: string[];
    rows?: (typeof ROW)[];
    card?: typeof CARD | null;
    townCompanies?: string[];
    ownedBy?: string | null;
    ownerCompanies?: string[];
    companyKinds?: string[];
    tycoonRows?: (typeof ROW)[];
  } = {}) {
    const {
      town = TOWN,
      townName = 'Helartia',
      kinds = ['Residentials'],
      rows = [ROW],
      card = CARD,
      townCompanies = ['Crazz Ltd'],
      ownedBy = 'Crazz',
      ownerCompanies = ['Crazz Ltd'],
      companyKinds = ['Residentials'],
      tycoonRows = [ROW],
    } = over;

    const refs: { kind: string }[] = [];
    jest.spyOn(session, 'login').mockResolvedValue(stubSession((msg) => {
      if (msg.type !== WsMessageType.REQ_SEARCH_MENU_DIRECTORY) return undefined;
      const ref = (msg as unknown as { ref: { kind: string } }).ref;
      refs.push(ref);
      switch (ref.kind) {
        case 'town':
          return { ref, page: { kind: 'town', town: { name: townName, iconUrl: '', inhabitants: 0, qualityOfLife: 0, unemploymentPercent: 0, x: 1, y: 2 } } };
        case 'town-facilities':
          return { ref, page: { kind: 'folder', items: kinds, ownedBy: null } };
        case 'town-facility-kind':
          return { ref, page: { kind: 'facility-list', facilities: rows } };
        case 'facility':
          return { ref, page: { kind: 'facility', facility: card } };
        case 'town-companies':
          return { ref, page: { kind: 'folder', items: townCompanies, ownedBy: null } };
        case 'town-company':
          return { ref, page: { kind: 'folder', items: ['Residentials'], ownedBy } };
        case 'tycoon-companies':
          return { ref, page: { kind: 'folder', items: ownerCompanies, ownedBy: null } };
        case 'tycoon-company':
          return { ref, page: { kind: 'folder', items: companyKinds, ownedBy: null } };
        case 'tycoon-facility-kind':
          return { ref, page: { kind: 'facility-list', facilities: tycoonRows } };
        default:
          throw new Error(`unexpected ref ${ref.kind}`);
      }
    }));
    jest.spyOn(session, 'logoff').mockResolvedValue(undefined);
    jest.spyOn(session, 'findTown').mockResolvedValue(town);

    return refs;
  }

  // #1140: the walk now continues past the card into the company and tycoon branches.
  it('walks town -> Facilities -> a kind -> a card -> the company and tycoon branches, in that order', async () => {
    const refs = arrange();

    const result = await flowByName('directory-browse').run(ctx);

    expect(result.status).toBe('PASS');
    expect(refs.map(r => r.kind)).toEqual([
      'town', 'town-facilities', 'town-facility-kind', 'facility',
      'town-companies', 'town-company', 'tycoon-companies', 'tycoon-company', 'tycoon-facility-kind',
    ]);
    expect(refs[3]).toEqual({ kind: 'facility', path: ROW.path, name: ROW.itemName });
    expect(refs[5]).toEqual({ kind: 'town-company', town: 'Helartia', company: 'Crazz Ltd' });
    expect(refs[6]).toEqual({ kind: 'tycoon-companies', tycoon: 'Crazz' });
    expect(refs[8]).toEqual(expect.objectContaining({ facKind: 'Residentials', tycoon: 'Crazz', company: 'Crazz Ltd' }));
    expect(result.assertions.some(a => a.what.includes('"Crazz Ltd"'))).toBe(true);
  });

  it.each([
    ['town companies without the row\'s company', { townCompanies: ['Other Co'] }, 'town-companies'],
    ['no owner', { ownedBy: null }, 'town-company'],
    ['owner companies without it', { ownerCompanies: [] }, 'tycoon-companies'],
    ['no facility kind', { companyKinds: [] }, 'tycoon-company'],
    ['no facility row', { tycoonRows: [] }, 'tycoon-facility-kind'],
  ] as const)('fails, and stops there, on %s', async (_label, over, last) => {
    const refs = arrange(over as Parameters<typeof arrange>[0]);

    const result = await flowByName('directory-browse').run(ctx);

    expect(result.status).toBe('FAIL');
    expect(refs[refs.length - 1].kind).toBe(last);
    expect(result.assertions.some(a => a.what === 'no gateway errors')).toBe(false);
  });

  it('opens no company page when the row names no company', async () => {
    const refs = arrange({ rows: [{ ...ROW, company: null as unknown as string }] });

    await flowByName('directory-browse').run(ctx);

    expect(refs[refs.length - 1].kind).toBe('facility');
  });

  it('is read-only', () => {
    expect(flowByName('directory-browse').mutates).toBe(false);
  });

  it('fails, and asks for nothing, when the town list carries no cache path', async () => {
    const refs = arrange({ town: { ...TOWN, path: '' } });

    const result = await flowByName('directory-browse').run(ctx);

    expect(result.status).toBe('FAIL');
    expect(result.assertions.find(a => !a.ok)?.what).toMatch(/cache path/);
    expect(refs).toEqual([]);
  });

  it('fails when the town page comes back as Unknown Town', async () => {
    const refs = arrange({ townName: 'Unknown Town' });

    const result = await flowByName('directory-browse').run(ctx);

    expect(result.status).toBe('FAIL');
    expect(result.assertions.find(a => !a.ok)?.detail).toBe('Unknown Town');
    expect(refs.map(r => r.kind)).toEqual(['town']);
  });

  it('fails, and opens no facility, when the town lists no facility kind', async () => {
    const refs = arrange({ kinds: [] });

    const result = await flowByName('directory-browse').run(ctx);

    expect(result.status).toBe('FAIL');
    expect(refs.map(r => r.kind)).toEqual(['town', 'town-facilities']);
  });

  it('fails when a row under Facilities names no owning company', async () => {
    arrange({ rows: [{ ...ROW, company: null as unknown as string }] });

    const result = await flowByName('directory-browse').run(ctx);

    expect(result.status).toBe('FAIL');
    expect(result.assertions.find(a => !a.ok)?.what).toMatch(/owning company/);
  });

  it('fails when the kind lists no facility at all', async () => {
    const refs = arrange({ rows: [] });

    const result = await flowByName('directory-browse').run(ctx);

    expect(result.status).toBe('FAIL');
    expect(refs.map(r => r.kind)).toEqual(['town', 'town-facilities', 'town-facility-kind']);
  });

  it('fails when the facility card does not resolve', async () => {
    arrange({ card: null });

    const result = await flowByName('directory-browse').run(ctx);

    expect(result.status).toBe('FAIL');
    expect(result.assertions.find(a => !a.ok)?.what).toMatch(/card resolved/);
  });

  it('fails when ROI is not one of the three legacy forms', async () => {
    arrange({ card: { ...CARD, roiText: '12' } });

    const result = await flowByName('directory-browse').run(ctx);

    expect(result.status).toBe('FAIL');
    expect(result.assertions.find(a => !a.ok)?.what).toMatch(/three legacy forms/);
  });
});

describe('search-menu-read', () => {
  type Over = {
    categories?: { id: string; label: string; enabled?: boolean }[];
    rankings?: { id: string; label: string; url: string; level: number; children?: unknown[] }[];
    title?: string;
    entries?: { rank: number; name: string; valueText: string }[];
    level?: string;
    currentLevelName?: string;
    banks?: { name: string; company: string }[];
    newspapers?: { paperName: string; townName: string }[];
    results?: string[];
  };

  function arrange(over: Over = {}) {
    const {
      categories = [{ id: 'rankings', label: 'Rankings', enabled: true }],
      rankings = [{ id: 'nta', label: 'NTA', url: 'Rankings/NTA', level: 0 }],
      title = 'NTA',
      entries = [{ rank: 1, name: 'Crazz', valueText: '1' }],
      level = 'Apprentice',
      currentLevelName = 'Apprentice',
      banks = [{ name: 'Bank 1', company: 'Crazz Ltd' }],
      newspapers = [{ paperName: 'Herald', townName: 'Helartia' }],
      results = ['SPO_test3'],
    } = over;
    const sent: Record<string, unknown>[] = [];
    jest.spyOn(session, 'login').mockResolvedValue(stubSession((msg) => {
      sent.push(msg as unknown as Record<string, unknown>);
      switch (msg.type) {
        case WsMessageType.REQ_SEARCH_MENU_HOME: return { categories };
        case WsMessageType.REQ_SEARCH_MENU_RANKINGS: return { categories: rankings };
        case WsMessageType.REQ_SEARCH_MENU_RANKING_DETAIL: return { title, entries };
        case WsMessageType.REQ_SEARCH_MENU_TYCOON_PROFILE: return { profile: { level } };
        case WsMessageType.REQ_SEARCH_MENU_TYCOON_FULL_PROFILE:
          return { tycoonName: 'x', data: { currentLevelName } as unknown as Record<string, unknown> };
        case WsMessageType.REQ_SEARCH_MENU_BANKS: return { banks };
        case WsMessageType.REQ_SEARCH_MENU_NEWSPAPERS: return { newspapers };
        case WsMessageType.REQ_SEARCH_MENU_PEOPLE_SEARCH: return { results };
        default: return undefined;
      }
    }));
    const off = jest.spyOn(session, 'logoff').mockResolvedValue(undefined);
    return { sent, off };
  }

  const run = () => flowByName('search-menu-read').run(ctx);
  const failed = (r: Awaited<ReturnType<typeof run>>) => r.assertions.filter(a => !a.ok).map(a => a.what);
  const byType = (sent: Record<string, unknown>[], t: WsMessageType) => sent.filter(m => m.type === t);

  it('passes on a well-formed world, logs off, and is read-only', async () => {
    const { off } = arrange();
    const result = await run();
    expect(failed(result)).toEqual([]);
    expect(result.status).toBe('PASS');
    expect(off).toHaveBeenCalled();
    expect(flowByName('search-menu-read').mutates).toBe(false);
  });

  it('passes on an empty newspaper list and records the counts', async () => {
    arrange({ newspapers: [] });
    const result = await run();
    expect(result.status).toBe('PASS');
    expect(result.assertions.find(a => a.what.includes('newspapers'))?.detail).toBe('0 newspapers');
    expect(result.assertions.find(a => a.what.includes('banks'))?.detail).toBe('1 banks');
  });

  it('fails on a malformed bank or newspaper row', async () => {
    arrange({ banks: [{ name: '', company: '' }], newspapers: [{ paperName: '', townName: '' }] });
    expect(failed(await run())).toHaveLength(2);
  });

  it('fails on an empty home and an empty ranking list', async () => {
    arrange({ categories: [], rankings: [] });
    const result = await run();
    expect(failed(result)).toEqual(expect.arrayContaining([
      'the search home lists at least one tile', 'the rankings list at least one ranking', 'some ranking carries a url',
    ]));
  });

  it('fails when the tycoon card level is Unknown', async () => {
    arrange({ level: 'Unknown' });
    const result = await run();
    expect(result.status).toBe('FAIL');
    expect(failed(result)).toEqual([expect.stringMatching(/card carries a level/)]);
  });

  it('fails when the full profile has an empty current level', async () => {
    arrange({ currentLevelName: '  ' });
    const result = await run();
    expect(failed(result)).toEqual([expect.stringMatching(/full profile names a current level/)]);
  });

  it('opens the first ranking with a url, depth-first', async () => {
    const { sent } = arrange({
      rankings: [
        { id: 'a', label: 'A', url: '', level: 0, children: [
          { id: 'a1', label: 'A1', url: '', level: 1 },
          { id: 'a2', label: 'A2', url: 'Rankings/A2', level: 1 },
        ] },
        { id: 'b', label: 'B', url: 'Rankings/B', level: 0 },
      ],
    });
    await run();
    expect(byType(sent, WsMessageType.REQ_SEARCH_MENU_RANKING_DETAIL)).toEqual([
      expect.objectContaining({ rankingPath: 'Rankings/A2' }),
    ]);
  });

  it('fails with no openable ranking, and still reads banks, newspapers and people', async () => {
    const { sent } = arrange({ rankings: [{ id: 'a', label: 'A', url: '', level: 0 }] });
    const result = await run();
    expect(failed(result)).toEqual(['some ranking carries a url']);
    expect(byType(sent, WsMessageType.REQ_SEARCH_MENU_RANKING_DETAIL)).toEqual([]);
    expect(byType(sent, WsMessageType.REQ_SEARCH_MENU_BANKS)).toHaveLength(1);
    expect(byType(sent, WsMessageType.REQ_SEARCH_MENU_NEWSPAPERS)).toHaveLength(1);
    expect(byType(sent, WsMessageType.REQ_SEARCH_MENU_PEOPLE_SEARCH)).toHaveLength(1);
  });

  it('fails on a ranking detail with no title and no rows', async () => {
    const { sent } = arrange({ title: '', entries: [] });
    const result = await run();
    expect(failed(result)).toEqual(expect.arrayContaining([
      'the ranking detail has a title', 'the ranking detail lists at least one row',
    ]));
    expect(byType(sent, WsMessageType.REQ_SEARCH_MENU_TYCOON_PROFILE)).toEqual([]);
  });

  it('reads the profiles of the first tycoon that is not the session\'s own', async () => {
    const { sent } = arrange({ entries: [
      { rank: 1, name: 'SPO_test3', valueText: '1' }, { rank: 2, name: 'Crazz', valueText: '2' },
    ] });
    await run();
    expect(byType(sent, WsMessageType.REQ_SEARCH_MENU_TYCOON_PROFILE)).toEqual([expect.objectContaining({ tycoonName: 'Crazz' })]);
    expect(byType(sent, WsMessageType.REQ_SEARCH_MENU_TYCOON_FULL_PROFILE)).toEqual([expect.objectContaining({ tycoonName: 'Crazz' })]);
  });

  it('fails when the ranking lists only the session\'s own tycoon', async () => {
    arrange({ entries: [{ rank: 1, name: 'SPO_test3', valueText: '1' }] });
    const result = await run();
    expect(failed(result)).toEqual([expect.stringMatching(/a tycoon other than/)]);
  });

  it('searches the people index by prefix and fails when the account is absent', async () => {
    const { sent } = arrange({ results: ['Someone'] });
    const result = await run();
    expect(byType(sent, WsMessageType.REQ_SEARCH_MENU_PEOPLE_SEARCH)).toEqual([
      expect.objectContaining({ searchStr: 'S', mode: 'prefix' }),
    ]);
    expect(failed(result)).toEqual([expect.stringMatching(/"S" index lists SPO_test3/)]);
  });
});

describe('warehouse-role-reading', () => {
  type B = { x: number; y: number; visualClass: string; handler: string; props?: { name: string; value: string }[] };

  function arrange(buildings: B[] | undefined, fail = false) {
    const stub = stubSession(msg =>
      msg.type === WsMessageType.REQ_MAP_LOAD
        ? { type: WsMessageType.RESP_MAP_DATA, ...(buildings ? { data: { buildings } } : {}) }
        : undefined,
    );
    jest.spyOn(session, 'login').mockResolvedValue(stub);
    const off = jest.spyOn(session, 'logoff').mockResolvedValue(undefined);
    jest.spyOn(session, 'findTown').mockResolvedValue(helartia);
    const read = jest.spyOn(session, 'readBuildingDetails').mockImplementation(async (_s, x, y) => {
      if (fail) throw new Error('details timed out');
      const b = (buildings ?? []).find(c => c.x === x && c.y === y)!;
      return {
        templateName: `T-${b.handler}`,
        visualClass: b.visualClass,
        tabs: [{ id: 'g', name: 'G', icon: '', order: 0, handlerName: b.handler }],
        groups: { g: [{ name: 'Name', value: 'x' }], h: b.props ?? [] },
      } as unknown as Awaited<ReturnType<typeof session.readBuildingDetails>>;
    });
    return { off, read, stub };
  }

  it('is read-only and listed', () => {
    expect(flowByName('warehouse-role-reading').mutates).toBe(false);
  });

  it('records Role as absent when the read does not serve it, asserting nothing', async () => {
    const { off, stub } = arrange([{ x: 101, y: 201, visualClass: '4001', handler: 'WHGeneral' }]);
    const result = await flowByName('warehouse-role-reading').run(ctx);
    expect(result.status).toBe('PASS');
    expect(result.assertions).toEqual([]);
    expect(result.readings).toEqual([
      {
        facility: 'warehouse', x: 101, y: 201, visualClass: '4001',
        templateName: 'T-WHGeneral', role: 'absent', tradeRole: 'absent',
      },
    ]);
    expect(stub.driver.request).toHaveBeenCalledWith(
      expect.objectContaining({ type: WsMessageType.REQ_MAP_LOAD, x: 68, y: 168, width: 64, height: 64 }),
      expect.anything(),
      expect.anything(),
    );
    expect(off).toHaveBeenCalledTimes(1);
  });

  it("records Role = 'Warehouse' verbatim", async () => {
    arrange([{ x: 101, y: 201, visualClass: '4001', handler: 'WHGeneral', props: [{ name: 'Role', value: 'Warehouse' }] }]);
    const result = await flowByName('warehouse-role-reading').run(ctx);
    expect(result.assertions).toEqual([]);
    expect(result.readings?.[0]).toMatchObject({ role: 'Warehouse' });
  });

  it('records a numeric Role verbatim, and an empty one as empty', async () => {
    arrange([
      { x: 101, y: 201, visualClass: '4001', handler: 'WHGeneral', props: [{ name: 'Role', value: '2' }, { name: 'TradeRole', value: '' }] },
    ]);
    const result = await flowByName('warehouse-role-reading').run(ctx);
    expect(result.assertions).toEqual([]);
    expect(result.readings?.[0]).toMatchObject({ role: '2', tradeRole: '' });
  });

  it('records the nearest trading industry, skipping one whose TradeRole is not 2/5/6', async () => {
    arrange([
      { x: 150, y: 230, visualClass: '4001', handler: 'WHGeneral' },
      { x: 100, y: 201, visualClass: '5001', handler: 'IndGeneral', props: [{ name: 'TradeRole', value: '1' }] },
      { x: 100, y: 202, visualClass: '5001', handler: 'IndGeneral', props: [{ name: 'Role', value: '0' }, { name: 'TradeRole', value: '5' }] },
      { x: 100, y: 203, visualClass: '5001', handler: 'IndGeneral', props: [{ name: 'TradeRole', value: '6' }] },
    ]);
    const result = await flowByName('warehouse-role-reading').run(ctx);
    expect(result.status).toBe('PASS');
    expect(result.readings).toEqual([
      expect.objectContaining({ facility: 'warehouse', x: 150, y: 230 }),
      { facility: 'industry', x: 100, y: 202, visualClass: '5001', templateName: 'T-IndGeneral', role: '0', tradeRole: '5' },
    ]);
  });

  it('does not re-read a class already known to be neither warehouse nor industry, nor a second warehouse', async () => {
    const { read } = arrange([
      { x: 100, y: 201, visualClass: '7', handler: 'Residential' },
      { x: 100, y: 202, visualClass: '7', handler: 'Residential' },
      { x: 100, y: 203, visualClass: '4001', handler: 'WHGeneral' },
      { x: 100, y: 204, visualClass: '4001', handler: 'WHGeneral' },
      { x: 100, y: 205, visualClass: '5001', handler: 'IndGeneral', props: [{ name: 'TradeRole', value: '2' }] },
      { x: 100, y: 206, visualClass: '5001', handler: 'IndGeneral', props: [{ name: 'TradeRole', value: '2' }] },
    ]);
    const result = await flowByName('warehouse-role-reading').run(ctx);
    expect(read).toHaveBeenCalledTimes(3);
    expect(result.readings).toHaveLength(2);
  });

  it('skips a known industry class once an industry is recorded', async () => {
    const { read } = arrange([
      { x: 100, y: 201, visualClass: '5001', handler: 'IndGeneral', props: [{ name: 'TradeRole', value: '2' }] },
      { x: 100, y: 202, visualClass: '5001', handler: 'IndGeneral', props: [{ name: 'TradeRole', value: '2' }] },
      { x: 100, y: 203, visualClass: '8', handler: '' },
    ]);
    const result = await flowByName('warehouse-role-reading').run(ctx);
    expect(read).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('UNPROVEN');
    expect(result.readings).toEqual([expect.objectContaining({ facility: 'industry', x: 100, y: 201 })]);
  });

  it('reports UNPROVEN, never PASS, when no warehouse is in the window', async () => {
    arrange([{ x: 100, y: 201, visualClass: '7', handler: 'Residential' }]);
    const result = await flowByName('warehouse-role-reading').run(ctx);
    expect(result.status).toBe('UNPROVEN');
    expect(result.unproven).toHaveLength(1);
    expect(result.unproven[0]).toMatch(/WHGeneral/);
    expect(result.unproven[0]).toMatch(/1 building\(s\).*1 inspector read/);
    expect(result.readings).toEqual([]);
  });

  it('stops after 40 inspector reads and reports UNPROVEN', async () => {
    const many = Array.from({ length: 45 }, (_, i) => ({ x: 100, y: 201 + i, visualClass: `c${i}`, handler: 'Other' }));
    many.push({ x: 150, y: 250, visualClass: '4001', handler: 'WHGeneral' });
    const { read } = arrange(many);
    const result = await flowByName('warehouse-role-reading').run(ctx);
    expect(read).toHaveBeenCalledTimes(40);
    expect(result.status).toBe('UNPROVEN');
  });

  it('reports UNPROVEN with zero buildings when the map answer carries no data', async () => {
    arrange(undefined);
    const result = await flowByName('warehouse-role-reading').run(ctx);
    expect(result.status).toBe('UNPROVEN');
    expect(result.unproven[0]).toMatch(/0 building\(s\)/);
  });

  it('fails when the read itself fails, and still logs off', async () => {
    const { off } = arrange([{ x: 101, y: 201, visualClass: '4001', handler: 'WHGeneral' }], true);
    const result = await runFlow(flowByName('warehouse-role-reading'), ctx);
    expect(result.status).toBe('FAIL');
    expect(result.error).toMatch(/details timed out/);
    expect(off).toHaveBeenCalledTimes(1);
  });
});

describe('session-resume', () => {
  const MARKER = 'Start Disconnecting SPO_test3';
  const window = { url: 'http://logs/FIVEINTERFACESERVER/S.log', offset: 100, openedAt: '' };

  function driver(responder: (msg: WsMessage) => unknown = () => ({ type: WsMessageType.RESP_CHAT_USER_LIST, users: [{}, {}] })) {
    return {
      close: jest.fn(async () => undefined),
      log: [{ direction: 'sent' }, { direction: 'received' }],
      errors: [] as WsMessage[],
      send: jest.fn(),
      seen: jest.fn(() => []),
      request: jest.fn(async (msg: WsMessage) => responder(msg)),
    } as unknown as WsDriver;
  }

  const refusal = () => new WsDriverError('resume refused', 15, WsMessageType.REQ_RESUME_SESSION);

  interface Setup {
    snapshotCompany?: { id: string; name: string } | null;
    firstResume?: 'ok' | Error;
    secondResume?: 'refused' | 'accepted' | Error;
    read?: (msg: WsMessage) => unknown;
    gap?: string;
    after?: string | null;
  }

  function setup(over: Setup = {}) {
    const calls: string[] = [];
    const first = stubSession(() => undefined);
    (first.driver.close as jest.Mock).mockImplementation(async () => {
      calls.push('close');
    });
    const resumedDriver = driver(over.read);
    const thirdDriver = driver();
    const company = over.snapshotCompany === undefined ? first.company : over.snapshotCompany;

    jest.spyOn(session, 'login').mockResolvedValue(first);
    const off = jest.spyOn(session, 'logoff').mockImplementation(async () => {
      calls.push('logoff');
    });
    jest.spyOn(session, 'awaitResumeToken').mockResolvedValue('tok-1');
    let resumes = 0;
    const resume = jest.spyOn(session, 'resumeSession').mockImplementation(async () => {
      calls.push('resume');
      resumes += 1;
      if (resumes === 1) {
        const outcome = over.firstResume ?? 'ok';
        if (outcome instanceof Error) throw outcome;
        return {
          driver: resumedDriver,
          snapshot: { type: WsMessageType.RESP_RESUME_SESSION, company } as unknown as WsRespResumeSession,
        };
      }
      const outcome = over.secondResume ?? 'refused';
      if (outcome === 'refused') throw refusal();
      if (outcome instanceof Error) throw outcome;
      return {
        driver: thirdDriver,
        snapshot: { type: WsMessageType.RESP_RESUME_SESSION, company } as unknown as WsRespResumeSession,
      };
    });
    const find = jest.spyOn(liveLog, 'findCurrentSurvivalLog').mockResolvedValue(window.url);
    jest.spyOn(liveLog, 'openLogWindow').mockResolvedValue(window);
    jest.spyOn(liveLog, 'readSince').mockResolvedValue(over.gap ?? '12:00 - some other line\r\n');
    const marker = jest
      .spyOn(liveLog, 'awaitMarker')
      .mockResolvedValue(over.after === undefined ? `12:01 - ${MARKER}` : over.after);
    const sleep = jest.fn(async () => undefined);
    return { calls, first, resumedDriver, thirdDriver, off, resume, find, marker, sleep };
  }

  const run = (sleep: jest.Mock) => runFlow(flowByName('session-resume'), { ...ctx, sleep });
  const assertion = (r: FlowResult, what: RegExp) => r.assertions.find(a => what.test(a.what));

  it('is catalogued and changes no game state', () => {
    expect(flowByName('session-resume').mutates).toBe(false);
  });

  it('passes when the parked session resumes, answers, keeps its view and refuses the old token', async () => {
    const s = setup();
    const result = await run(s.sleep);

    expect(result.status).toBe('PASS');
    expect(s.calls).toEqual(['close', 'resume', 'resume', 'logoff']);
    expect(s.sleep).toHaveBeenCalledWith(20_000);
    expect(s.find.mock.calls[0][0]).toMatch(/\/FIVEINTERFACESERVER\/$/);
    expect(s.off).toHaveBeenCalledTimes(1);
    expect(s.off.mock.calls[0][0].driver).toBe(s.resumedDriver);
    expect(s.marker.mock.calls[0][1]).toBe(MARKER);
    expect(assertion(result, /no Interface Server teardown/)?.detail).toMatch(/bytes appended since the close, no "Start Disconnecting SPO_test3" line/);
    expect(assertion(result, /explicit logout tears/)?.detail).toBe(`12:01 - ${MARKER}`);
    expect(assertion(result, /read answers/)?.detail).toBe('2 user(s)');
    expect(assertion(result, /used token is refused/)?.ok).toBe(true);
  });

  it('fails when the resumed snapshot names another company', async () => {
    const s = setup({ snapshotCompany: { id: '9', name: 'Someone Else' } });
    const result = await run(s.sleep);
    expect(result.status).toBe('FAIL');
    expect(assertion(result, /names the same company/)?.ok).toBe(false);
  });

  it('fails when the resume is refused, and still logs off', async () => {
    const s = setup({ firstResume: refusal() });
    const result = await run(s.sleep);
    expect(result.status).toBe('FAIL');
    expect(assertion(result, /parked session resumes/)).toMatchObject({ ok: false, detail: 'resume refused' });
    expect(s.off).toHaveBeenCalledTimes(1);
    expect(s.off.mock.calls[0][0].driver).toBe(s.first.driver);
  });

  it('fails when the read does not answer on the resumed session', async () => {
    const s = setup({
      read: () => {
        throw new Error('read timed out');
      },
    });
    const result = await run(s.sleep);
    expect(result.status).toBe('FAIL');
    expect(assertion(result, /read answers/)).toMatchObject({ ok: false, detail: 'read timed out' });
  });

  it('fails when the read answers without a user list', async () => {
    const s = setup({ read: () => ({ type: WsMessageType.RESP_CHAT_USER_LIST }) });
    const result = await run(s.sleep);
    expect(result.status).toBe('FAIL');
    expect(assertion(result, /read answers/)).toMatchObject({ ok: false, detail: 'no user list' });
  });

  it('fails when the Interface Server logged a teardown between close and resume', async () => {
    const s = setup({ gap: `12:00 - other\r\n12:00 - ${MARKER}\r\n` });
    const result = await run(s.sleep);
    expect(result.status).toBe('FAIL');
    expect(assertion(result, /no Interface Server teardown/)).toMatchObject({ ok: false, detail: `12:00 - ${MARKER}` });
  });

  it('fails when the used token is accepted again, and logs off the socket that now holds the session', async () => {
    const s = setup({ secondResume: 'accepted' });
    const result = await run(s.sleep);
    expect(result.status).toBe('FAIL');
    expect(assertion(result, /used token is refused/)?.ok).toBe(false);
    expect(s.off.mock.calls[0][0].driver).toBe(s.thirdDriver);
  });

  it('fails when the used token is rejected for another reason than access denied', async () => {
    const s = setup({ secondResume: new WsDriverError('boom', 3, WsMessageType.REQ_RESUME_SESSION) });
    const result = await run(s.sleep);
    expect(result.status).toBe('FAIL');
    expect(assertion(result, /used token is refused/)).toMatchObject({ ok: false, detail: 'boom' });
  });

  it('fails when an explicit logout leaves no teardown line', async () => {
    const s = setup({ after: null });
    const result = await run(s.sleep);
    expect(result.status).toBe('FAIL');
    expect(assertion(result, /explicit logout tears/)).toMatchObject({ ok: false });
    expect(assertion(result, /explicit logout tears/)?.detail).toMatch(/no "Start Disconnecting SPO_test3" within/);
    expect(s.off).toHaveBeenCalledTimes(1);
  });
});

describe('world-readers', () => {
  const HELARTIA = { name: 'Helartia', iconUrl: '', mayor: null, population: 1, unemploymentPercent: 0, qualityOfLife: 0, x: 100, y: 50, path: '', classId: '' };
  type SurfaceReq = { x1: number; y1: number; x2: number; y2: number };
  const grid = (rows: number, cells: number) => Array.from({ length: rows }, () => new Array<number>(cells).fill(0));

  function arrange(over: {
    towns?: typeof HELARTIA[];
    statuses?: string[];
    event?: unknown;
    surface?: (r: SurfaceReq) => { width: number; height: number; rows: number[][] };
    dimensions?: Record<string, unknown>;
  } = {}) {
    const {
      towns = [HELARTIA],
      statuses = ['Helartia: 1000 inhabitants'],
      event = null,
      surface = (r: SurfaceReq) => ({ width: r.y2 - r.y1 + 1, height: r.x2 - r.x1 + 1, rows: grid(r.y2 - r.y1 + 1, r.x2 - r.x1 + 1) }),
      dimensions = { '5': { visualClass: '5' } },
    } = over;
    const requests: WsMessage[] = [];
    let statusReads = 0;
    const stub = { ...stubSession(msg => {
      requests.push(msg);
      switch (msg.type) {
        case WsMessageType.REQ_SEARCH_MENU_TOWNS:
          return { type: WsMessageType.RESP_SEARCH_MENU_TOWNS, towns };
        case WsMessageType.REQ_MAP_LOAD:
          return { type: WsMessageType.RESP_MAP_DATA, data: { buildings: [{ x: HELARTIA.x, y: HELARTIA.y, visualClass: '5' }] } };
        case WsMessageType.REQ_CONTEXT_STATUS:
          return { type: WsMessageType.RESP_CONTEXT_STATUS, text: statuses[Math.min(statusReads++, statuses.length - 1)] };
        case WsMessageType.REQ_WORLD_EVENT:
          return { type: WsMessageType.RESP_WORLD_EVENT, event };
        case WsMessageType.REQ_GET_SURFACE:
          return { type: WsMessageType.RESP_SURFACE_DATA, data: surface(msg as unknown as SurfaceReq) };
        case WsMessageType.REQ_GET_ALL_FACILITY_DIMENSIONS:
          return { type: WsMessageType.RESP_ALL_FACILITY_DIMENSIONS, dimensions, civicVisualClassIds: [] };
        default:
          return undefined;
      }
    }), playerX: 120, playerY: 80 };
    jest.spyOn(session, 'login').mockResolvedValue(stub);
    jest.spyOn(session, 'logoff').mockResolvedValue(undefined);
    const sleep = jest.fn(async (_ms: number) => undefined);
    const run = () => runFlow(flowByName('world-readers'), { ...ctx, sleep });
    return { requests, sleep, run, driver: stub.driver as unknown as { send: jest.Mock; request: jest.Mock } };
  }
  const detail = (r: FlowResult, what: RegExp) => r.assertions.find(a => what.test(a.what));

  it('is read-only', () => {
    expect(flowByName('world-readers').mutates).toBe(false);
  });

  it('PASSes, and a null world event passes with "no event queued"', async () => {
    const { run, requests, sleep } = arrange();
    const result = await run();
    expect(result.status).toBe('PASS');
    expect(detail(result, /context status at/)?.detail).toBe('1 read(s): Helartia: 1000 inhabitants');
    expect(sleep).not.toHaveBeenCalled();
    expect(detail(result, /world event/)).toMatchObject({ ok: true, detail: 'no event queued' });
    expect(requests.filter(m => m.type === WsMessageType.REQ_GET_SURFACE).map(m => (m as unknown as { surfaceType: string }).surfaceType))
      .toEqual(['ZONES', 'Beauty']);
    expect(detail(result, /ZONES surface/)?.detail).toBe('7 rows × 13 cells (expected 7 × 13)');
  });

  it('names the kind of a queued event', async () => {
    const { run } = arrange({ event: { date: '2026', kind: 3, text: 'A fire' } });
    const result = await run();
    expect(result.status).toBe('PASS');
    expect(detail(result, /world event/)?.detail).toBe('kind 3: A fire');
  });

  it('FAILs a malformed event', async () => {
    const { run } = arrange({ event: { date: 1, kind: 3, text: 'x' } });
    expect((await run()).status).toBe('FAIL');
  });

  it('FAILs a surface one row short', async () => {
    const { run } = arrange({ surface: r => ({ width: 0, height: 0, rows: grid(r.y2 - r.y1, r.x2 - r.x1 + 1) }) });
    const result = await run();
    expect(result.status).toBe('FAIL');
    expect(detail(result, /ZONES surface/)?.ok).toBe(false);
  });

  it('FAILs a surface whose rows are one cell short', async () => {
    const { run } = arrange({ surface: r => ({ width: 0, height: 0, rows: grid(r.y2 - r.y1 + 1, r.x2 - r.x1) }) });
    expect((await run()).status).toBe('FAIL');
  });

  it('FAILs a transposed grid on the non-square rectangle', async () => {
    const { run } = arrange({ surface: r => ({ width: 0, height: 0, rows: grid(r.x2 - r.x1 + 1, r.y2 - r.y1 + 1) }) });
    const result = await run();
    expect(result.status).toBe('FAIL');
    expect(detail(result, /Beauty surface/)?.detail).toBe('13 rows × 7 cells (expected 7 × 13)');
  });

  it('ignores the width/height labels of a correct grid', async () => {
    const { run } = arrange({ surface: r => ({ width: 999, height: 1, rows: grid(r.y2 - r.y1 + 1, r.x2 - r.x1 + 1) }) });
    expect((await run()).status).toBe('PASS');
  });

  it('re-reads an empty context status and PASSes on the third read', async () => {
    const { run, sleep, requests } = arrange({ statuses: ['', '', 'Helartia'] });
    const result = await run();
    expect(result.status).toBe('PASS');
    expect(detail(result, /context status/)?.detail).toBe('3 read(s): Helartia');
    expect(sleep.mock.calls).toEqual([[TIMEOUTS.contextStatusReread], [TIMEOUTS.contextStatusReread]]);
    // 3 bounded reads + the one after the camera update
    expect(requests.filter(m => m.type === WsMessageType.REQ_CONTEXT_STATUS)).toHaveLength(4);
  });

  it('FAILs when every context status read is empty', async () => {
    const { run, requests } = arrange({ statuses: [''] });
    const result = await run();
    expect(result.status).toBe('FAIL');
    expect(detail(result, /context status at/)).toMatchObject({ ok: false, detail: `${LIMITS.contextStatusMaxReads} read(s): ''` });
    expect(requests.filter(m => m.type === WsMessageType.REQ_CONTEXT_STATUS)).toHaveLength(LIMITS.contextStatusMaxReads + 1);
  });

  it('FAILs when the dimensions miss the town hall class', async () => {
    const { run } = arrange({ dimensions: { '9': {} } });
    const result = await run();
    expect(result.status).toBe('FAIL');
    expect(result.assertions.find(a => !a.ok)?.what).toMatch(/town hall class/);
  });

  it('FAILs empty dimensions', async () => {
    const { run } = arrange({ dimensions: {} });
    expect((await run()).status).toBe('FAIL');
  });

  it('sends the camera to the saved position with a view, then reads again', async () => {
    const { run, driver, requests } = arrange();
    await run();
    expect(driver.send).toHaveBeenCalledWith({
      type: WsMessageType.REQ_UPDATE_CAMERA, x: 120, y: 80, viewX: 104, viewY: 64, viewW: 32, viewH: 32,
    });
    const sendOrder = driver.send.mock.invocationCallOrder[0];
    const lastStatus = driver.request.mock.invocationCallOrder[driver.request.mock.calls.length - 1];
    expect(lastStatus).toBeGreaterThan(sendOrder);
    expect(requests[requests.length - 1].type).toBe(WsMessageType.REQ_CONTEXT_STATUS);
  });

  it('FAILs when the governed town is missing', async () => {
    const { run } = arrange({ towns: [] });
    const result = await run();
    expect(result.status).toBe('FAIL');
    expect(result.assertions.find(a => !a.ok)?.what).toMatch(/still listed/);
  });
});

describe('company-switch', () => {
  const HELARTIA = { name: 'Helartia', iconUrl: '', mayor: null, population: 1, unemploymentPercent: 0, qualityOfLife: 0, x: 100, y: 50, path: '', classId: '' };
  const OWN = { id: '1', name: 'SPO_test3 - Green' };
  const MINISTRY = { id: '9', name: 'Ministry', ownerRole: 'Minister of Agriculture' };
  const MAYOR = { id: '7', name: 'Helartia Town', ownerRole: 'Mayor of Helartia' };
  const rdoError = (msg: WsMessage) => new WsDriverError('refused', 42, msg.type);

  function arrange(over: {
    companies?: { id: string; name: string; ownerRole?: string }[];
    switchFails?: (n: number) => boolean;
    readFails?: (n: number) => boolean;
  } = {}) {
    const { companies = [OWN, MINISTRY, MAYOR], switchFails = () => false, readFails = () => false } = over;
    const requests: WsMessage[] = [];
    let switches = 0;
    let reads = 0;
    const stub = { ...stubSession(msg => {
      requests.push(msg);
      switch (msg.type) {
        case WsMessageType.REQ_SEARCH_MENU_TOWNS:
          return { type: WsMessageType.RESP_SEARCH_MENU_TOWNS, towns: [HELARTIA] };
        case WsMessageType.REQ_MAP_LOAD:
          return { type: WsMessageType.RESP_MAP_DATA, data: { buildings: [{ x: HELARTIA.x, y: HELARTIA.y, visualClass: '5' }] } };
        case WsMessageType.REQ_BUILDING_DETAILS:
          if (readFails(++reads)) throw new Error('read timed out');
          return { type: WsMessageType.RESP_BUILDING_DETAILS, details: { templateName: 'TownHall', tabs: [] } };
        case WsMessageType.REQ_SWITCH_COMPANY:
          if (switchFails(++switches)) throw rdoError(msg);
          return { type: WsMessageType.RESP_RDO_RESULT, result: '' };
        default:
          return undefined;
      }
    }), companies, company: OWN };
    jest.spyOn(session, 'login').mockResolvedValue(stub);
    const logoff = jest.spyOn(session, 'logoff').mockResolvedValue(undefined);
    const run = () => runFlow(flowByName('company-switch'), ctx);
    const switched = () => requests
      .filter(m => m.type === WsMessageType.REQ_SWITCH_COMPANY)
      .map(m => (m as unknown as { company: { id: string } }).company.id);
    const detailReads = () => requests.filter(m => m.type === WsMessageType.REQ_BUILDING_DETAILS).length;
    return { run, switched, detailReads, logoff };
  }

  it('is read-only and required', () => {
    expect(flowByName('company-switch').mutates).toBe(false);
    expect(NIGHTLY_ONLY).not.toHaveProperty('company-switch');
    expect(GATE_ONLY).not.toHaveProperty('company-switch');
  });

  it('PASSes: switches to the Mayor entry (not the Minister listed first), reads, switches back, reads', async () => {
    const { run, switched, detailReads, logoff } = arrange();
    const result = await run();
    expect(result.status).toBe('PASS');
    expect(switched()).toEqual(['7', '1']);
    expect(detailReads()).toBe(2);
    expect(logoff).toHaveBeenCalled();
  });

  it('matches the Mayor entry case-insensitively', async () => {
    const { run, switched } = arrange({ companies: [OWN, MINISTRY, { ...MAYOR, ownerRole: 'mayor of helartia' }] });
    expect((await run()).status).toBe('PASS');
    expect(switched()).toEqual(['7', '1']);
  });

  it('FAILs without switching when the list holds no Mayor entry, naming the entries', async () => {
    const { run, switched, logoff } = arrange({ companies: [OWN, MINISTRY] });
    const result = await run();
    expect(result.status).toBe('FAIL');
    expect(switched()).toEqual([]);
    expect(result.assertions[0].detail).toBe('SPO_test3 - Green [], Ministry [Minister of Agriculture]');
    expect(logoff).toHaveBeenCalled();
  });

  it('renders an empty list as (empty)', async () => {
    const { run } = arrange({ companies: [] });
    const result = await run();
    expect(result.status).toBe('FAIL');
    expect(result.assertions[0].detail).toBe('(empty)');
  });

  it('FAILs when the first switch answers RESP_ERROR, and still switches back', async () => {
    const { run, switched, detailReads, logoff } = arrange({ switchFails: n => n === 1 });
    const result = await run();
    expect(result.status).toBe('FAIL');
    expect(switched()).toEqual(['7', '1']);
    expect(detailReads()).toBe(1);
    expect(result.assertions.find(a => /switch to the role/.test(a.what))?.detail).toMatch(/^RESP_ERROR \(code 42\): refused/);
    expect(logoff).toHaveBeenCalled();
  });

  it('switches back even when the world read after the first switch throws', async () => {
    const { run, switched, logoff } = arrange({ readFails: n => n === 1 });
    const result = await run();
    expect(result.status).toBe('FAIL');
    expect(switched()).toEqual(['7', '1']);
    expect(result.assertions.find(a => /role ClientView/.test(a.what))).toMatchObject({ ok: false, detail: 'read timed out' });
    expect(logoff).toHaveBeenCalled();
  });

  it('FAILs when the switch back answers RESP_ERROR, sending no second read', async () => {
    const { run, detailReads } = arrange({ switchFails: n => n === 2 });
    const result = await run();
    expect(result.status).toBe('FAIL');
    expect(detailReads()).toBe(1);
    expect(result.assertions.find(a => /switch back/.test(a.what))?.ok).toBe(false);
  });
});

describe('cluster-info-read', () => {
  function arrange(over: { description?: string; categories?: { name: string; folder: string }[]; facilities?: unknown[] } = {}) {
    const {
      description = 'The Dissidents.',
      categories = [{ name: 'Farms', folder: '00000003.DissidentsFarms.five' }],
      facilities = [{ name: 'Farm' }],
    } = over;
    const requests: WsMessage[] = [];
    const stub = stubSession(msg => {
      requests.push(msg);
      switch (msg.type) {
        case WsMessageType.REQ_CLUSTER_INFO:
          return { type: WsMessageType.RESP_CLUSTER_INFO, clusterInfo: { id: 'Dissidents', displayName: 'D', description, categories } };
        case WsMessageType.REQ_CLUSTER_FACILITIES:
          return { type: WsMessageType.RESP_CLUSTER_FACILITIES, facilities };
        default:
          return undefined;
      }
    });
    jest.spyOn(session, 'login').mockResolvedValue(stub);
    const logoff = jest.spyOn(session, 'logoff').mockResolvedValue(undefined);
    return { requests, logoff, run: () => runFlow(flowByName('cluster-info-read'), ctx) };
  }

  it('is read-only', () => {
    expect(flowByName('cluster-info-read').mutates).toBe(false);
  });

  it('PASSes, reading the first cluster and its first category', async () => {
    const { run, requests, logoff } = arrange();
    expect((await run()).status).toBe('PASS');
    expect(requests.find(m => m.type === WsMessageType.REQ_CLUSTER_INFO)).toMatchObject({ clusterName: CLUSTER_IDS[0] });
    expect(requests.find(m => m.type === WsMessageType.REQ_CLUSTER_FACILITIES))
      .toMatchObject({ cluster: CLUSTER_IDS[0], folder: '00000003.DissidentsFarms.five' });
    expect(logoff).toHaveBeenCalled();
  });

  it('FAILs on an empty description', async () => {
    const { run } = arrange({ description: '  ' });
    expect((await run()).status).toBe('FAIL');
  });

  it('FAILs on an empty facility list', async () => {
    const { run } = arrange({ facilities: [] });
    expect((await run()).status).toBe('FAIL');
  });

  it('FAILs without a facility request when no category is listed', async () => {
    const { run, requests } = arrange({ categories: [] });
    const result = await run();
    expect(result.status).toBe('FAIL');
    expect(result.assertions.find(a => /facility category/.test(a.what))?.detail).toBe('0 categories');
    expect(requests.some(m => m.type === WsMessageType.REQ_CLUSTER_FACILITIES)).toBe(false);
  });
});
