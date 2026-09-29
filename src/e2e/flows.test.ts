import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WsMessageType } from '@/shared/types/message-types';
import type { WsMessage, FavoritesItem, WsRespResumeSession } from '@/shared/types/message-types';
import type {
  BuildingConnectionData, BuildingProductData, BuildingPropertyValue, BuildingSupplyData, MailMessageFull,
  MailMessageHeader, NewspaperBoard,
} from '@/shared/types/domain-types';
import {
  FLOWS, flowByName, nudge, runFlow, readBank, readAutoConnections, readPolicy, readCurriculum, replyHeaders,
  otherPublicityLevel, publicityLogMatches, taxLogMatches, circuitLogMatches, zoneLogMatches,
  loanDelta, newLoan, receiverLimitRefusal, pictureCheck, testPortraitJpeg, portraitUrl, PROFILE_LEVEL_NAMES,
  nudgeWithin, evenPriceNudge, roundHalfEven, servicePriceQuantised, facLineMatches, servicePriceLineMatches,
  salariesLineMatches, clientLinksDiff, outputPriceRefusal, stoppedBit, workerCountsProblem, refreshMissingKeys,
  fixtureKind,
  type Flow, type FlowResult,
} from './flows';
import { buildReplyHeaders } from '@/client/store/mail-store';
import { validatePicture } from '@/server/session/picture-transfer';
import type { LoanInfo, TycoonProfileFull } from '@/shared/types/domain-types';
import { ROUTES, NIGHTLY_ONLY, GATE_ONLY } from './routing';
import { CLUSTER_IDS } from '@/shared/cluster-data';
import { WorldLock, WorldDirtyError } from './world-lock';
import { WsDriver, WsDriverError } from './ws-driver';
import * as session from './session';
import * as probeModule from './probe';
import * as liveLog from './live-log';
import * as fixtures from './fixtures';
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
      [
        'autoconnection-roundtrip', 'bank-borrow-payoff', 'bank-send-return', 'facility-open-close',
        'favorites-folders', 'favorites-roundtrip', 'fixtures-ensure', 'industry-auto-buy', 'industry-output-price',
        'industry-supply-limits', 'mail-drafts', 'mail-reply', 'mail-roundtrip', 'mail-send-from-draft',
        'policy-roundtrip', 'politics-write', 'portrait-roundtrip', 'publicity-roundtrip',
        'road-roundtrip', 'store-price-salaries', 'town-min-wage', 'vote-roundtrip', 'zone-roundtrip', 'zoning-alert-read',
      ],
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

  function politicsPayload(mayorName: string, ratings: number) {
    jest.spyOn(session, 'login').mockResolvedValue(
      stubSession(msg =>
        msg.type === WsMessageType.REQ_POLITICS_DATA
          ? {
              type: WsMessageType.RESP_POLITICS_DATA,
              data: {
                mayorName,
                popularRatings: Array.from({ length: ratings }, (_, i) => ({ name: `r${i}`, value: 50 })),
                ifelRatings: [],
                tycoonsRatings: [],
              },
            }
          : undefined,
      ),
    );
    jest.spyOn(session, 'logoff').mockResolvedValue(undefined);
    jest.spyOn(session, 'findTown').mockResolvedValue(helartia);
  }

  it.each(['Mayor of Helartia', 'spo_test3', 'SPO_test3'])("accepts %s as SPO_test3's office", async name => {
    politicsPayload(name, 2);
    const result = await flowByName('politics-read').run(ctx);
    expect(result.status).toBe('PASS');
  });

  it('fails when the ruler is someone else', async () => {
    politicsPayload('Crazz', 2);
    const result = await flowByName('politics-read').run(ctx);
    expect(result.status).toBe('FAIL');
    expect(result.assertions.find(a => !a.ok)).toMatchObject({ what: "mayorName names SPO_test3's office", detail: 'Crazz' });
  });

  it('fails when no rating is listed', async () => {
    politicsPayload('SPO_test3', 0);
    const result = await flowByName('politics-read').run(ctx);
    expect(result.status).toBe('FAIL');
    expect(result.assertions.find(a => !a.ok)?.what).toBe('ratings are listed');
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
    expect(result.probes).toHaveLength(2);
    const spec = runProbe.mock.calls[0][1];
    expect(spec).toMatchObject({
      x: 100,
      y: 200,
      visualClass: '7010',
      writeProperty: 'RDOSetTaxValue',
      additionalParams: { index: '0' },
    });
    expect(spec.testValue('7')).toBe('8');
    const subsidy = runProbe.mock.calls[1][1];
    expect(subsidy).toMatchObject({ original: '7', writeProperty: 'RDOSetTaxValue', additionalParams: { index: '0' } });
    expect(subsidy.testValue('7')).toBe('-10');
  });

  it('does not attempt the subsidy when the rate probe did not restore', async () => {
    governedTownHall(true, '7');
    jest.spyOn(liveLog, 'findCurrentSurvivalLog').mockResolvedValue('http://logs/S.log');
    const runProbe = jest
      .spyOn(probeModule, 'runProbe')
      .mockResolvedValue({ ...passingProbe, status: 'FAIL', restored: false });

    const result = await flowByName('politics-write').run(ctx);

    expect(runProbe).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('FAIL');
    expect(result.unproven.join()).toMatch(/subsidy probe — not attempted/);
  });

  it('records a subsidy probe that threw', async () => {
    governedTownHall(true, '7');
    jest.spyOn(liveLog, 'findCurrentSurvivalLog').mockResolvedValue('http://logs/S.log');
    jest
      .spyOn(probeModule, 'runProbe')
      .mockResolvedValueOnce(passingProbe)
      .mockRejectedValueOnce(new Error('socket died'));

    const result = await flowByName('politics-write').run(ctx);

    expect(result.status).toBe('FAIL');
    expect(result.probes[1]).toMatchObject({ what: 'Helartia tax row 0 subsidy', status: 'FAIL', note: 'socket died' });
  });

  it("restores the subsidy to the rate probe's original even when the cache still shows the test value", async () => {
    governedTownHall(true, '7');
    // The flow's own read, then the rate probe (original, poll, restore poll), then a stale
    // '8' the facility cache still serves — then whatever was written last.
    const scripted = ['7', '7', '8', '7', '8'];
    let last = '7';
    jest.spyOn(session, 'readSectionGroups').mockImplementation(async () => ({
      townTaxes: [
        { name: 'Tax0Id', value: '3' },
        { name: 'Tax0Percent', value: scripted.length > 0 ? (scripted.shift() as string) : last },
      ],
    }));
    const writes: string[] = [];
    jest.spyOn(session, 'setBuildingProperty').mockImplementation(async (_s, _x, _y, _p, value) => {
      writes.push(value);
      last = value;
      return { type: WsMessageType.RESP_BUILDING_SET_PROPERTY, success: true, newValue: value } as never;
    });
    jest.spyOn(liveLog, 'openLogWindow').mockResolvedValue({ url: 'u', offset: 0, openedAt: 'now' });
    jest.spyOn(liveLog, 'awaitMarker').mockImplementation(async (_w, proof) => {
      const line = `12:00:00 Setting Tax value: Helartia, 3, ${last}`;
      return typeof proof === 'object' && (proof.match?.(line) ?? true) ? line : null;
    });
    const lock = cleanLock();

    const result = await flowByName('politics-write').run({
      lock,
      survivalLogUrl: 'u',
      now: () => 0,
      sleep: async () => undefined,
    });

    expect(writes).toEqual(['8', '7', '-10', '7']);
    expect(result.probes.map(p => p.status)).toEqual(['PASS', 'PASS']);
    expect(result.status).toBe('PASS');
    expect(lock.read().pendingRestores).toEqual([]);
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

describe('taxLogMatches', () => {
  it('requires the town, the TaxId and the value when the TaxId is known', () => {
    expect(taxLogMatches('1:00 Setting Tax value: Helartia, 3, -10', 'Helartia', '3', '-10')).toBe(true);
    expect(taxLogMatches('1:00 Setting Tax value: Helartia, 4, -10', 'Helartia', '3', '-10')).toBe(false);
    expect(taxLogMatches('1:00 Setting Tax value: Helartia, 3, -100', 'Helartia', '3', '-10')).toBe(false);
  });

  it('requires the town and the value when the TaxId is unknown', () => {
    expect(taxLogMatches('1:00 Setting Tax value: Helartia, 9, -10', 'Helartia', undefined, '-10')).toBe(true);
    expect(taxLogMatches('1:00 Setting Tax value: Other, 9, -10', 'Helartia', undefined, '-10')).toBe(false);
    expect(taxLogMatches('1:00 Setting Tax value: Helartia, 9, 7', 'Helartia', undefined, '-10')).toBe(false);
  });
});

/** Time that jumps past any read-back bound on every look, and a sleep that returns at once. */
function fastClock(): { now: () => number; sleep: () => Promise<void> } {
  let t = 0;
  return { now: () => (t += 1_000_000_000), sleep: async () => undefined };
}

const logWindow = { url: 'u', offset: 0, openedAt: 'now' };

describe('town-min-wage', () => {
  /** A town hall whose `hiMinSalary` is `wage`; `apply` decides whether a write moves it. */
  function minWageHall(opts: {
    canGovern?: boolean;
    wage?: string;
    apply?: (value: string, call: number) => boolean;
    failWrite?: number;
    logLine?: (written: string) => string | null;
  }) {
    governedTownHall(opts.canGovern ?? true, undefined);
    let wage = opts.wage;
    jest.spyOn(session, 'readSectionGroups').mockImplementation(async () =>
      wage === undefined ? {} : { townJobs: [{ name: 'hiMinSalary', value: wage }] },
    );
    const writes: { value: string; params?: Record<string, string>; property: string }[] = [];
    jest.spyOn(session, 'setBuildingProperty').mockImplementation(async (_s, _x, _y, property, value, params) => {
      writes.push({ value, params, property });
      if (opts.failWrite === writes.length) throw new Error('write rejected');
      if (opts.apply?.(value, writes.length) ?? true) wage = value;
      return { type: WsMessageType.RESP_BUILDING_SET_PROPERTY, success: true, newValue: value } as never;
    });
    jest.spyOn(liveLog, 'openLogWindow').mockResolvedValue(logWindow);
    jest.spyOn(liveLog, 'awaitMarker').mockImplementation(async (_w, proof) => {
      const line = opts.logLine ? opts.logLine(wage ?? '') : `12:00:00 Setting Min Wage: Helartia, 0, ${wage ?? ''}`;
      if (line === null) return null;
      return typeof proof === 'object' && (proof.match?.(line) ?? true) ? line : null;
    });
    return writes;
  }

  const run = (lock = cleanLock()) =>
    flowByName('town-min-wage').run({ lock, survivalLogUrl: 'u', ...fastClock() });

  it('drives kind 0 of the town hall and passes on the log line and the read-back', async () => {
    const writes = minWageHall({ wage: '40' });
    const lock = cleanLock();
    const result = await run(lock);
    expect(result.status).toBe('PASS');
    expect(writes).toEqual([
      { value: '41', params: { levelIndex: '0' }, property: 'RDOSetMinSalaryValue' },
      { value: '40', params: { levelIndex: '0' }, property: 'RDOSetMinSalaryValue' },
    ]);
    expect(lock.read().pendingRestores).toEqual([]);
  });

  it('passes the nudge and a log match on town, kind and value to the probe', async () => {
    governedTownHall(true, undefined);
    jest.spyOn(session, 'readSectionGroups').mockResolvedValue({ townJobs: [{ name: 'hiMinSalary', value: '40' }] });
    const runProbe = jest.spyOn(probeModule, 'runProbe').mockRejectedValue(new Error('socket died'));
    const result = await run();
    expect(result.status).toBe('FAIL');
    expect(result.probes[0].note).toBe('socket died');
    const spec = runProbe.mock.calls[0][1];
    expect(spec).toMatchObject({ groupId: 'townJobs', readProperty: 'hiMinSalary', additionalParams: { levelIndex: '0' } });
    expect(spec.testValue('40')).toBe(nudge('40'));
    const match = spec.logMatch as (line: string, written: string) => boolean;
    expect(match('1:00 Setting Min Wage: Helartia, 0, 8', '8')).toBe(true);
    expect(match('1:00 Setting Min Wage: Other, 0, 8', '8')).toBe(false);
    expect(match('1:00 Setting Min Wage: Helartia, 1, 8', '8')).toBe(false);
    expect(match('1:00 Setting Min Wage: Helartia, 0, 9', '8')).toBe(false);
  });

  it('writes nothing when the account cannot govern the town hall', async () => {
    const writes = minWageHall({ canGovern: false, wage: '40' });
    const result = await run();
    expect(result.status).toBe('FAIL');
    expect(writes).toEqual([]);
  });

  it('writes nothing when the minimum wage is unreadable', async () => {
    const writes = minWageHall({ wage: undefined });
    const result = await run();
    expect(result.status).toBe('FAIL');
    expect(writes).toEqual([]);
  });

  it('fails a log line with no matching read-back, and still restores', async () => {
    // The line is there, but the value never moves.
    const writes = minWageHall({ wage: '40', apply: () => false, logLine: () => '1:00 Setting Min Wage: Helartia, 0, 41' });
    const result = await run();
    expect(result.status).toBe('FAIL');
    expect(result.probes[0].note).toMatch(/read-back never showed "41"/);
    expect(writes.map(w => w.value)).toEqual(['41', '40']);
  });

  it('restores after a failed write', async () => {
    const writes = minWageHall({ wage: '40', failWrite: 1 });
    const result = await run();
    expect(result.status).toBe('FAIL');
    expect(writes.map(w => w.value)).toEqual(['41', '40']);
    expect(result.probes[0].restored).toBe(true);
  });

  it('restores after a failed proof (no log line)', async () => {
    const writes = minWageHall({ wage: '40', logLine: () => null });
    const result = await run();
    expect(result.status).toBe('FAIL');
    expect(result.probes[0].note).toMatch(/no model-server log line/);
    expect(writes.map(w => w.value)).toEqual(['41', '40']);
  });
});

describe('publicity-roundtrip', () => {
  it('writes another multiple of 25 in 0..100 for every level the client emits', () => {
    for (const original of ['0', '25', '50', '75', '100']) {
      const next = otherPublicityLevel(original);
      expect(next).not.toBe(original);
      expect([0, 25, 50, 75, 100]).toContain(Number(next));
    }
  });

  it.each(['30', '', 'abc', '125', '-25'])('refuses to pick a level from "%s"', original => {
    expect(() => otherPublicityLevel(original)).toThrow(/not one of 0\/25\/50\/75\/100/);
  });

  it('matches only the line carrying the RatingId and the value', () => {
    expect(publicityLogMatches('1:00 Setting town politics publicity: 5, 25', '5', '25')).toBe(true);
    expect(publicityLogMatches('1:00 Setting town politics publicity: 6, 25', '5', '25')).toBe(false);
    expect(publicityLogMatches('1:00 Setting town politics publicity: 15, 25', '5', '25')).toBe(false);
    expect(publicityLogMatches('1:00 Setting town politics publicity: 5, 50', '5', '25')).toBe(false);
  });

  function publicityHall(opts: {
    rows?: { id: string; name: string; level: number }[];
    refuse?: number;
    logRatingId?: string;
  }) {
    const rows = opts.rows ?? [{ id: '5', name: 'Education', level: 50 }];
    const writes: { ratingId: string; value: number }[] = [];
    jest.spyOn(session, 'login').mockResolvedValue(
      stubSession(msg => {
        if (msg.type === WsMessageType.REQ_POLITICS_DATA) {
          return { type: WsMessageType.RESP_POLITICS_DATA, data: { publicity: rows.map(r => ({ ...r })) } };
        }
        if (msg.type === WsMessageType.REQ_POLITICS_SET_PUBLICITY) {
          const m = msg as unknown as { ratingId: string; value: number };
          writes.push({ ratingId: m.ratingId, value: m.value });
          if (opts.refuse === writes.length) {
            return { type: WsMessageType.RESP_POLITICS_SET_PUBLICITY, success: false, message: 'no' };
          }
          const row = rows.find(r => r.id === m.ratingId);
          if (row) row.level = m.value;
          return { type: WsMessageType.RESP_POLITICS_SET_PUBLICITY, success: true };
        }
        return undefined;
      }),
    );
    jest.spyOn(session, 'logoff').mockResolvedValue(undefined);
    jest.spyOn(session, 'findTown').mockResolvedValue(helartia);
    jest.spyOn(liveLog, 'openLogWindow').mockResolvedValue(logWindow);
    jest.spyOn(liveLog, 'awaitMarker').mockImplementation(async (_w, proof) => {
      const last = writes[writes.length - 1];
      const line = `12:00:00 Setting town politics publicity: ${opts.logRatingId ?? last?.ratingId}, ${last?.value}`;
      return typeof proof === 'object' && (proof.match?.(line) ?? true) ? line : null;
    });
    return writes;
  }

  const run = (lock = cleanLock()) =>
    flowByName('publicity-roundtrip').run({ lock, survivalLogUrl: 'u', ...fastClock() });

  it('writes another level, proves it, and restores the original', async () => {
    const writes = publicityHall({});
    const lock = cleanLock();
    const result = await run(lock);
    expect(result.status).toBe('PASS');
    expect(writes).toEqual([
      { ratingId: '5', value: 25 },
      { ratingId: '5', value: 50 },
    ]);
    expect(lock.read().pendingRestores).toEqual([]);
  });

  it('fails a line that carries another RatingId, and still restores', async () => {
    const writes = publicityHall({ logRatingId: '6' });
    const result = await run();
    expect(result.status).toBe('FAIL');
    expect(result.probes[0].note).toMatch(/no model-server log line/);
    expect(writes.map(w => w.value)).toEqual([25, 50]);
  });

  it('fails a refused write, and still writes the restore', async () => {
    const writes = publicityHall({ refuse: 1 });
    const result = await run();
    expect(result.status).toBe('FAIL');
    expect(result.probes[0].note).toMatch(/SET_PUBLICITY refused/);
    expect(writes.map(w => w.value)).toEqual([25, 50]);
  });

  it('writes nothing when the original is not a level the client emits', async () => {
    const lock = cleanLock();
    const writes = publicityHall({ rows: [{ id: '5', name: 'Education', level: 30 }] });
    const result = await run(lock);
    expect(result.status).toBe('FAIL');
    expect(writes).toEqual([]);
    expect(lock.read().pendingRestores).toEqual([]);
  });

  it('fails when no publicity row is listed', async () => {
    const writes = publicityHall({ rows: [] });
    const result = await run();
    expect(result.status).toBe('FAIL');
    expect(result.assertions[0]).toMatchObject({ what: 'a publicity row is listed', ok: false });
    expect(writes).toEqual([]);
  });
});

describe('vote-roundtrip', () => {
  function voteHall(opts: {
    prior?: string;
    candidates?: string[];
    mayor?: string;
    /** Whether the server applies the n-th vote (1-based). */
    apply?: (call: number) => boolean;
    /** Whether the n-th vote prints its log line. */
    logs?: (call: number) => boolean;
  }) {
    let current = opts.prior;
    const votes: string[] = [];
    const lines: string[] = [];
    jest.spyOn(session, 'login').mockResolvedValue(
      stubSession(msg => {
        if (msg.type === WsMessageType.REQ_POLITICS_DATA) {
          return {
            type: WsMessageType.RESP_POLITICS_DATA,
            data: {
              mayorName: opts.mayor ?? 'SPO_test3',
              campaigns: (opts.candidates ?? []).map(candidateName => ({ candidateName, rating: 0, prestige: 0, photoUrl: '' })),
            },
          };
        }
        if (msg.type === WsMessageType.REQ_POLITICS_VOTE) {
          const choice = (msg as unknown as { candidateName: string }).candidateName;
          votes.push(choice);
          if (opts.logs?.(votes.length) ?? true) lines.push(`1/1/2026 12:00:00 Voting: SPO_test3 by ${choice}`);
          if (opts.apply?.(votes.length) ?? true) current = choice;
          return { type: WsMessageType.RESP_POLITICS_VOTE, success: true };
        }
        return undefined;
      }),
    );
    jest.spyOn(session, 'logoff').mockResolvedValue(undefined);
    jest.spyOn(session, 'findTown').mockResolvedValue(helartia);
    jest.spyOn(session, 'resolveVisualClass').mockResolvedValue('7010');
    jest.spyOn(session, 'readSectionGroups').mockImplementation(async () => ({
      votes: current === undefined ? [] : [{ name: 'VoteOf', value: current }],
    }));
    jest.spyOn(liveLog, 'openLogWindow').mockResolvedValue(logWindow);
    jest.spyOn(liveLog, 'awaitMarker').mockImplementation(
      async (_w, proof) => lines.find(l => typeof proof === 'object' && (proof.match?.(l) ?? true)) ?? null,
    );
    return votes;
  }

  const run = (lock = cleanLock()) => flowByName('vote-roundtrip').run({ lock, survivalLogUrl: 'u', ...fastClock() });

  it('votes for another candidate, then re-votes the prior choice', async () => {
    const votes = voteHall({ prior: 'Alice', candidates: ['Alice', 'Bob'] });
    const lock = cleanLock();
    const result = await run(lock);
    expect(result.status).toBe('PASS');
    expect(votes).toEqual(['Bob', 'Alice']);
    expect(result.assertions.find(a => a.what === 'the restore vote reached the object')?.ok).toBe(true);
    expect(lock.read().pendingRestores).toEqual([]);
  });

  it('accepts the current mayor as the prior choice, compared case-insensitively', async () => {
    const votes = voteHall({ prior: 'spo_test3', candidates: ['Bob'], mayor: 'SPO_test3' });
    const result = await run();
    expect(result.status).toBe('PASS');
    expect(votes).toEqual(['Bob', 'spo_test3']);
  });

  it('never votes without a prior vote', async () => {
    const votes = voteHall({ prior: undefined, candidates: ['Alice', 'Bob'] });
    const result = await run();
    expect(result.status).toBe('UNPROVEN');
    expect(result.unproven[0]).toMatch(/no readable prior vote.*CurrBlock/);
    expect(votes).toEqual([]);
  });

  it('never votes when the prior is stale — no campaign now and not the mayor', async () => {
    const votes = voteHall({ prior: 'Carol', candidates: ['Alice', 'Bob'], mayor: 'SPO_test3' });
    const result = await run();
    expect(result.status).toBe('UNPROVEN');
    expect(result.unproven[0]).toMatch(/stale prior vote "Carol"/);
    expect(votes).toEqual([]);
  });

  it('never votes when no other candidate exists', async () => {
    const votes = voteHall({ prior: 'SPO_test3', candidates: [], mayor: 'SPO_test3' });
    const result = await run();
    expect(result.status).toBe('UNPROVEN');
    expect(result.unproven[0]).toMatch(/no other candidate/);
    expect(votes).toEqual([]);
  });

  it('fails when RDOVoteOf still shows the prior after the change vote, and still re-votes', async () => {
    const votes = voteHall({ prior: 'Alice', candidates: ['Alice', 'Bob'], apply: () => false });
    const result = await run();
    expect(result.status).toBe('FAIL');
    expect(result.probes[0].note).toMatch(/read-back never showed "Bob"/);
    expect(votes).toEqual(['Bob', 'Alice']);
  });

  it('fails when the restore vote prints no log line', async () => {
    const votes = voteHall({ prior: 'Alice', candidates: ['Alice', 'Bob'], logs: call => call === 1 });
    const result = await run();
    expect(result.status).toBe('FAIL');
    expect(result.assertions.find(a => a.what === 'the restore vote reached the object')?.ok).toBe(false);
    expect(votes).toEqual(['Bob', 'Alice']);
  });

  it('fails when the change vote prints no log line', async () => {
    voteHall({ prior: 'Alice', candidates: ['Alice', 'Bob'], logs: () => false });
    const result = await run();
    expect(result.status).toBe('FAIL');
    expect(result.probes[0].note).toMatch(/no model-server log line/);
  });

  it('records a round trip that threw', async () => {
    voteHall({ prior: 'Alice', candidates: ['Alice', 'Bob'] });
    jest.spyOn(liveLog, 'openLogWindow').mockRejectedValue(new Error('log host vanished'));
    const result = await run();
    expect(result.status).toBe('FAIL');
    expect(result.probes[0]).toMatchObject({ member: 'RDOVote', note: 'log host vanished' });
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

describe('newspaper-board-read', () => {
  const TOWN = {
    name: 'Helartia', iconUrl: '', mayor: 'SPO_test3', population: 0,
    unemploymentPercent: 0, qualityOfLife: 0, x: 1, y: 2, path: '', classId: '512',
  };
  const ROOT = 'boards\\Planitia\\Helartia Herald\\';
  const COLUMN = { author: 'Crazz', subject: 'Hello', path: ROOT + '1\\', summary: '' };

  function arrange(over: { paper?: string; board?: Partial<NewspaperBoard> } = {}) {
    const { paper = 'Helartia Herald' } = over;
    const board: NewspaperBoard = {
      paperName: paper, root: ROOT, path: ROOT, columns: [], tree: [], article: null, error: '',
      ...over.board,
    };
    const requests: WsMessage[] = [];
    jest.spyOn(session, 'login').mockResolvedValue(stubSession((msg) => {
      requests.push(msg);
      if (msg.type === WsMessageType.REQ_NEWSPAPER_BOARD) return { board };
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

  const wellFormed = (r: { assertions: { what: string; detail?: string }[] }) =>
    r.assertions.find(a => /well-formed/.test(a.what));

  it('passes on an empty board, its detail naming both counts', async () => {
    arrange();
    const result = await flowByName('newspaper-board-read').run(ctx);
    expect(result.status).toBe('PASS');
    expect(wellFormed(result)?.detail).toBe('0 columns, 0 tree entries');
  });

  it('passes on a populated board and counts it', async () => {
    arrange({ board: {
      columns: [COLUMN],
      tree: [{ ...COLUMN, depth: 0 }, { ...COLUMN, path: ROOT + '1\\2\\', depth: 1 }],
    } });
    const result = await flowByName('newspaper-board-read').run(ctx);
    expect(result.status).toBe('PASS');
    expect(wellFormed(result)?.detail).toBe('1 columns, 2 tree entries');
  });

  it('fails when the board answers with an error', async () => {
    arrange({ board: { error: 'The newspaper answered HTTP 500.' } });
    const result = await flowByName('newspaper-board-read').run(ctx);
    expect(result.status).toBe('FAIL');
    const failed = result.assertions.find(a => !a.ok);
    expect(failed?.what).toMatch(/columns board was read/);
    expect(failed?.detail).toBe('The newspaper answered HTTP 500.');
  });

  it('fails when a column has no path', async () => {
    arrange({ board: { columns: [{ ...COLUMN, path: '' }] } });
    const result = await flowByName('newspaper-board-read').run(ctx);
    expect(result.status).toBe('FAIL');
    expect(result.assertions.find(a => !a.ok)?.what).toMatch(/well-formed/);
  });

  it('fails when a tree entry has no path', async () => {
    arrange({ board: { tree: [{ ...COLUMN, path: '', depth: 0 }] } });
    const result = await flowByName('newspaper-board-read').run(ctx);
    expect(result.status).toBe('FAIL');
    expect(result.assertions.find(a => !a.ok)?.what).toMatch(/well-formed/);
  });

  it('fails, and asks for no board, when the town hall names no paper', async () => {
    const requests = arrange({ paper: '' });
    const result = await flowByName('newspaper-board-read').run(ctx);
    expect(result.status).toBe('FAIL');
    expect(result.assertions.find(a => !a.ok)?.what).toMatch(/names its paper/);
    expect(requests.some(m => m.type === WsMessageType.REQ_NEWSPAPER_BOARD)).toBe(false);
  });

  it('asks for the index of the paper the town hall named', async () => {
    const requests = arrange();
    await flowByName('newspaper-board-read').run(ctx);
    const req = requests.find(m => m.type === WsMessageType.REQ_NEWSPAPER_BOARD);
    expect(req).toMatchObject({
      paperName: 'Helartia Herald', townName: 'Helartia', isCapitol: false, buildingX: 1, buildingY: 2,
    });
    expect((req as { path?: string }).path).toBeUndefined();
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

describe('fixtures-ensure', () => {
  function arrange(outcomes: fixtures.FixtureOutcome[]) {
    const stub = stubSession(() => undefined);
    jest.spyOn(session, 'login').mockResolvedValue(stub);
    const off = jest.spyOn(session, 'logoff').mockResolvedValue(undefined);
    const ensure = jest.spyOn(fixtures, 'ensureFixtures').mockResolvedValue(outcomes);
    return { off, ensure, stub };
  }

  it('is mutating and nightly-only', () => {
    expect(flowByName('fixtures-ensure').mutates).toBe(true);
  });

  it('PASSes on found and built kinds, and carries the outcomes into the artifact', async () => {
    const outcomes: fixtures.FixtureOutcome[] = [
      { kind: 'industry', status: 'found', x: 1, y: 2, visualClass: '4116' },
      { kind: 'store', status: 'built', x: 3, y: 4, visualClass: '4601', facilityClass: 'PGIFoodStore', logLine: 'New Facility: PGIFoodStore Company: 1 x: 3 y: 4' },
    ];
    const { off, ensure, stub } = arrange(outcomes);
    const result = await flowByName('fixtures-ensure').run({ ...ctx, survivalLogUrl: 'log' });
    expect(result.status).toBe('PASS');
    expect(result.fixtures).toEqual(outcomes);
    expect(result.assertions.map(a => a.what)).toEqual(['industry: fixture found', 'store: fixture built']);
    expect(result.assertions[1].detail).toMatch(/New Facility: PGIFoodStore/);
    expect(ensure).toHaveBeenCalledWith(stub, expect.objectContaining({ survivalLogUrl: 'log' }));
    expect(off).toHaveBeenCalledTimes(1);
  });

  it('is UNPROVEN on an unproven or under-construction kind', async () => {
    arrange([
      { kind: 'bank', status: 'unproven', reason: 'no candidate offered to SPO_test3 - Green' },
      { kind: 'tv', status: 'under construction', reason: 'site' },
    ]);
    const result = await flowByName('fixtures-ensure').run(ctx);
    expect(result.status).toBe('UNPROVEN');
    expect(result.unproven).toEqual([
      'bank fixture — no candidate offered to SPO_test3 - Green',
      'tv fixture — under construction — site',
    ]);
  });

  it('FAILs a found fixture with no lot, and a built one with no New Facility: line', async () => {
    arrange([
      { kind: 'industry', status: 'found' },
      { kind: 'store', status: 'built', x: 3, y: 4 },
    ]);
    const result = await flowByName('fixtures-ensure').run(ctx);
    expect(result.status).toBe('FAIL');
    expect(result.assertions.map(a => a.ok)).toEqual([false, false]);
  });

  it('FAILs on a FAIL outcome and still logs off', async () => {
    const { off } = arrange([{ kind: 'warehouse', status: 'FAIL', reason: 'NewFacility answered 3' }]);
    const result = await flowByName('fixtures-ensure').run(ctx);
    expect(result.status).toBe('FAIL');
    expect(result.assertions).toEqual([{ what: 'warehouse fixture', ok: false, detail: 'NewFacility answered 3' }]);
    expect(off).toHaveBeenCalledTimes(1);
  });

  it('logs off when ensureFixtures throws', async () => {
    const { off, ensure } = arrange([]);
    ensure.mockRejectedValue(new Error('terrain: BMP 404'));
    await expect(flowByName('fixtures-ensure').run(ctx)).rejects.toThrow('terrain');
    expect(off).toHaveBeenCalledTimes(1);
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

describe('profile-read', () => {
  const T = WsMessageType;
  const tree = (children: unknown[]) => ({ root: { label: 'Net', level: 0, amount: '0', children } });
  type Pages = Record<string, unknown>;
  const healthy = (): Pages => ({
    [T.REQ_GET_PROFILE]: { profile: { name: 'SPO_test3', levelName: 'Apprentice' } },
    [T.REQ_PROFILE_CURRICULUM]: { data: { currentLevel: 0, currentLevelName: 'Apprentice' } },
    [T.REQ_PROFILE_BANK]: { data: { balance: '1000' } },
    [T.REQ_PROFILE_PROFITLOSS]: { data: tree([{ label: 'Sales', level: 1, amount: '5' }]) },
    [T.REQ_PROFILE_COMPANIES]: {
      data: { companies: [{ name: 'SPO_test3 - Green', cluster: 'PGI', companyId: 1 }], currentCompany: '', worldName: 'planitia' },
    },
    [T.REQ_PROFILE_COMPANY_PROFITLOSS]: { companyName: 'SPO_test3 - Green', data: tree([{ label: 'Sales', level: 1, amount: '5' }]) },
    [T.REQ_PROFILE_AUTOCONNECTIONS]: { data: { fluids: [{ fluidId: 'Food', fluidName: 'Food', suppliers: [] }] } },
    [T.REQ_PROFILE_POLICY]: { data: { policies: [{ tycoonName: 'Crazz', yourPolicy: 1, theirPolicy: 1 }], alliesAllowed: true } },
  });

  function arrange(over: Pages = {}) {
    const pages = { ...healthy(), ...over };
    const sent: Record<string, unknown>[] = [];
    jest.spyOn(session, 'login').mockResolvedValue(stubSession((msg) => {
      sent.push(msg as unknown as Record<string, unknown>);
      const page = pages[msg.type];
      if (page instanceof Error) throw page;
      return page;
    }));
    const off = jest.spyOn(session, 'logoff').mockResolvedValue(undefined);
    return { sent, off };
  }

  const run = () => flowByName('profile-read').run(ctx);
  const failed = (r: FlowResult) => r.assertions.filter(a => !a.ok);

  it('passes on healthy pages, sends all eight reads, logs off, and is read-only', async () => {
    const { sent, off } = arrange();
    const result = await run();
    expect(failed(result)).toEqual([]);
    expect(result.status).toBe('PASS');
    expect(result.unproven).toEqual([]);
    expect(off).toHaveBeenCalled();
    expect(flowByName('profile-read').mutates).toBe(false);
    expect(sent.map(m => m.type)).toEqual([
      T.REQ_GET_PROFILE, T.REQ_PROFILE_CURRICULUM, T.REQ_PROFILE_BANK, T.REQ_PROFILE_PROFITLOSS,
      T.REQ_PROFILE_COMPANIES, T.REQ_PROFILE_COMPANY_PROFITLOSS, T.REQ_PROFILE_AUTOCONNECTIONS, T.REQ_PROFILE_POLICY,
    ]);
    expect(sent[5]).toMatchObject({ companyName: 'SPO_test3 - Green', cluster: 'PGI' });
  });

  it.each([
    [T.REQ_PROFILE_CURRICULUM, 'TycoonCurriculum.asp'],
    [T.REQ_PROFILE_BANK, 'TycoonBankAccount.asp'],
    [T.REQ_PROFILE_PROFITLOSS, 'TycoonProfitAndLoses.asp'],
    [T.REQ_PROFILE_COMPANIES, 'chooseCompany.asp'],
    [T.REQ_PROFILE_AUTOCONNECTIONS, 'TycoonAutoConnections.asp'],
    [T.REQ_PROFILE_POLICY, 'TycoonPolicy.asp'],
  ])('fails when %s answers cacheUnavailable, naming %s', async (type, page) => {
    const base = healthy()[type] as { data: Record<string, unknown> };
    arrange({ [type]: { data: { ...base.data, cacheUnavailable: true } } });
    const result = await run();
    expect(result.status).toBe('FAIL');
    const bad = failed(result);
    expect(bad.some(a => a.what.includes(page) && /cacheUnavailable/.test(a.detail ?? ''))).toBe(true);
  });

  it('fails on an empty levelName even though the profile name is set', async () => {
    arrange({ [T.REQ_GET_PROFILE]: { profile: { name: 'SPO_test3', levelName: '' } } });
    const result = await run();
    expect(result.status).toBe('FAIL');
    expect(failed(result).map(a => a.what)).toEqual(['the profile carries a level name parsed from NewTycoon/TycoonCurriculum.asp']);
  });

  it.each<[string, Pages, string]>([
    ['an Unknown curriculum level', { [T.REQ_PROFILE_CURRICULUM]: { data: { currentLevel: 0, currentLevelName: 'Unknown' } } }, 'the curriculum names a level'],
    ['an unparsable bank balance', { [T.REQ_PROFILE_BANK]: { data: { balance: 'abc' } } }, 'the bank page has a balance'],
    ['a P&L with no line', { [T.REQ_PROFILE_PROFITLOSS]: { data: tree([]) } }, 'profit & loss has at least one line'],
    ['a company P&L that failed', { [T.REQ_PROFILE_COMPANY_PROFITLOSS]: { companyName: 'x', data: null, error: 'x' } }, 'the company P&L parses'],
    ['a response without data', { [T.REQ_PROFILE_BANK]: {} }, 'NewTycoon/TycoonBankAccount.asp answered without cacheUnavailable'],
    ['a rejected request', { [T.REQ_PROFILE_POLICY]: new WsDriverError('boom', 1, 'REQ_PROFILE_POLICY') }, 'NewTycoon/TycoonPolicy.asp answered without cacheUnavailable'],
    ['an out-of-range Crazz status', { [T.REQ_PROFILE_POLICY]: { data: { policies: [{ tycoonName: 'Crazz', yourPolicy: 7, theirPolicy: 1 }] } } }, 'the Crazz strategy row carries a status'],
  ])('fails on %s', async (_label, over, what) => {
    arrange(over);
    const result = await run();
    expect(result.status).toBe('FAIL');
    expect(failed(result).map(a => a.what)).toEqual([what]);
  });

  it('fails the company checks when the session company is not listed', async () => {
    const { sent } = arrange({ [T.REQ_PROFILE_COMPANIES]: { data: { companies: [{ name: 'Other', cluster: 'PGI' }] } } });
    const result = await run();
    expect(failed(result).map(a => [a.what, a.detail])).toEqual([
      ['the companies list holds SPO_test3 - Green', '1 companies'],
      ['the company P&L parses', 'no company to read'],
    ]);
    expect(sent.some(m => m.type === T.REQ_PROFILE_COMPANY_PROFITLOSS)).toBe(false);
  });

  it('passes with no Crazz strategy row, never unproven', async () => {
    arrange({ [T.REQ_PROFILE_POLICY]: { data: { policies: [], alliesAllowed: true } } });
    const result = await run();
    expect(result.status).toBe('PASS');
    expect(result.unproven).toEqual([]);
    expect(result.assertions.find(a => a.what === 'no Crazz strategy row')?.detail).toMatch(/Kernel\.pas:11348/);
  });

  it('passes on an empty initial-suppliers list', async () => {
    arrange({ [T.REQ_PROFILE_AUTOCONNECTIONS]: { data: { fluids: [] } } });
    const result = await run();
    expect(result.status).toBe('PASS');
  });

  it.each([
    ['readBank', readBank, T.REQ_PROFILE_BANK],
    ['readAutoConnections', readAutoConnections, T.REQ_PROFILE_AUTOCONNECTIONS],
    ['readPolicy', readPolicy, T.REQ_PROFILE_POLICY],
    ['readCurriculum', readCurriculum, T.REQ_PROFILE_CURRICULUM],
  ] as const)('%s resolves the data and rejects on cacheUnavailable', async (_name, read, type) => {
    const base = healthy()[type] as { data: Record<string, unknown> };
    await expect(read(stubSession(() => base))).resolves.toEqual(base.data);
    await expect(read(stubSession(() => ({ data: { ...base.data, cacheUnavailable: true } }))))
      .rejects.toThrow(/cacheUnavailable/);
  });
});

describe('mail-drafts, mail-send-from-draft, mail-reply (#1144)', () => {
  const P = PRIMARY_ACCOUNT.username;
  const C = SECONDARY_ACCOUNT.username;

  type Stored = MailMessageHeader & { body: string[] };
  type Req = WsMessage & {
    folder?: string; messageId?: string; to?: string; subject?: string; body?: string[];
    headers?: string; existingDraftId?: string;
  };
  interface Logged { account: string; login: number; msg: Req }

  function stored(messageId: string, subject: string, from = P, to = C, body: string[] = []): Stored {
    return {
      messageId, subject, from, to, fromAddr: `${from}@planitia.net`, toAddr: `${to}@planitia.net`,
      date: '45000.5', dateFmt: '', read: false, stamp: 0, noReply: false, body,
    };
  }

  interface Over {
    boxes?: Record<string, Stored[]>;
    /** Folder reads after a REQ_MAIL_DELETE before it lands (1 = on the next read). */
    deleteLag?: number;
    /** Folder reads after a save/send's delete of `existingDraftId` before it lands; 'never' = it never does. */
    draftDeleteLag?: number | 'never';
    /** Box keys where a REQ_MAIL_DELETE never lands. */
    ignoreDeleteIn?: string[];
    /** Which loginSecondary calls answer `{ skipped }` (1-based). */
    refuseSecondaryOn?: number[];
    /** Which login calls reject (1-based, counting every login). */
    loginRejectsOn?: number[];
    throwWhen?: (l: Logged) => boolean;
    saveFails?: boolean;
    composeFails?: boolean;
    /** A compose that reports success but delivers nothing to the recipient's Inbox. */
    dropDelivery?: boolean;
    noFromAddr?: boolean;
  }

  function arrange(over: Over = {}) {
    const boxes: Record<string, Stored[]> = {};
    for (const [k, v] of Object.entries(over.boxes ?? {})) boxes[k] = [...v];
    const box = (key: string): Stored[] => (boxes[key] ??= []);
    const pending: { key: string; id: string; left: number }[] = [];
    const requests: Logged[] = [];
    let seq = 0;
    let logins = 0;
    const scheduleDelete = (key: string, id: string, lag: number | 'never'): void => {
      if (lag === 'never') return;
      pending.push({ key, id, left: lag });
    };

    jest.spyOn(session, 'login').mockImplementation(async account => {
      logins++;
      const loginNo = logins;
      if (over.loginRejectsOn?.includes(loginNo)) throw new Error('login refused');
      const me = account.username;
      const stub = stubSession(raw => {
        const msg = raw as Req;
        const logged = { account: me, login: loginNo, msg };
        requests.push(logged);
        if (over.throwWhen?.(logged)) throw new Error('socket died');
        switch (msg.type) {
          case WsMessageType.REQ_MAIL_CONNECT:
            return { type: WsMessageType.RESP_MAIL_CONNECTED, unreadCount: 0 };
          case WsMessageType.REQ_MAIL_GET_FOLDER: {
            const key = `${me}/${msg.folder}`;
            for (const p of pending.filter(q => q.key === key)) {
              p.left--;
              if (p.left <= 0) {
                const list = box(key);
                const i = list.findIndex(h => h.messageId === p.id);
                if (i >= 0) list.splice(i, 1);
                pending.splice(pending.indexOf(p), 1);
              }
            }
            return {
              type: WsMessageType.RESP_MAIL_FOLDER,
              folder: msg.folder,
              messages: box(key).map(({ body: _body, ...h }) => h),
            };
          }
          case WsMessageType.REQ_MAIL_DELETE: {
            const key = `${me}/${msg.folder}`;
            if (!over.ignoreDeleteIn?.includes(key)) scheduleDelete(key, msg.messageId ?? '', over.deleteLag ?? 1);
            return { type: WsMessageType.RESP_MAIL_DELETED, success: true };
          }
          case WsMessageType.REQ_MAIL_SAVE_DRAFT: {
            if (over.saveFails) return { type: WsMessageType.RESP_MAIL_DRAFT_SAVED, success: false, message: 'no' };
            if (msg.existingDraftId) scheduleDelete(`${me}/Draft`, msg.existingDraftId, over.draftDeleteLag ?? 1);
            seq++;
            box(`${me}/Draft`).push(stored(`d${seq}`, msg.subject ?? '', me, msg.to ?? '', msg.body ?? []));
            return { type: WsMessageType.RESP_MAIL_DRAFT_SAVED, success: true };
          }
          case WsMessageType.REQ_MAIL_COMPOSE: {
            if (over.composeFails) return { type: WsMessageType.RESP_MAIL_SENT, success: false, message: 'Post refused' };
            const to = (msg.to ?? '').replace(/@.*/, '');
            seq++;
            if (!over.dropDelivery) box(`${to}/Inbox`).push(stored(`m${seq}`, msg.subject ?? '', me, to, msg.body ?? []));
            box(`${me}/Sent`).push(stored(`s${seq}`, msg.subject ?? '', me, to, msg.body ?? []));
            if (msg.existingDraftId) scheduleDelete(`${me}/Draft`, msg.existingDraftId, over.draftDeleteLag ?? 1);
            return { type: WsMessageType.RESP_MAIL_SENT, success: true };
          }
          case WsMessageType.REQ_MAIL_READ_MESSAGE: {
            const found = box(`${me}/${msg.folder}`).find(h => h.messageId === msg.messageId);
            const message = { ...found, attachments: [], ...(over.noFromAddr ? { fromAddr: '' } : {}) };
            return { type: WsMessageType.RESP_MAIL_MESSAGE, message };
          }
          default:
            return undefined;
        }
      });
      return { ...stub, account };
    });
    let secondaryCalls = 0;
    jest.spyOn(session, 'loginSecondary').mockImplementation(async () => {
      secondaryCalls++;
      if (over.refuseSecondaryOn?.includes(secondaryCalls)) return { skipped: `Crazz refused (call ${secondaryCalls})` };
      return session.login(SECONDARY_ACCOUNT);
    });
    jest.spyOn(session, 'logoff').mockResolvedValue(undefined);
    return { boxes, requests, logins: () => logins };
  }

  const run = (name: string, over: Over = {}) => {
    const arranged = arrange(over);
    const result = runFlow(flowByName(name), { lock: cleanLock(), sleep: async () => {} });
    return { ...arranged, result };
  };
  const ofType = (requests: Logged[], type: WsMessageType): Logged[] => requests.filter(r => r.msg.type === type);
  const writes = (requests: Logged[]): Logged[] =>
    requests.filter(r => r.msg.type === WsMessageType.REQ_MAIL_SAVE_DRAFT || r.msg.type === WsMessageType.REQ_MAIL_COMPOSE);
  const nonEmpty = (boxes: Record<string, Stored[]>): string[] =>
    Object.entries(boxes).filter(([, v]) => v.length > 0).map(([k]) => k);
  const assertion = (result: FlowResult, what: string) => result.assertions.find(a => a.what === what);

  it('replyHeaders builds the same lines as the client store\'s buildReplyHeaders', () => {
    const message: MailMessageFull = { ...stored('m7', 'e2e-mail-reply x', P, C), attachments: [] };
    expect(replyHeaders(message)).toBe(buildReplyHeaders(message));
  });

  describe('mail-drafts', () => {
    it('saves, saves over it, keeps one copy with the new text, deletes it — and leaves Draft empty', async () => {
      const { result, requests, boxes } = run('mail-drafts');
      const r = await result;

      expect(r.status).toBe('PASS');
      expect(r.cleanup).toEqual([expect.objectContaining({ ok: true })]);
      expect(nonEmpty(boxes)).toEqual([]);
      const saves = ofType(requests, WsMessageType.REQ_MAIL_SAVE_DRAFT);
      expect(saves).toHaveLength(2);
      expect(saves[0].msg).toMatchObject({ to: P });
      expect(saves[0].msg.subject).toMatch(/^e2e-mail-drafts /);
      expect(saves[1].msg.existingDraftId).toBe('d1');
      expect(assertion(r, 'the kept copy carries the new text')?.ok).toBe(true);
      expect(r.assertions.some(a => a.what.startsWith('pre-sweep: ') && a.ok)).toBe(true);
    });

    it('passes when the old copy still shows on the first re-read and is gone on the second', async () => {
      const { result } = run('mail-drafts', { draftDeleteLag: 2 });
      const r = await result;

      expect(r.status).toBe('PASS');
      expect(assertion(r, 'Draft holds exactly one copy, not the old one')?.detail).toMatch(/reads=2$/);
    });

    it('fails when the old copy shows on every re-read, and the cleanup still clears Draft', async () => {
      const { result, boxes } = run('mail-drafts', { draftDeleteLag: 'never' });
      const r = await result;

      expect(r.status).toBe('FAIL');
      const check = assertion(r, 'Draft holds exactly one copy, not the old one');
      expect(check).toMatchObject({ ok: false });
      expect(check?.detail).toMatch(new RegExp(`reads=${LIMITS.mailDeleteMaxReads}$`));
      expect(r.cleanup).toEqual([expect.objectContaining({ ok: true })]);
      expect(nonEmpty(boxes)).toEqual([]);
    });

    it('pre-sweeps a stale prefixed draft before the first save, and spares an unmarked one', async () => {
      const { result, requests, boxes } = run('mail-drafts', {
        boxes: { [`${P}/Draft`]: [stored('old', 'e2e-mail-drafts 2020', P, P), stored('keep', 'my own draft', P, P)] },
      });
      const r = await result;

      expect(r.status).toBe('PASS');
      const staleDelete = requests.findIndex(x => x.msg.type === WsMessageType.REQ_MAIL_DELETE && x.msg.messageId === 'old');
      const firstSave = requests.findIndex(x => x.msg.type === WsMessageType.REQ_MAIL_SAVE_DRAFT);
      expect(staleDelete).toBeGreaterThanOrEqual(0);
      expect(staleDelete).toBeLessThan(firstSave);
      expect(boxes[`${P}/Draft`].map(m => m.messageId)).toEqual(['keep']);
    });

    it('FAILs and saves nothing when the pre-sweep cannot clear Draft', async () => {
      const { result, requests } = run('mail-drafts', {
        boxes: { [`${P}/Draft`]: [stored('old', 'e2e-mail-drafts 2020', P, P)] },
        ignoreDeleteIn: [`${P}/Draft`],
      });
      const r = await result;

      expect(r.status).toBe('FAIL');
      expect(r.assertions[0]).toMatchObject({ ok: false, detail: expect.stringMatching(/1 still listed/) });
      expect(r.assertions[0].what).toMatch(/^pre-sweep: /);
      expect(writes(requests)).toEqual([]);
      expect(r.cleanup?.[0].ok).toBe(false);
    });

    it('FAILs when the save is refused and the Draft never lists it', async () => {
      const { result } = run('mail-drafts', { saveFails: true });
      const r = await result;

      expect(r.status).toBe('FAIL');
      expect(assertion(r, 'the first save was accepted')).toMatchObject({ ok: false, detail: 'no' });
      expect(assertion(r, 'the Draft folder lists the saved draft')?.ok).toBe(false);
    });

    it('FAILs when the kept copy does not carry the new text', async () => {
      const { result } = run('mail-drafts', {
        throwWhen: l => {
          if (l.msg.type === WsMessageType.REQ_MAIL_SAVE_DRAFT && l.msg.existingDraftId) l.msg.body = ['stale'];
          return false;
        },
      });
      const r = await result;

      expect(r.status).toBe('FAIL');
      expect(assertion(r, 'the kept copy carries the new text')?.ok).toBe(false);
    });

    it('FAILs when the final delete never lands, and the cleanup reports the leftover', async () => {
      const { result } = run('mail-drafts', { ignoreDeleteIn: [`${P}/Draft`] });
      const r = await result;

      expect(r.status).toBe('FAIL');
      expect(assertion(r, 'the draft was deleted')?.ok).toBe(false);
      expect(r.cleanup?.[0]).toMatchObject({ ok: false, detail: expect.stringMatching(/1 still listed/) });
    });

    it('turns a throw mid-drive into a FAIL with its error, and still cleans up', async () => {
      const { result, boxes } = run('mail-drafts', {
        throwWhen: l => l.msg.type === WsMessageType.REQ_MAIL_READ_MESSAGE,
      });
      const r = await result;

      expect(r).toMatchObject({ status: 'FAIL', error: 'socket died' });
      expect(r.cleanup).toEqual([expect.objectContaining({ ok: true })]);
      expect(nonEmpty(boxes)).toEqual([]);
    });

    it('a cleanup whose login is rejected is not ok, and the flow FAILs', async () => {
      const { result } = run('mail-drafts', { loginRejectsOn: [2] });
      const r = await result;

      expect(r.status).toBe('FAIL');
      expect(r.cleanup).toEqual([expect.objectContaining({ ok: false, detail: 'login refused' })]);
    });

    it('a cleanup whose mail connect throws is not ok', async () => {
      const { result } = run('mail-drafts', {
        throwWhen: l => l.login === 2 && l.msg.type === WsMessageType.REQ_MAIL_CONNECT,
      });
      const r = await result;

      expect(r.status).toBe('FAIL');
      expect(r.cleanup).toEqual([expect.objectContaining({ ok: false, detail: 'socket died' })]);
    });

    it('a cleanup whose folder read throws is not ok', async () => {
      const { result } = run('mail-drafts', {
        throwWhen: l => l.login === 2 && l.msg.type === WsMessageType.REQ_MAIL_GET_FOLDER,
      });
      const r = await result;

      expect(r.status).toBe('FAIL');
      expect(r.cleanup).toEqual([expect.objectContaining({ ok: false, detail: 'socket died' })]);
    });

    it('waits the real re-read gap when no sleep is injected', async () => {
      jest.useFakeTimers();
      try {
        arrange({ draftDeleteLag: 2 });
        const resultPromise = flowByName('mail-drafts').run({ lock: cleanLock() });
        await jest.advanceTimersByTimeAsync(TIMEOUTS.mailDeleteReread);
        const r = await resultPromise;
        expect(r.status).toBe('PASS');
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('mail-send-from-draft', () => {
    it('sends the draft with its id, Crazz receives it, the Draft copy is gone, and every box is empty after', async () => {
      const { result, requests, boxes } = run('mail-send-from-draft');
      const r = await result;

      expect(r.status).toBe('PASS');
      const compose = ofType(requests, WsMessageType.REQ_MAIL_COMPOSE);
      expect(compose).toHaveLength(1);
      expect(compose[0]).toMatchObject({ account: P, msg: { to: C, existingDraftId: 'd1' } });
      expect(assertion(r, `${C}'s Inbox holds it`)?.ok).toBe(true);
      expect(assertion(r, `${P}'s Draft no longer holds it (#510)`)?.ok).toBe(true);
      expect(r.cleanup).toHaveLength(3);
      expect(r.cleanup?.every(c => c.ok)).toBe(true);
      expect(nonEmpty(boxes)).toEqual([]);
    });

    it('judges the Draft copy gone on the last re-read', async () => {
      const { result } = run('mail-send-from-draft', { draftDeleteLag: 3 });
      const r = await result;

      expect(r.status).toBe('PASS');
      expect(assertion(r, `${P}'s Draft no longer holds it (#510)`)?.detail).toMatch(/reads=3$/);
    });

    it('FAILs when the Draft copy is never removed after the send', async () => {
      const { result, boxes } = run('mail-send-from-draft', { draftDeleteLag: 'never' });
      const r = await result;

      expect(r.status).toBe('FAIL');
      expect(assertion(r, `${P}'s Draft no longer holds it (#510)`)?.ok).toBe(false);
      expect(nonEmpty(boxes)).toEqual([]);
    });

    it('ends SKIPPED when Crazz is refused before the first write, and SPO_test3 sends nothing', async () => {
      const { result, requests, logins } = run('mail-send-from-draft', { refuseSecondaryOn: [1] });
      const r = await result;

      expect(r).toMatchObject({ status: 'SKIPPED', skipped: 'Crazz refused (call 1)' });
      expect(logins()).toBe(0);
      expect(writes(requests)).toEqual([]);
    });

    it('FAILs naming the leftover when Crazz is refused at the cleanup, after the send', async () => {
      const { result, boxes } = run('mail-send-from-draft', { refuseSecondaryOn: [2] });
      const r = await result;

      expect(r.status).toBe('FAIL');
      const crazz = r.cleanup?.find(c => c.skipped !== undefined);
      expect(crazz).toMatchObject({ ok: false, skipped: 'Crazz refused (call 2)' });
      expect(crazz?.detail).toMatch(/left in Crazz's Inbox/);
      expect(boxes[`${C}/Inbox`]).toHaveLength(1);
    });

    it('pre-sweeps SPO_test3\'s Draft and Sent and Crazz\'s Inbox before the first write', async () => {
      const stale = 'e2e-mail-send-from-draft 2020';
      const { result, requests, boxes } = run('mail-send-from-draft', {
        boxes: {
          [`${P}/Draft`]: [stored('x1', stale, P, C)],
          [`${P}/Sent`]: [stored('x2', stale, P, C)],
          [`${C}/Inbox`]: [stored('x3', stale, P, C), stored('real', 'hello', P, C)],
        },
      });
      const r = await result;

      expect(r.status).toBe('PASS');
      const firstWrite = requests.indexOf(writes(requests)[0]);
      for (const id of ['x1', 'x2', 'x3']) {
        const i = requests.findIndex(x => x.msg.type === WsMessageType.REQ_MAIL_DELETE && x.msg.messageId === id);
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThan(firstWrite);
      }
      expect(boxes[`${C}/Inbox`].map(m => m.messageId)).toEqual(['real']);
    });

    it('FAILs and writes nothing when a pre-sweep cannot clear Crazz\'s Inbox', async () => {
      const { result, requests } = run('mail-send-from-draft', {
        boxes: { [`${C}/Inbox`]: [stored('x3', 'e2e-mail-send-from-draft 2020', P, C)] },
        ignoreDeleteIn: [`${C}/Inbox`],
      });
      const r = await result;

      expect(r.status).toBe('FAIL');
      expect(writes(requests)).toEqual([]);
    });

    it('a leftover in Crazz\'s Inbox after the cleanup turns the flow FAIL', async () => {
      const { result } = run('mail-send-from-draft', { ignoreDeleteIn: [`${C}/Inbox`] });
      const r = await result;

      expect(r.status).toBe('FAIL');
      expect(r.assertions.every(a => a.ok)).toBe(true);
      expect(r.cleanup?.find(c => c.what.includes(`${C}'s Inbox`))?.ok).toBe(false);
    });

    it('stops when the Draft never lists the saved draft, sends nothing, and still cleans up', async () => {
      const { result, requests } = run('mail-send-from-draft', { saveFails: true });
      const r = await result;

      expect(r.status).toBe('FAIL');
      expect(ofType(requests, WsMessageType.REQ_MAIL_COMPOSE)).toEqual([]);
      expect(r.cleanup).toHaveLength(3);
    });

    it('FAILs when the send is refused', async () => {
      const { result } = run('mail-send-from-draft', { composeFails: true });
      const r = await result;

      expect(r.status).toBe('FAIL');
      expect(assertion(r, 'the send from the draft was accepted')).toMatchObject({ ok: false, detail: 'Post refused' });
    });

    it('turns a throw mid-drive into a FAIL and still cleans up both mailboxes', async () => {
      const { result, boxes } = run('mail-send-from-draft', {
        throwWhen: l => l.msg.type === WsMessageType.REQ_MAIL_COMPOSE,
      });
      const r = await result;

      expect(r).toMatchObject({ status: 'FAIL', error: 'socket died' });
      expect(r.cleanup?.every(c => c.ok)).toBe(true);
      expect(nonEmpty(boxes)).toEqual([]);
    });
  });

  describe('mail-reply', () => {
    it('replies as the client does, SPO_test3 receives the Re:, and all four copies are deleted', async () => {
      const { result, requests, boxes } = run('mail-reply');
      const r = await result;

      expect(r.status).toBe('PASS');
      const [sent, reply] = ofType(requests, WsMessageType.REQ_MAIL_COMPOSE);
      expect(sent).toMatchObject({ account: P, msg: { to: C } });
      expect(sent.msg.subject).toMatch(/^e2e-mail-reply /);
      expect(reply).toMatchObject({
        account: C,
        msg: { to: `${P}@planitia.net`, subject: `Re: ${sent.msg.subject}` },
      });
      const original: MailMessageFull = {
        ...stored('m1', sent.msg.subject ?? '', P, C), attachments: [],
      };
      expect(reply.msg.headers).toBe(buildReplyHeaders(original));
      expect(r.cleanup).toHaveLength(4);
      expect(r.cleanup?.every(c => c.ok)).toBe(true);
      expect(nonEmpty(boxes)).toEqual([]);
    });

    it('ends SKIPPED when Crazz is refused before the first write, and SPO_test3 sends nothing', async () => {
      const { result, requests, logins } = run('mail-reply', { refuseSecondaryOn: [1] });
      const r = await result;

      expect(r).toMatchObject({ status: 'SKIPPED', skipped: 'Crazz refused (call 1)' });
      expect(logins()).toBe(0);
      expect(writes(requests)).toEqual([]);
    });

    it('FAILs naming the leftover when Crazz is refused at the cleanup, after the writes', async () => {
      const { result, boxes } = run('mail-reply', { refuseSecondaryOn: [2] });
      const r = await result;

      expect(r.status).toBe('FAIL');
      const refused = r.cleanup?.filter(c => c.skipped !== undefined) ?? [];
      expect(refused).toHaveLength(2);
      expect(refused[0].detail).toMatch(/left in Crazz's Inbox/);
      expect(refused[1].detail).toMatch(/left in Crazz's Sent/);
      expect(boxes[`${P}/Inbox`]).toEqual([]);
    });

    it('pre-sweeps a stale marker and a stale Re: marker in all four folders before the first write', async () => {
      const stale = 'e2e-mail-reply 2020';
      const { result, requests, boxes } = run('mail-reply', {
        boxes: {
          [`${P}/Inbox`]: [stored('a', `Re: ${stale}`, C, P), stored('keep', 'Re: something else', C, P)],
          [`${P}/Sent`]: [stored('b', stale, P, C)],
          [`${C}/Inbox`]: [stored('c', stale, P, C)],
          [`${C}/Sent`]: [stored('d', `RE: ${stale}`, C, P)],
        },
      });
      const r = await result;

      expect(r.status).toBe('PASS');
      const firstWrite = requests.indexOf(writes(requests)[0]);
      for (const id of ['a', 'b', 'c', 'd']) {
        const i = requests.findIndex(x => x.msg.type === WsMessageType.REQ_MAIL_DELETE && x.msg.messageId === id);
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThan(firstWrite);
      }
      expect(r.assertions.filter(a => a.what.startsWith('pre-sweep: '))).toHaveLength(4);
      expect(boxes[`${P}/Inbox`].map(m => m.messageId)).toEqual(['keep']);
    });

    it('FAILs and writes nothing when a pre-sweep folder read throws', async () => {
      const { result, requests } = run('mail-reply', {
        // Login 1 is Crazz's drive session; the cleanup logs in afresh and is spared.
        throwWhen: l => l.login === 1 && l.msg.type === WsMessageType.REQ_MAIL_GET_FOLDER && l.msg.folder === 'Sent',
      });
      const r = await result;

      expect(r.status).toBe('FAIL');
      expect(r.assertions.find(a => !a.ok)).toMatchObject({ detail: 'socket died' });
      expect(writes(requests)).toEqual([]);
    });

    it('fails, and still cleans up, when the message never reaches Crazz', async () => {
      const { result, requests, boxes } = run('mail-reply', { dropDelivery: true });
      const r = await result;

      expect(r.status).toBe('FAIL');
      expect(assertion(r, `${C}'s Inbox holds the message`)?.ok).toBe(false);
      expect(ofType(requests, WsMessageType.REQ_MAIL_COMPOSE)).toHaveLength(1);
      expect(r.cleanup).toHaveLength(4);
      expect(nonEmpty(boxes)).toEqual([]);
    });

    it('stops before replying when the read message carries no sender address', async () => {
      const { result, requests } = run('mail-reply', { noFromAddr: true });
      const r = await result;

      expect(r.status).toBe('FAIL');
      expect(assertion(r, 'the read message carries a sender address')?.ok).toBe(false);
      expect(ofType(requests, WsMessageType.REQ_MAIL_COMPOSE)).toHaveLength(1);
    });

    it('FAILs when the composes are refused', async () => {
      const { result } = run('mail-reply', { composeFails: true });
      const r = await result;

      expect(r.status).toBe('FAIL');
      expect(assertion(r, 'the compose was accepted')).toMatchObject({ ok: false, detail: 'Post refused' });
    });

    it('turns a throw on the read into a FAIL and still deletes every copy', async () => {
      const { result, boxes } = run('mail-reply', {
        throwWhen: l => l.msg.type === WsMessageType.REQ_MAIL_READ_MESSAGE,
      });
      const r = await result;

      expect(r).toMatchObject({ status: 'FAIL', error: 'socket died' });
      expect(r.cleanup?.every(c => c.ok)).toBe(true);
      expect(nonEmpty(boxes)).toEqual([]);
    });

    it('a leftover in SPO_test3\'s Inbox after the cleanup turns the flow FAIL', async () => {
      const { result } = run('mail-reply', { ignoreDeleteIn: [`${P}/Inbox`] });
      const r = await result;

      expect(r.status).toBe('FAIL');
      expect(r.cleanup?.find(c => c.what.includes(`${P}'s Inbox`))?.ok).toBe(false);
    });

    it('FAILs when the reply never shows in SPO_test3\'s Inbox', async () => {
      const { result } = run('mail-reply', {
        throwWhen: l => {
          if (l.account === C && l.msg.type === WsMessageType.REQ_MAIL_COMPOSE) l.msg.to = 'Nobody';
          return false;
        },
      });
      const r = await result;

      expect(r.status).toBe('FAIL');
      expect(assertion(r, `${P}'s Inbox holds the reply with a Re: subject`)?.ok).toBe(false);
    });
  });
});

describe('policy-roundtrip and autoconnection-roundtrip (#1146)', () => {
  const ME = PRIMARY_ACCOUNT.username;
  const HIM = SECONDARY_ACCOUNT.username;
  let lines: string[];
  let lock: WorldLock;
  let sent: WsMessage[];

  /** A clock that jumps past the read-back bound on every call: each poll reads once. */
  function jumpingClock(): () => number {
    let t = 0;
    return () => (t += TIMEOUTS.readBack + 1);
  }
  function flowCtx() {
    return { lock, survivalLogUrl: 'http://logs/S.log', sleep: jest.fn(async () => undefined), now: jumpingClock() };
  }

  beforeEach(() => {
    lines = [];
    sent = [];
    lock = cleanLock();
    jest.spyOn(session, 'logoff').mockResolvedValue(undefined);
    jest.spyOn(liveLog, 'openLogWindow').mockResolvedValue({ url: 'http://logs/S.log', offset: 0, openedAt: 't' });
    jest.spyOn(liveLog, 'awaitMarker').mockImplementation(async (_w, spec) =>
      lines.find(l => l.includes(spec.marker) && (spec.match?.(l) ?? true)) ?? null,
    );
  });

  const sentOf = (type: WsMessageType) => sent.filter(m => m.type === type) as unknown as Record<string, unknown>[];

  describe('policy-roundtrip', () => {
    interface PolicyWorld {
      row: { yours: number; theirs: number } | null;
      cacheUnavailable?: boolean;
      /** The server leaves a neutral row instead of dropping it. */
      keepNeutralRow?: boolean;
      /** Writes after this many are ignored by the model (a failed proof). */
      ignoreWrites?: boolean;
      /** The first write's request rejects. */
      failFirstWrite?: boolean;
      silentLog?: boolean;
    }
    function drive(world: PolicyWorld): void {
      let writes = 0;
      jest.spyOn(session, 'login').mockResolvedValue(
        stubSession(msg => {
          sent.push(msg);
          if (msg.type === WsMessageType.REQ_PROFILE_POLICY) {
            return {
              data: {
                policies: world.row
                  ? [{ tycoonName: HIM.toUpperCase(), yourPolicy: world.row.yours, theirPolicy: world.row.theirs }]
                  : [],
                alliesAllowed: true,
                cacheUnavailable: world.cacheUnavailable,
              },
            };
          }
          if (msg.type === WsMessageType.REQ_PROFILE_POLICY_SET) {
            writes++;
            if (world.failFirstWrite && writes === 1) throw new Error('socket died');
            const status = (msg as unknown as { status: number }).status;
            if (!world.silentLog) lines.push(` Setting policy status: ${ME}, ${HIM}, ${status}`);
            if (!world.ignoreWrites) {
              const theirs = world.row?.theirs ?? 1;
              world.row = status === 1 && theirs === 1 && !world.keepNeutralRow ? null : { yours: status, theirs };
            }
            return { success: false };
          }
          throw new Error(`unexpected ${msg.type}`);
        }),
      );
    }
    const statuses = () => sentOf(WsMessageType.REQ_PROFILE_POLICY_SET).map(m => m.status);
    const run = () => flowByName('policy-roundtrip').run(flowCtx());

    it('mutates, and from "no row" sets enemy, then neutral, and expects the row gone', async () => {
      expect(flowByName('policy-roundtrip').mutates).toBe(true);
      const world: PolicyWorld = { row: null };
      drive(world);
      const result = await run();
      expect(result.status).toBe('PASS');
      expect(statuses()).toEqual([2, 1]);
      expect(sentOf(WsMessageType.REQ_PROFILE_POLICY_SET)[0].tycoonName).toBe(HIM);
      expect(result.probes[0]).toMatchObject({ original: 'none', written: `2:1`, restored: true });
      expect(result.probes[0].logLine).toContain(`${ME}, ${HIM}, 2`);
      expect(world.row).toBeNull();
      expect(lock.read().pendingRestores).toEqual([]);
    });

    it('FAILs when the restore from "no row" leaves a neutral row behind, and keeps the pending restore', async () => {
      drive({ row: null, keepNeutralRow: true });
      const result = await run();
      expect(result.status).toBe('FAIL');
      expect(result.probes[0].restored).toBe(false);
      expect(lock.read().pendingRestores).toHaveLength(1);
      expect(lock.read().pendingRestores[0].what).toMatch(/strategy towards Crazz.*put back "none"/);
    });

    it('from enemy writes neutral and restores enemy', async () => {
      drive({ row: { yours: 2, theirs: 2 } });
      const result = await run();
      expect(result.status).toBe('PASS');
      expect(statuses()).toEqual([1, 2]);
      expect(result.probes[0].written).toBe('1:2');
    });

    it('still restores after a failed write', async () => {
      drive({ row: null, failFirstWrite: true });
      const result = await run();
      expect(result.status).toBe('FAIL');
      expect(statuses()).toEqual([2, 1]);
    });

    it('still restores after a failed proof — a Survival line with no matching read-back FAILs', async () => {
      drive({ row: { yours: 0, theirs: 1 }, ignoreWrites: true });
      const result = await run();
      expect(result.status).toBe('FAIL');
      expect(result.probes[0].logLine).not.toBeNull();
      expect(result.probes[0].readBack).toBe('UNCONFIRMED');
      expect(statuses()).toEqual([2, 0]);
    });

    it('FAILs a read-back with no Survival line', async () => {
      drive({ row: null, silentLog: true });
      const result = await run();
      expect(result.status).toBe('FAIL');
      expect(result.probes[0].readBack).toBe('CONFIRMED');
      expect(result.probes[0].logLine).toBeNull();
    });

    it('refuses to write when the original read carries cacheUnavailable', async () => {
      drive({ row: null, cacheUnavailable: true });
      const result = await run();
      expect(result.status).toBe('FAIL');
      expect(result.probes[0].note).toMatch(/cacheUnavailable/);
      expect(statuses()).toEqual([]);
      expect(lock.read().pendingRestores).toEqual([]);
    });

    it('looks the Survival log up when the run did not resolve one', async () => {
      drive({ row: null });
      const find = jest.spyOn(liveLog, 'findCurrentSurvivalLog').mockResolvedValue('http://found/S.log');
      const result = await flowByName('policy-roundtrip').run({ ...flowCtx(), survivalLogUrl: undefined });
      expect(find).toHaveBeenCalled();
      expect(result.status).toBe('PASS');
    });
  });

  describe('autoconnection-roundtrip', () => {
    interface Fluid {
      fluidId: string;
      fluidName: string;
      suppliers: { facilityName: string; facilityId: string; companyName: string }[];
      hireTradeCenter: boolean;
      onlyWarehouses: boolean;
      storable?: boolean;
    }
    interface AcWorld {
      fluids: Fluid[];
      search: Record<string, { facilityName: string; companyName: string; x: number; y: number }[]>;
      cacheUnavailable?: boolean;
      /** The first action request rejects. */
      failFirstAction?: boolean;
      /** No `Deleting initial suppliers:` line is logged. */
      silentDelete?: boolean;
      /** Reads after the first throw — a dead page mid-poll. */
      deadAfterFirstRead?: boolean;
    }
    const ACTION_LINES: Record<string, string> = {
      add: 'Adding initial suppliers:',
      delete: 'Deleting initial suppliers:',
      hireTradeCenter: 'Initial suppliers, include Trade Center:',
      dontHireTradeCenter: 'Initial suppliers, excluding Trade Center:',
      onlyWarehouses: 'Initial suppliers, hire only warehouses:',
      dontOnlyWarehouses: 'Initial suppliers, hire all:',
    };
    function drive(world: AcWorld): void {
      let actions = 0;
      let reads = 0;
      jest.spyOn(session, 'login').mockResolvedValue(
        stubSession(msg => {
          sent.push(msg);
          if (msg.type === WsMessageType.REQ_PROFILE_AUTOCONNECTIONS) {
            reads++;
            if (world.deadAfterFirstRead && reads > 1) throw new Error('page died');
            return { data: { fluids: structuredClone(world.fluids), cacheUnavailable: world.cacheUnavailable } };
          }
          if (msg.type === WsMessageType.REQ_SEARCH_CONNECTIONS) {
            const fluidId = (msg as unknown as { fluidId: string }).fluidId;
            return { results: world.search[fluidId] ?? [], fluidId, direction: 'input' };
          }
          if (msg.type === WsMessageType.REQ_PROFILE_AUTOCONNECTION_ACTION) {
            actions++;
            if (world.failFirstAction && actions === 1) throw new Error('socket died');
            const { action, fluidId, suppliers } = msg as unknown as { action: string; fluidId: string; suppliers?: string };
            const fluid = world.fluids.find(f => f.fluidId === fluidId);
            if (!fluid) throw new Error(`no fluid ${fluidId}`);
            if (!(action === 'delete' && world.silentDelete)) {
              lines.push(`${ACTION_LINES[action]} ${ME}, ${fluidId}${suppliers ? `, ${suppliers}` : ''}`);
            }
            if (action === 'hireTradeCenter') fluid.hireTradeCenter = true;
            if (action === 'dontHireTradeCenter') fluid.hireTradeCenter = false;
            if (action === 'onlyWarehouses') fluid.onlyWarehouses = true;
            if (action === 'dontOnlyWarehouses') fluid.onlyWarehouses = false;
            if (action === 'add') fluid.suppliers.push({ facilityName: 'F', facilityId: suppliers ?? '', companyName: 'C' });
            if (action === 'delete') fluid.suppliers = fluid.suppliers.filter(s => s.facilityId !== suppliers);
            return { success: true };
          }
          throw new Error(`unexpected ${msg.type}`);
        }),
      );
    }
    const fluid = (fluidId: string, over: Partial<Fluid> = {}): Fluid => ({
      fluidId,
      fluidName: fluidId,
      suppliers: [],
      hireTradeCenter: false,
      onlyWarehouses: false,
      ...over,
    });
    const actions = () =>
      sentOf(WsMessageType.REQ_PROFILE_AUTOCONNECTION_ACTION).map(m => `${m.action} ${m.fluidId}${m.suppliers ? ` ${m.suppliers}` : ''}`);
    const run = () => flowByName('autoconnection-roundtrip').run(flowCtx());

    it('mutates, flips both switches, adds a supplier and deletes it — PASS', async () => {
      expect(flowByName('autoconnection-roundtrip').mutates).toBe(true);
      drive({
        fluids: [
          fluid('Chemicals', { hireTradeCenter: true, suppliers: [{ facilityName: 'A', facilityId: '1,2,', companyName: 'C' }] }),
          fluid('Food', { storable: true }),
        ],
        search: {
          Chemicals: [
            { facilityName: 'A', companyName: 'C', x: 1, y: 2 },
            { facilityName: 'Trade Center', companyName: 'Gov', x: 9, y: 9 },
            { facilityName: 'B', companyName: 'C', x: 5, y: 6 },
          ],
        },
      });
      const result = await run();
      expect(result.status).toBe('PASS');
      expect(actions()).toEqual([
        'dontHireTradeCenter Chemicals',
        'hireTradeCenter Chemicals',
        'onlyWarehouses Food',
        'dontOnlyWarehouses Food',
        'add Chemicals 5,6,',
        'delete Chemicals 5,6,',
      ]);
      const search = sentOf(WsMessageType.REQ_SEARCH_CONNECTIONS)[0];
      expect(search).toMatchObject({ buildingX: 0, buildingY: 0, direction: 'input', filters: { maxResults: 50, roles: 22 } }); // producer 2 + distributer 4 + importer 16
      expect(result.probes.map(p => p.member)).toEqual([
        'RDODontHireTradeCenter', 'RDOHireOnlyFromWarehouse', 'RDOAddAutoConnection',
      ]);
      expect(result.assertions.find(a => a.what.startsWith('the delete reached'))?.ok).toBe(true);
      expect(lock.read().pendingRestores).toEqual([]);
    });

    it('runs the warehouse flip only on the storable fluid', async () => {
      drive({ fluids: [fluid('Chemicals'), fluid('Food', { storable: true })], search: {} });
      await run();
      expect(actions().filter(a => /OnlyWarehouses|onlyWarehouses/.test(a))).toEqual([
        'onlyWarehouses Food', 'dontOnlyWarehouses Food',
      ]);
    });

    it('with no storable fluid, ends the warehouse flip unproven and writes nothing for it', async () => {
      drive({ fluids: [fluid('Chemicals')], search: { Chemicals: [{ facilityName: 'B', companyName: 'C', x: 5, y: 6 }] } });
      const result = await run();
      expect(result.status).toBe('UNPROVEN');
      expect(result.unproven.join()).toMatch(/only-warehouses flip — no storable fluid/);
      expect(actions().some(a => /nlyWarehouses/.test(a))).toBe(false);
    });

    it('with every result already listed (or a Trade Center), ends the add half unproven with no add', async () => {
      drive({
        fluids: [fluid('Chemicals', { storable: true, suppliers: [{ facilityName: 'A', facilityId: '1,2,', companyName: 'C' }] })],
        search: {
          Chemicals: [
            { facilityName: 'A', companyName: 'C', x: 1, y: 2 },
            { facilityName: 'Trade Center', companyName: 'Gov', x: 9, y: 9 },
          ],
        },
      });
      const result = await run();
      expect(result.status).toBe('UNPROVEN');
      expect(result.unproven.join()).toMatch(/add\/delete supplier half/);
      expect(actions().some(a => a.startsWith('add') || a.startsWith('delete'))).toBe(false);
    });

    it('refuses to write when the initial read carries cacheUnavailable', async () => {
      drive({ fluids: [fluid('Chemicals')], search: {}, cacheUnavailable: true });
      const result = await run();
      expect(result.status).toBe('FAIL');
      expect(actions()).toEqual([]);
    });

    it('ends every half unproven when the page lists no fluid', async () => {
      drive({ fluids: [], search: {} });
      const result = await run();
      expect(result.status).toBe('UNPROVEN');
      expect(result.unproven).toHaveLength(3);
      expect(actions()).toEqual([]);
    });

    it('FAILs when the delete leaves no Deleting initial suppliers: line', async () => {
      drive({ fluids: [fluid('Chemicals')], search: { Chemicals: [{ facilityName: 'B', companyName: 'C', x: 5, y: 6 }] }, silentDelete: true });
      const result = await run();
      expect(result.status).toBe('FAIL');
      expect(result.assertions.find(a => a.what.startsWith('the delete reached'))?.ok).toBe(false);
    });

    it('still restores a flip whose write failed', async () => {
      drive({ fluids: [fluid('Chemicals')], search: {}, failFirstAction: true });
      const result = await run();
      expect(result.status).toBe('FAIL');
      expect(actions().slice(0, 2)).toEqual(['hireTradeCenter Chemicals', 'dontHireTradeCenter Chemicals']);
    });

    it('keeps polling through a dead page and FAILs the unproven read-backs', async () => {
      drive({ fluids: [fluid('Chemicals')], search: { Chemicals: [{ facilityName: 'B', companyName: 'C', x: 5, y: 6 }] }, deadAfterFirstRead: true });
      const result = await run();
      expect(result.status).toBe('FAIL');
      // Each round trip's original read throws on the dead page: nothing is written.
      expect(actions()).toEqual([]);
    });
  });
});

describe('bank-borrow-payoff, bank-send-return and portrait-roundtrip (#1147)', () => {
  const ME = PRIMARY_ACCOUNT.username;
  const HIM = SECONDARY_ACCOUNT.username;
  let lines: string[];
  let lock: WorldLock;
  let sent: { account: string; msg: Record<string, unknown> }[];

  /** A clock that jumps past the read-back bound on every call: each poll reads once. */
  function jumpingClock(): () => number {
    let t = 0;
    return () => (t += TIMEOUTS.readBack + 1);
  }
  function flowCtx() {
    return { lock, survivalLogUrl: 'http://logs/S.log', sleep: jest.fn(async () => undefined), now: jumpingClock() };
  }
  /** A stub session for `account`, recording every request with the account that sent it. */
  function stubFor(account: typeof PRIMARY_ACCOUNT, responder: (msg: WsMessage) => unknown): session.LiveSession {
    return {
      ...stubSession(msg => {
        sent.push({ account: account.username, msg: msg as unknown as Record<string, unknown> });
        return responder(msg);
      }),
      account,
      world: { name: 'planitia', url: '', ip: '10.0.0.7', port: 0 },
    };
  }
  const sentOf = (type: WsMessageType) => sent.filter(e => e.msg.type === type);

  beforeEach(() => {
    lines = [];
    sent = [];
    lock = cleanLock();
    jest.spyOn(session, 'logoff').mockResolvedValue(undefined);
    jest.spyOn(liveLog, 'openLogWindow').mockResolvedValue({ url: 'http://logs/S.log', offset: 0, openedAt: 't' });
    jest.spyOn(liveLog, 'awaitMarker').mockImplementation(async (_w, spec) =>
      lines.find(l => l.includes(spec.marker) && (spec.match?.(l) ?? true)) ?? null,
    );
  });

  const loan = (over: Partial<LoanInfo> = {}): LoanInfo => ({
    bank: 'Main Bank', date: '1/1/2100', amount: '500', interest: 3, term: 10, slice: '50', loanIndex: 0, ...over,
  });

  describe('loanDelta and newLoan', () => {
    it('reads an unchanged list as nothing new and nothing gone', () => {
      expect(loanDelta([loan()], [loan()])).toBe('new=none gone=0');
    });

    it('does not read a yearly slice lowering an old loan as a new loan', () => {
      expect(loanDelta([loan()], [loan({ amount: '450' })])).toBe('new=none gone=0');
      expect(newLoan([loan()], [loan({ amount: '450' })])).toBeUndefined();
    });

    it('finds a new $1 loan sharing an old loan\'s bank and date', () => {
      const now = [loan(), loan({ amount: '1', loanIndex: 1 })];
      expect(loanDelta([loan()], now)).toBe('new=1 gone=0');
      expect(newLoan([loan()], now)).toMatchObject({ amount: '1', loanIndex: 1 });
    });

    it('counts a baseline loan no longer listed as gone, and ignores a new loan of another amount', () => {
      expect(loanDelta([loan(), loan({ date: '2/2/2100' })], [loan()])).toBe('new=none gone=1');
      expect(newLoan([], [loan({ amount: '7', date: 'x' })])).toBeUndefined();
    });
  });

  describe('bank-borrow-payoff', () => {
    interface BankWorld {
      balance: string;
      loans: LoanInfo[];
      borrowRefused?: boolean;
      /** The borrow answers success but the loan never shows up (a failed proof). */
      borrowIgnored?: boolean;
      payoffRefused?: boolean;
      /** The Survival line the borrow logs, if not the real one. */
      logLine?: string;
      /** A loan appears between the baseline read and the round trip's original read. */
      driftOnSecondRead?: boolean;
    }
    function drive(world: BankWorld): void {
      let reads = 0;
      jest.spyOn(session, 'login').mockResolvedValue(
        stubFor(PRIMARY_ACCOUNT, msg => {
          if (msg.type === WsMessageType.REQ_PROFILE_BANK) {
            reads++;
            if (world.driftOnSecondRead && reads === 2) world.loans.push(loan({ bank: 'Other', loanIndex: world.loans.length }));
            return { data: { balance: world.balance, maxLoan: '0', totalLoans: '0', totalNextPayment: '0', loans: structuredClone(world.loans), defaultInterest: 0, defaultTerm: 0 } };
          }
          if (msg.type === WsMessageType.REQ_PROFILE_BANK_ACTION) {
            const { action, amount, loanIndex } = msg as unknown as { action: string; amount?: string; loanIndex?: number };
            if (action === 'borrow') {
              if (world.borrowRefused) return { result: { success: false, message: 'refused' } };
              lines.push(world.logLine ?? ` AskLoan: ${ME}, $${amount}`);
              if (!world.borrowIgnored) {
                world.loans.push(loan({ date: '3/3/2100', amount: amount ?? '', loanIndex: world.loans.length }));
              }
              return { result: { success: true, message: 'ok' } };
            }
            if (world.payoffRefused) return { result: { success: false, message: 'payoff was not applied' } };
            world.loans = world.loans.filter(l => l.loanIndex !== loanIndex).map((l, i) => ({ ...l, loanIndex: i }));
            return { result: { success: true, message: 'ok' } };
          }
          throw new Error(`unexpected ${msg.type}`);
        }),
      );
    }
    const actions = () =>
      sentOf(WsMessageType.REQ_PROFILE_BANK_ACTION).map(e => `${e.msg.action} ${e.msg.amount ?? e.msg.loanIndex}`);
    const run = () => flowByName('bank-borrow-payoff').run(flowCtx());

    it('mutates, borrows $1, proves it by the AskLoan: line and the list, pays that loan off — PASS', async () => {
      expect(flowByName('bank-borrow-payoff').mutates).toBe(true);
      const world: BankWorld = { balance: '1000', loans: [loan(), loan({ bank: 'B2', loanIndex: 1 })] };
      drive(world);
      const result = await run();
      expect(result.status).toBe('PASS');
      expect(actions()).toEqual(['borrow 1', 'payoff 2']);
      expect(result.probes[0]).toMatchObject({ member: 'RDOAskLoan', original: 'new=none gone=0', written: 'new=1 gone=0', restored: true });
      expect(result.probes[0].logLine).toContain(`AskLoan: ${ME}, $1`);
      expect(world.loans).toHaveLength(2);
      expect(lock.read().pendingRestores).toEqual([]);
    });

    it.each(['0', '-250'])('borrows nothing when the balance is %s — UNPROVEN', async balance => {
      drive({ balance, loans: [] });
      const result = await run();
      expect(result.status).toBe('UNPROVEN');
      expect(result.unproven.join()).toMatch(/Kernel\/Kernel\.pas:11572/);
      expect(actions()).toEqual([]);
    });

    it('still runs the restore after a failed write: nothing to pay off, pending cleared', async () => {
      drive({ balance: '1000', loans: [], borrowRefused: true });
      const result = await run();
      expect(result.status).toBe('FAIL');
      expect(result.probes[0].note).toMatch(/borrow refused/);
      expect(result.probes[0].restored).toBe(true);
      expect(actions()).toEqual(['borrow 1']);
      expect(lock.read().pendingRestores).toEqual([]);
    });

    it('FAILs a borrow that is never listed (a failed proof), after trying the restore', async () => {
      drive({ balance: '1000', loans: [], borrowIgnored: true });
      const result = await run();
      expect(result.status).toBe('FAIL');
      expect(result.probes[0].readBack).toBe('UNCONFIRMED');
      expect(result.probes[0].restoreReadBack).toBe('CONFIRMED');
    });

    it('FAILs a refused payoff and keeps the pending restore naming the loan', async () => {
      drive({ balance: '1000', loans: [loan()], payoffRefused: true });
      const result = await run();
      expect(result.status).toBe('FAIL');
      expect(actions()).toEqual(['borrow 1', 'payoff 1']);
      expect(result.probes[0].restored).toBe(false);
      expect(result.probes[0].note).toMatch(/restore failed — the world is left dirty/);
      const pending = lock.read().pendingRestores;
      expect(pending).toHaveLength(1);
      expect(pending[0].what).toMatch(/\$1 loan from the main bank — pay off the \$1 loan not among the 1 loans/);
    });

    it('does not take "AskLoan: SPO_test3, $10" for the $1 borrow', async () => {
      drive({ balance: '1000', loans: [], logLine: ` AskLoan: ${ME}, $10` });
      const result = await run();
      expect(result.status).toBe('FAIL');
      expect(result.probes[0].logLine).toBeNull();
    });

    it('refuses to borrow when the loan list moved between the baseline and the round trip', async () => {
      drive({ balance: '1000', loans: [], driftOnSecondRead: true });
      const result = await run();
      expect(result.status).toBe('FAIL');
      expect(result.probes[0].note).toMatch(/moved before the borrow/);
      expect(actions()).toEqual([]);
    });

    it('looks the Survival log up when the run did not resolve one', async () => {
      drive({ balance: '1000', loans: [] });
      const find = jest.spyOn(liveLog, 'findCurrentSurvivalLog').mockResolvedValue('http://found/S.log');
      const result = await flowByName('bank-borrow-payoff').run({ ...flowCtx(), survivalLogUrl: undefined });
      expect(find).toHaveBeenCalled();
      expect(result.status).toBe('PASS');
    });
  });

  describe('bank-send-return', () => {
    interface Notice { header: MailMessageHeader; body: string[] }
    type Box = Record<'Inbox' | 'Sent', Notice[]>;
    interface SendWorld {
      banks: Record<string, { maxTransfer?: string; transferDenied?: 'loans' }>;
      profiles: Record<string, Partial<TycoonProfileFull>>;
      boxes: Record<string, Box>;
      /** Which loginSecondary calls (1-based) are refused. */
      refuseSecondary?: number[];
      refuseOut?: boolean;
      refuseBack?: boolean;
      /** The send answers success, but no notice ever reaches Crazz. */
      dropOutNotice?: boolean;
      /** REQ_MAIL_DELETE is a no-op. */
      deletesIgnored?: boolean;
    }
    let seq = 0;
    function notice(from: string, to: string, reason: string, box: 'Inbox' | 'Sent'): Notice {
      seq++;
      return {
        header: {
          messageId: `${box}-${seq}`, fromAddr: `${from}@x`, toAddr: `${to}@x`, from, to,
          subject: '$1 successfully transferred.', date: '1', dateFmt: '', read: false, stamp: 0, noReply: true,
        },
        body: [
          '<HEAD>',
          `<META HTTP-EQUIV="REFRESH" CONTENT="0; URL=http://10.0.0.7/msgs/MoneySendNotification.asp?From=${from}&To=${to}&Reason=${reason}&Amount=1">`,
          '</HEAD>',
        ],
      };
    }
    const emptyBox = (): Box => ({ Inbox: [], Sent: [] });
    const goodProfile: Partial<TycoonProfileFull> = { nobPoints: 10, levelTier: 1, levelName: 'Entrepreneur' };
    function world(over: Partial<SendWorld> = {}): SendWorld {
      return {
        banks: { [ME]: { maxTransfer: '5000' }, [HIM]: { maxTransfer: '300' } },
        profiles: { [ME]: goodProfile, [HIM]: goodProfile },
        boxes: { [ME]: emptyBox(), [HIM]: emptyBox() },
        ...over,
      };
    }
    function responder(w: SendWorld, account: typeof PRIMARY_ACCOUNT): (msg: WsMessage) => unknown {
      const who = account.username;
      return msg => {
        const m = msg as unknown as Record<string, string>;
        switch (msg.type) {
          case WsMessageType.REQ_MAIL_CONNECT: return {};
          case WsMessageType.REQ_PROFILE_BANK:
            return { data: { balance: '9', maxLoan: '0', totalLoans: '0', totalNextPayment: '0', loans: [], defaultInterest: 0, defaultTerm: 0, ...w.banks[who] } };
          case WsMessageType.REQ_GET_PROFILE:
            return { profile: { name: who, ...w.profiles[who] } };
          case WsMessageType.REQ_MAIL_GET_FOLDER:
            return { messages: w.boxes[who][m.folder as 'Inbox' | 'Sent'].map(n => n.header) };
          case WsMessageType.REQ_MAIL_READ_MESSAGE: {
            const n = w.boxes[who][m.folder as 'Inbox' | 'Sent'].find(x => x.header.messageId === m.messageId);
            if (!n) throw new Error('no such message');
            return { message: { ...n.header, body: n.body, attachments: [] } };
          }
          case WsMessageType.REQ_MAIL_DELETE: {
            const box = w.boxes[who];
            const f = m.folder as 'Inbox' | 'Sent';
            if (!w.deletesIgnored) box[f] = box[f].filter(x => x.header.messageId !== m.messageId);
            return { success: true };
          }
          case WsMessageType.REQ_PROFILE_BANK_ACTION: {
            const to = m.toTycoon;
            if ((who === ME && w.refuseOut) || (who === HIM && w.refuseBack)) {
              return { result: { success: false, message: 'refused' } };
            }
            w.boxes[who].Sent.push(notice(who, to, m.reason, 'Sent'));
            if (!(who === ME && w.dropOutNotice)) w.boxes[to].Inbox.push(notice(who, to, m.reason, 'Inbox'));
            return { result: { success: true, message: 'ok' } };
          }
        }
        throw new Error(`unexpected ${msg.type}`);
      };
    }
    function drive(w: SendWorld): void {
      let secondary = 0;
      jest.spyOn(session, 'login').mockImplementation(async account => stubFor(account, responder(w, account)));
      jest.spyOn(session, 'loginSecondary').mockImplementation(async () => {
        secondary++;
        if (w.refuseSecondary?.includes(secondary)) return { skipped: 'Crazz refused' };
        return stubFor(SECONDARY_ACCOUNT, responder(w, SECONDARY_ACCOUNT));
      });
    }
    const sends = () =>
      sentOf(WsMessageType.REQ_PROFILE_BANK_ACTION).map(e => `${e.account}->${e.msg.toTycoon} ${e.msg.amount} ${e.msg.reason}`);
    const run = () => flowByName('bank-send-return').run(flowCtx());

    it('mutates; sends $1 to Crazz and back, matched by Reason=<marker>, and the cleanup deletes four notices — PASS', async () => {
      expect(flowByName('bank-send-return').mutates).toBe(true);
      const w = world();
      // A decoy with the same subject and another reason: never matched, never deleted.
      w.boxes[ME].Inbox.push(notice(HIM, ME, 'birthday', 'Inbox'));
      drive(w);
      const result = await run();
      expect(result.status).toBe('PASS');
      const s = sends();
      expect(s).toHaveLength(2);
      expect(s[0]).toMatch(new RegExp(`^${ME}->${HIM} 1 e2e-send-\\d+-out$`));
      expect(s[1]).toMatch(new RegExp(`^${HIM}->${ME} 1 e2e-send-\\d+-back$`));
      expect(result.probes[0]).toMatchObject({ member: 'RDOSendMoney', original: '0', written: '1', restored: true, logLine: null });
      expect(sentOf(WsMessageType.REQ_MAIL_DELETE)).toHaveLength(4);
      expect(w.boxes[ME].Inbox.map(n => n.body[1])).toEqual([expect.stringContaining('Reason=birthday&')]);
      expect(result.cleanup?.every(c => c.ok)).toBe(true);
      expect(result.cleanup).toHaveLength(4);
      expect(lock.read().pendingRestores).toEqual([]);
    });

    it('ends SKIPPED with nothing sent when Crazz is refused before the first send', async () => {
      drive(world({ refuseSecondary: [1] }));
      const result = await runFlow(flowByName('bank-send-return'), flowCtx());
      expect(result.status).toBe('SKIPPED');
      expect(result.skipped).toBe('Crazz refused');
      expect(sends()).toEqual([]);
    });

    it.each([
      ['a denied transfer', { transferDenied: 'loans' as const }],
      ['no transfer note', {}],
      ['a $0 ceiling', { maxTransfer: '0' }],
    ])('sends nothing when SPO_test3\'s own page offers %s — UNPROVEN', async (_label, bank) => {
      const w = world();
      w.banks[ME] = bank;
      drive(w);
      const result = await run();
      expect(result.status).toBe('UNPROVEN');
      expect(result.unproven.join()).toMatch(new RegExp(`${ME} cannot send \\$1`));
      expect(sends()).toEqual([]);
    });

    it('sends nothing when Crazz\'s page does not offer the transfer back — UNPROVEN', async () => {
      const w = world();
      w.banks[HIM] = { transferDenied: 'loans' };
      drive(w);
      const result = await run();
      expect(result.status).toBe('UNPROVEN');
      expect(result.unproven.join()).toMatch(new RegExp(`${HIM} cannot send \\$1 back`));
      expect(sends()).toEqual([]);
    });

    it.each([
      [ME, { nobPoints: 50 }, /50 nobility points/],
      [HIM, { levelTier: 6, levelName: 'BeyondLegend' }, /level tier 6/],
      [ME, { levelName: '' }, /no level name/],
      [HIM, { levelName: 'Baron' }, /"Baron" is not one/],
    ])('sends nothing when %s\'s profile reads %o — UNPROVEN', async (who, profile, reason) => {
      const w = world();
      w.profiles[who] = { ...goodProfile, ...profile };
      drive(w);
      const result = await run();
      expect(result.status).toBe('UNPROVEN');
      expect(result.unproven.join()).toMatch(reason);
      expect(sends()).toEqual([]);
      // Each profile is read through that account's own session.
      const reads = sentOf(WsMessageType.REQ_GET_PROFILE).map(e => e.account);
      expect(reads).toEqual(who === ME ? [ME] : [ME, HIM]);
    });

    it('FAILs, never SKIPPED, with the pending restore kept when the notice never reaches Crazz', async () => {
      drive(world({ dropOutNotice: true }));
      const result = await runFlow(flowByName('bank-send-return'), flowCtx());
      expect(result.status).toBe('FAIL');
      expect(result.probes[0].readBack).toBe('UNCONFIRMED');
      expect(lock.read().pendingRestores).toHaveLength(1);
      expect(lock.read().pendingRestores[0].what).toMatch(/\$1 sent by SPO_test3 to Crazz .* owes SPO_test3 \$1 back/);
    });

    it('FAILs with the pending restore kept when Crazz\'s send back is refused', async () => {
      drive(world({ refuseBack: true }));
      const result = await run();
      expect(result.status).toBe('FAIL');
      expect(result.probes[0].restored).toBe(false);
      expect(sends()).toHaveLength(2);
      expect(lock.read().pendingRestores).toHaveLength(1);
    });

    it('FAILs a refused first send and sends nothing back', async () => {
      drive(world({ refuseOut: true }));
      const result = await run();
      expect(result.status).toBe('FAIL');
      expect(result.probes[0].note).toMatch(/send refused/);
      expect(sends()).toHaveLength(1);
      expect(lock.read().pendingRestores).toEqual([]);
    });

    it('sends nothing when the pre-sweep cannot clear a leftover notice', async () => {
      const w = world({ deletesIgnored: true });
      w.boxes[HIM].Inbox.push(notice(ME, HIM, 'e2e-send-1-out', 'Inbox'));
      drive(w);
      const result = await run();
      expect(result.status).toBe('FAIL');
      expect(result.assertions.find(a => a.what.startsWith('pre-sweep:') && !a.ok)?.what).toMatch(/Crazz's Inbox/);
      expect(sends()).toEqual([]);
    });

    it('FAILs when Crazz is refused at the cleanup, after the pair', async () => {
      drive(world({ refuseSecondary: [2] }));
      const result = await run();
      expect(result.status).toBe('FAIL');
      expect(result.cleanup?.filter(c => c.skipped === 'Crazz refused')).toHaveLength(2);
    });

    it('turns a drive that throws into a FAIL, and a cleanup login that throws into failed checks', async () => {
      const w = world();
      drive(w);
      jest.spyOn(session, 'login').mockRejectedValue(new Error('gateway down'));
      const result = await run();
      expect(result.status).toBe('FAIL');
      expect(result.error).toBe('gateway down');
      expect(result.cleanup?.filter(c => !c.ok && c.detail === 'gateway down')).toHaveLength(2);
    });

    it('fails a cleanup check whose mailbox cannot be listed', async () => {
      const w = world();
      drive(w);
      const base = responder(w, SECONDARY_ACCOUNT);
      let secondary = 0;
      jest.spyOn(session, 'loginSecondary').mockImplementation(async () => {
        secondary++;
        return stubFor(SECONDARY_ACCOUNT, msg => {
          if (secondary > 1 && msg.type === WsMessageType.REQ_MAIL_GET_FOLDER) throw new Error('folder died');
          return base(msg);
        });
      });
      const result = await run();
      expect(result.status).toBe('FAIL');
      expect(result.cleanup?.filter(c => !c.ok && c.detail === 'folder died')).toHaveLength(2);
    });

    it('fails every cleanup check of a mailbox whose mail connect throws', async () => {
      const w = world();
      drive(w);
      const base = responder(w, SECONDARY_ACCOUNT);
      let secondary = 0;
      jest.spyOn(session, 'loginSecondary').mockImplementation(async () => {
        secondary++;
        return stubFor(SECONDARY_ACCOUNT, msg => {
          if (secondary > 1 && msg.type === WsMessageType.REQ_MAIL_CONNECT) throw new Error('mail died');
          return base(msg);
        });
      });
      const result = await run();
      expect(result.status).toBe('FAIL');
      expect(result.cleanup?.filter(c => !c.ok && c.detail === 'mail died')).toHaveLength(2);
    });
  });

  describe('portrait-roundtrip', () => {
    const IP = '10.0.0.7';
    /** A valid 150×200 JPEG that is not the test image. */
    function original(): Buffer {
      const b = Buffer.from(testPortraitJpeg());
      b[10] = 0x02; // one DQT entry
      return b;
    }
    interface PortraitWorld {
      stored: Buffer | null;
      /** The first upload is stored with its last byte flipped. */
      corruptFirst?: boolean;
      failFirstUpload?: boolean;
      noIp?: boolean;
    }
    let urls: string[];
    let uploads: Buffer[];
    let pendingAtUpload: string[][];
    function drive(w: PortraitWorld): void {
      urls = [];
      uploads = [];
      pendingAtUpload = [];
      jest.spyOn(global, 'fetch').mockImplementation(async input => {
        urls.push(String(input));
        const bytes = w.stored;
        return {
          ok: bytes !== null,
          status: bytes !== null ? 200 : 404,
          arrayBuffer: async () => Uint8Array.from(bytes ?? []).buffer,
        } as unknown as Response;
      });
      jest.spyOn(session, 'login').mockImplementation(async account => {
        const s = stubFor(account, msg => {
          if (msg.type === WsMessageType.REQ_PROFILE_UPLOAD_PICTURE) {
            pendingAtUpload.push(lock.read().pendingRestores.map(p => p.originalValue));
            const bytes = Buffer.from((msg as unknown as { pictureBase64: string }).pictureBase64, 'base64');
            uploads.push(bytes);
            if (w.failFirstUpload && uploads.length === 1) return { success: false, reason: 'SERVER_ERROR', message: 'save failed' };
            const copy = Buffer.from(bytes);
            if (w.corruptFirst && uploads.length === 1) copy[copy.length - 1] ^= 0x01;
            w.stored = copy;
            return { success: true };
          }
          throw new Error(`unexpected ${msg.type}`);
        });
        return w.noIp ? { ...s, world: undefined } : s;
      });
    }
    const run = () => flowByName('portrait-roundtrip').run(flowCtx());

    it('mutates; fetches the original directly, uploads the test JPEG then the original — PASS', async () => {
      expect(flowByName('portrait-roundtrip').mutates).toBe(true);
      const orig = original();
      const w: PortraitWorld = { stored: orig };
      drive(w);
      const result = await run();
      expect(result.status).toBe('PASS');
      expect(urls.length).toBeGreaterThan(0);
      expect(urls.every(u => u === `http://${IP}/fivedata/userinfo/planitia/${ME}/largephoto.jpg`)).toBe(true);
      expect(urls.some(u => u.includes('proxy-image'))).toBe(false);
      expect(uploads).toEqual([testPortraitJpeg(), orig]);
      expect(w.stored).toEqual(orig);
      expect(result.probes[0]).toMatchObject({ member: 'PictureUpload', restored: true, logLine: null });
      expect(lock.read().pendingRestores).toEqual([]);
    });

    it('saves the original bytes in the pending restore before the test upload', async () => {
      const orig = original();
      drive({ stored: orig });
      await run();
      expect(pendingAtUpload[0]).toEqual([orig.toString('base64')]);
    });

    it('uploads nothing when the original is missing (HTTP 404) — UNPROVEN', async () => {
      drive({ stored: null });
      const result = await run();
      expect(result.status).toBe('UNPROVEN');
      expect(result.unproven.join()).toMatch(/HTTP 404/);
      expect(uploads).toEqual([]);
    });

    it.each([
      ['wrong dimensions', (() => { const b = original(); b[78] = 0x00; b[79] = 0x97; return b; })(), 'WRONG_DIMENSIONS'],
      ['not a JPEG', Buffer.from('\x89PNG\r\n\x1a\n'), 'NOT_A_JPEG'],
      ['too large', Buffer.concat([original(), Buffer.alloc(33 * 1024)]), 'TOO_LARGE'],
    ])('uploads nothing when the original fails the picture checks (%s) — UNPROVEN', async (_label, bytes, reason) => {
      drive({ stored: bytes });
      const result = await run();
      expect(result.status).toBe('UNPROVEN');
      expect(result.unproven.join()).toContain(reason);
      expect(uploads).toEqual([]);
    });

    it('FAILs without uploading, world marked dirty, when the original is the test JPEG', async () => {
      drive({ stored: testPortraitJpeg() });
      const result = await run();
      expect(result.status).toBe('FAIL');
      expect(uploads).toEqual([]);
      expect(lock.read().pendingRestores).toHaveLength(1);
      expect(lock.read().pendingRestores[0].what).toMatch(/is the e2e test image/);
      expect(() => lock.release()).toThrow(WorldDirtyError);
    });

    it('FAILs when the re-fetch differs by one byte from the upload, and still uploads the original', async () => {
      const orig = original();
      const w: PortraitWorld = { stored: orig, corruptFirst: true };
      drive(w);
      const result = await run();
      expect(result.status).toBe('FAIL');
      expect(result.probes[0].readBack).toBe('UNCONFIRMED');
      expect(uploads).toEqual([testPortraitJpeg(), orig]);
      expect(w.stored).toEqual(orig);
      expect(lock.read().pendingRestores).toEqual([]);
    });

    it('FAILs a refused upload and still restores', async () => {
      const orig = original();
      drive({ stored: orig, failFirstUpload: true });
      const result = await run();
      expect(result.status).toBe('FAIL');
      expect(result.probes[0].note).toMatch(/upload refused: SERVER_ERROR save failed/);
      expect(uploads).toHaveLength(2);
    });

    it('FAILs when the login carried no world IP', async () => {
      drive({ stored: original(), noIp: true });
      const result = await run();
      expect(result.status).toBe('FAIL');
      expect(urls).toEqual([]);
    });
  });

  describe('the picture check', () => {
    const test = testPortraitJpeg();
    function withSof(width: number, height: number): Buffer {
      const b = Buffer.from(test);
      b.writeUInt16BE(height, 76);
      b.writeUInt16BE(width, 78);
      return b;
    }
    it.each([
      ['the test JPEG', test],
      ['an empty buffer', Buffer.alloc(0)],
      ['text', Buffer.from('hello')],
      ['151×200', withSof(151, 200)],
      ['150×201', withSof(150, 201)],
      ['a DHT-only JPEG', Buffer.from([0xff, 0xd8, 0xff, 0xc4, 0x00, 0x03, 0x00])],
      ['a JPEG padded past 32 KiB', Buffer.concat([test, Buffer.alloc(32 * 1024)])],
      ['a truncated header', test.subarray(0, 75)],
      ['scan data before any frame', Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02])],
      ['a standalone marker then garbage', Buffer.from([0xff, 0xd8, 0xff, 0xd0, 0x12])],
      ['a fill-byte run to the end', Buffer.from([0xff, 0xd8, 0xff, 0xff])],
      ['a marker with no length', Buffer.from([0xff, 0xd8, 0xff, 0xc0])],
    ])('agrees with validatePicture on %s', (_label, bytes) => {
      expect(pictureCheck(bytes)).toBe(validatePicture(bytes)?.reason ?? null);
    });

    it('builds the same 150×200 test JPEG every time, under 32 KiB', () => {
      expect(testPortraitJpeg()).toEqual(test);
      expect(pictureCheck(test)).toBeNull();
      expect(test.length).toBeLessThanOrEqual(32 * 1024);
    });

    it('never builds a proxy-image URL', () => {
      expect(portraitUrl('1.2.3.4', 'planitia', 'A B')).toBe('http://1.2.3.4/fivedata/userinfo/planitia/A%20B/largephoto.jpg');
    });
  });

  describe('receiverLimitRefusal', () => {
    const profile = (over: Partial<TycoonProfileFull>): TycoonProfileFull =>
      ({ nobPoints: 0, levelTier: 0, levelName: 'Apprentice', ...over }) as TycoonProfileFull;
    it('accepts every mapped level name, any case, under the limits', () => {
      for (const name of PROFILE_LEVEL_NAMES) {
        expect(receiverLimitRefusal(PRIMARY_ACCOUNT, profile({ levelName: name.toUpperCase(), nobPoints: 49, levelTier: 5 }))).toBeNull();
      }
    });
    it('refuses at 50 nobility points and at tier 6', () => {
      expect(receiverLimitRefusal(PRIMARY_ACCOUNT, profile({ nobPoints: 50 }))).toMatch(/≥ 50/);
      expect(receiverLimitRefusal(PRIMARY_ACCOUNT, profile({ levelTier: 6 }))).toMatch(/≥ 6/);
    });
    it('refuses an empty or unmapped level name', () => {
      expect(receiverLimitRefusal(SECONDARY_ACCOUNT, profile({ levelName: '  ' }))).toMatch(/Crazz's profile has no level name/);
      expect(receiverLimitRefusal(SECONDARY_ACCOUNT, profile({ levelName: 'Unknown' }))).toMatch(/not one parseCurriculumHtml/);
    });
  });
});

describe('road-roundtrip and zone-roundtrip (#1151)', () => {
  const HALL = { name: 'Helartia', iconUrl: '', mayor: null, population: 1, unemploymentPercent: 0, qualityOfLife: 0, x: 100, y: 50, path: '', classId: '' };
  const OWN = { id: '1', name: 'SPO_test3 - Green' };
  const MINISTRY = { id: '9', name: 'Ministry', ownerRole: 'Minister of Agriculture' };
  const MAYOR = { id: '7', name: 'Helartia Town', ownerRole: 'Mayor of Helartia' };
  /** Helartia, besides the hall tile: 95..97 × 44..45. The one road span is (95,45)-(97,45), the one zone rectangle (95,44)-(97,45). */
  const REGION = (x: number, y: number): boolean => x >= 95 && x <= 97 && y >= 44 && y <= 45;
  /** An existing road two rows above the region: every rectangle tile is within 3 of it, no span halo touches it. */
  const STREET = { x1: 90, y1: 42, x2: 110, y2: 42 };

  interface Seg { x1: number; y1: number; x2: number; y2: number }
  interface World {
    helartia?: (x: number, y: number) => boolean;
    zone?: (x: number, y: number) => number;
    buildings?: { x: number; y: number; visualClass: string }[];
    segments?: Seg[];
    switchFails?: (n: number) => boolean;
    throwOn?: WsMessageType;
    buildRefused?: boolean;
    ignoreBuild?: boolean;
    /** The first n breaks change nothing. */
    ignoreBreaks?: number;
    ignoreWipe?: boolean;
    breakDeletesWhole?: boolean;
    /** The build also leaves a segment reaching two tiles past the span's start. */
    foreignAfterBuild?: boolean;
    silent?: { build?: boolean; break?: boolean; wipe?: boolean };
    /** 1-based DefineZone writes whose line is never logged / that change nothing. */
    silentZone?: number[];
    ignoreZone?: number[];
  }

  let lines: string[];
  let lock: WorldLock;
  let sent: WsMessage[];
  let pendingAtFirstWrite: string[] | undefined;

  function jumpingClock(): () => number {
    let t = 0;
    return () => (t += TIMEOUTS.readBack + 1);
  }
  function flowCtx() {
    return { lock, survivalLogUrl: 'http://logs/S.log', sleep: jest.fn(async () => undefined), now: jumpingClock() };
  }

  beforeEach(() => {
    lines = [];
    sent = [];
    pendingAtFirstWrite = undefined;
    lock = cleanLock();
    jest.spyOn(session, 'logoff').mockResolvedValue(undefined);
    jest.spyOn(liveLog, 'openLogWindow').mockResolvedValue({ url: 'http://logs/S.log', offset: 0, openedAt: 't' });
    jest.spyOn(liveLog, 'awaitMarker').mockImplementation(async (_w, spec) =>
      lines.find(l => l.includes(spec.marker) && (spec.match?.(l) ?? true)) ?? null,
    );
  });

  const box = (s: Seg): Seg => ({
    x1: Math.min(s.x1, s.x2), y1: Math.min(s.y1, s.y2), x2: Math.max(s.x1, s.x2), y2: Math.max(s.y1, s.y2),
  });
  const touches = (a: Seg, b: Seg): boolean => a.x1 <= b.x2 && b.x1 <= a.x2 && a.y1 <= b.y2 && b.y1 <= a.y2;

  function drive(world: World = {}): void {
    const helartia = world.helartia ?? REGION;
    const zones = new Map<string, number>();
    const zoneAt = (x: number, y: number) => zones.get(`${x},${y}`) ?? world.zone?.(x, y) ?? 0;
    let segments: Seg[] = (world.segments ?? [STREET]).map(box);
    const buildings = world.buildings ?? [{ x: HALL.x, y: HALL.y, visualClass: '5' }];
    let switches = 0;
    let breaks = 0;
    let zoneWrites = 0;
    const firstWrite = () => {
      pendingAtFirstWrite ??= lock.read().pendingRestores.map(p => p.what);
    };
    const stub = { ...stubSession(raw => {
      sent.push(raw);
      if (raw.type === world.throwOn) throw new Error(`${raw.type} died`);
      const msg = raw as unknown as Record<string, number> & { surfaceType: string };
      switch (raw.type) {
        case WsMessageType.REQ_SEARCH_MENU_TOWNS:
          return { towns: [HALL] };
        case WsMessageType.REQ_SWITCH_COMPANY:
          if (world.switchFails?.(++switches)) throw new WsDriverError('refused', 42, raw.type);
          return { result: '' };
        case WsMessageType.REQ_GET_SURFACE: {
          const rows: number[][] = [];
          for (let y = msg.y1; y <= msg.y2; y++) {
            const row: number[] = [];
            for (let x = msg.x1; x <= msg.x2; x++) {
              if (msg.surfaceType === 'TOWNS') row.push((x === HALL.x && y === HALL.y) || helartia(x, y) ? 1 : 2);
              else row.push(zoneAt(x, y));
            }
            rows.push(row);
          }
          return { data: { width: 0, height: 0, rows } };
        }
        case WsMessageType.REQ_MAP_LOAD: {
          const area = { x1: msg.x, y1: msg.y, x2: msg.x + msg.width - 1, y2: msg.y + msg.height - 1 };
          return {
            data: {
              buildings: buildings.filter(b => b.x >= area.x1 && b.x <= area.x2 && b.y >= area.y1 && b.y <= area.y2),
              segments: segments.filter(s => touches(s, area)),
            },
          };
        }
        case WsMessageType.REQ_GET_ALL_FACILITY_DIMENSIONS:
          return { dimensions: { '5': { xsize: 3, ysize: 3 }, W: { xsize: 3, ysize: 2 } }, civicVisualClassIds: [] };
        case WsMessageType.REQ_BUILD_ROAD: {
          firstWrite();
          if (world.buildRefused) return { success: false, cost: 0, tileCount: 0, message: 'refused' };
          if (!world.silent?.build) lines.push(`12:00:00 CreateCircuitSeg: 1, 87654321, ${msg.x1}, ${msg.y1}, ${msg.x2}, ${msg.y2}`);
          if (!world.ignoreBuild) segments.push(box(msg as unknown as Seg));
          if (world.foreignAfterBuild) segments.push({ x1: msg.x1 - 2, y1: msg.y1, x2: msg.x1, y2: msg.y1 });
          return { success: true, cost: 1, tileCount: 3 };
        }
        case WsMessageType.REQ_DEMOLISH_ROAD: {
          const { x, y } = msg;
          if (!world.silent?.break) lines.push(`12:00:01 BreakCircuit: 1, 87654321, ${x}, ${y}`);
          if (++breaks <= (world.ignoreBreaks ?? 0)) return { success: true };
          const hit = segments.find(s => x >= s.x1 && x <= s.x2 && y >= s.y1 && y <= s.y2);
          if (!hit) return { success: false };
          segments = segments.filter(s => s !== hit);
          const horizontal = hit.y1 === hit.y2;
          const [a, b, p] = horizontal ? [hit.x1, hit.x2, x] : [hit.y1, hit.y2, y];
          const part = (from: number, to: number): Seg => (horizontal ? { ...hit, x1: from, x2: to } : { ...hit, y1: from, y2: to });
          // TSegment.MakeHole: within one tile of both ends deletes, an end tile trims, a middle tile splits.
          if (world.breakDeletesWhole || (p - a <= 1 && b - p <= 1)) return { success: true };
          if (p - a <= 1) segments.push(part(p + 1, b));
          else if (b - p <= 1) segments.push(part(a, p - 1));
          else segments.push(part(a, p - 1), part(p + 1, b));
          return { success: true };
        }
        case WsMessageType.REQ_DEMOLISH_ROAD_AREA: {
          if (!world.silent?.wipe) lines.push(`12:00:02 WipingCircuit: 1, 87654321, ${msg.x1}, ${msg.y1}, ${msg.x2}, ${msg.y2}`);
          const area = msg as unknown as Seg;
          if (!world.ignoreWipe) {
            segments = segments.filter(s => !(s.x1 >= area.x1 && s.x2 <= area.x2 && s.y1 >= area.y1 && s.y2 <= area.y2));
          }
          return { success: true };
        }
        case WsMessageType.REQ_DEFINE_ZONE: {
          firstWrite();
          const n = ++zoneWrites;
          if (!world.silentZone?.includes(n)) {
            lines.push(`12:00:03 Defining Zone: ${msg.zoneId}, 12345678, ${msg.x1}, ${msg.y1}, ${msg.x2}, ${msg.y2}`);
          }
          if (!world.ignoreZone?.includes(n)) {
            for (let y = msg.y1; y <= msg.y2; y++) for (let x = msg.x1; x <= msg.x2; x++) zones.set(`${x},${y}`, msg.zoneId);
          }
          return { success: true };
        }
        default:
          throw new Error(`unexpected ${raw.type}`);
      }
    }), companies: [OWN, MINISTRY, MAYOR], company: OWN };
    jest.spyOn(session, 'login').mockResolvedValue(stub);
  }

  const sentOf = (type: WsMessageType) =>
    sent.filter(m => m.type === type).map(m => {
      const { type: _t, wsRequestId: _r, ...rest } = m as unknown as Record<string, unknown>;
      return rest;
    });
  const switched = () => sent
    .filter(m => m.type === WsMessageType.REQ_SWITCH_COMPANY)
    .map(m => (m as unknown as { company: { id: string } }).company.id);
  const check = (r: FlowResult, what: RegExp) => r.assertions.find(a => what.test(a.what));
  const run = (name: string) => runFlow(flowByName(name), flowCtx());

  describe('the log matchers', () => {
    it('matches a circuit line on circuit 1, any tycoon ref, and the coordinates as sent', () => {
      expect(circuitLogMatches('1:00 BreakCircuit: 1, -4521, 95, 45', 'BreakCircuit:', [95, 45])).toBe(true);
      expect(circuitLogMatches('1:00 BreakCircuit: 1, 4521, 95, 451', 'BreakCircuit:', [95, 45])).toBe(false);
      expect(circuitLogMatches('1:00 BreakCircuit: 2, 4521, 95, 45', 'BreakCircuit:', [95, 45])).toBe(false);
      expect(circuitLogMatches('1:00 WipingCircuit: 1, 4521, 95, 45', 'BreakCircuit:', [95, 45])).toBe(false);
    });

    it('matches a zone line on the zone id and the rectangle', () => {
      const rect = { x1: 95, y1: 44, x2: 97, y2: 45 };
      expect(zoneLogMatches('Defining Zone: 3, -77, 95, 44, 97, 45', 3, rect)).toBe(true);
      expect(zoneLogMatches('Defining Zone: 3, 77, 95, 44, 97, 451', 3, rect)).toBe(false);
      expect(zoneLogMatches('Defining Zone: 3, 77, 95, 44, 97, 45', 4, rect)).toBe(false);
      expect(zoneLogMatches('Defining Zone: 31, 77, 95, 44, 97, 45', 3, rect)).toBe(false);
    });
  });

  describe('road-roundtrip', () => {
    it('PASSes: builds the span as the mayor, breaks its start tile, wipes the other two, and switches back', async () => {
      drive();
      const result = await run('road-roundtrip');
      expect(result.status).toBe('PASS');
      expect(switched()).toEqual(['7', '1']);
      expect(pendingAtFirstWrite).toHaveLength(1);
      expect(pendingAtFirstWrite?.[0]).toMatch(/^break the road on \(95,45\)-\(97,45\) as Mayor of Helartia/);
      expect(sentOf(WsMessageType.REQ_BUILD_ROAD)).toEqual([{ x1: 95, y1: 45, x2: 97, y2: 45 }]);
      expect(sentOf(WsMessageType.REQ_DEMOLISH_ROAD)).toEqual([{ x: 95, y: 45 }]);
      expect(sentOf(WsMessageType.REQ_DEMOLISH_ROAD_AREA)).toEqual([{ x1: 96, y1: 45, x2: 97, y2: 45 }]);
      expect(check(result, /CreateCircuitSeg/)?.detail).toContain('CreateCircuitSeg: 1, 87654321, 95, 45, 97, 45');
      expect(check(result, /BreakCircuit/)?.detail).toContain('BreakCircuit: 1, 87654321, 95, 45');
      expect(check(result, /WipingCircuit/)?.detail).toContain('WipingCircuit: 1, 87654321, 96, 45, 97, 45');
      expect(lock.read().pendingRestores).toEqual([]);
    });

    it('takes a vertical span when no horizontal one fits', async () => {
      drive({ helartia: (x, y) => x === 95 && y >= 44 && y <= 46 });
      const result = await run('road-roundtrip');
      expect(result.status).toBe('PASS');
      expect(sentOf(WsMessageType.REQ_BUILD_ROAD)).toEqual([{ x1: 95, y1: 44, x2: 95, y2: 46 }]);
      expect(sentOf(WsMessageType.REQ_DEMOLISH_ROAD)).toEqual([{ x: 95, y: 44 }]);
      expect(sentOf(WsMessageType.REQ_DEMOLISH_ROAD_AREA)).toEqual([{ x1: 95, y1: 45, x2: 95, y2: 46 }]);
    });

    it.each([
      ['no tile of the town', () => false],
      ['a span next to a road', (x: number, y: number) => x >= 95 && x <= 97 && y === 43],
    ])('is UNPROVEN with %s — writes nothing, records nothing, still switches back', async (_label, helartia) => {
      drive({ helartia });
      const result = await run('road-roundtrip');
      expect(result.status).toBe('UNPROVEN');
      expect(result.unproven[0]).toMatch(/no straight 3-tile span inside Helartia/);
      expect(sentOf(WsMessageType.REQ_BUILD_ROAD)).toEqual([]);
      expect(lock.read().pendingRestores).toEqual([]);
      expect(switched()).toEqual(['7', '1']);
    });

    it('is UNPROVEN when a facility footprint covers the span halo', async () => {
      drive({ buildings: [{ x: HALL.x, y: HALL.y, visualClass: '5' }, { x: 92, y: 44, visualClass: 'W' }] });
      const result = await run('road-roundtrip');
      expect(result.status).toBe('UNPROVEN');
      expect(sentOf(WsMessageType.REQ_BUILD_ROAD)).toEqual([]);
    });

    it('FAILs on a throw after the switch, and still switches back', async () => {
      drive({ throwOn: WsMessageType.REQ_MAP_LOAD });
      const result = await run('road-roundtrip');
      expect(result.status).toBe('FAIL');
      expect(check(result, /without a throw/)?.detail).toMatch(/REQ_MAP_LOAD died/);
      expect(switched()).toEqual(['7', '1']);
    });

    it('FAILs when the switch to the mayor is refused, and still sends the switch back', async () => {
      drive({ switchFails: n => n === 1 });
      const result = await run('road-roundtrip');
      expect(result.status).toBe('FAIL');
      expect(result.error).toMatch(/refused/);
      expect(switched()).toEqual(['7', '1']);
      expect(sentOf(WsMessageType.REQ_BUILD_ROAD)).toEqual([]);
    });

    it('FAILs a build whose line is present but whose read-back never shows the road', async () => {
      drive({ ignoreBuild: true });
      const result = await run('road-roundtrip');
      expect(result.status).toBe('FAIL');
      expect(check(result, /covering exactly the span/)?.ok).toBe(false);
      expect(check(result, /CreateCircuitSeg/)?.ok).toBe(true);
      expect(sentOf(WsMessageType.REQ_DEMOLISH_ROAD)).toEqual([]);
      expect(lock.read().pendingRestores).toEqual([]);
    });

    it.each([
      ['build', /CreateCircuitSeg/],
      ['break', /BreakCircuit/],
      ['wipe', /WipingCircuit/],
    ] as const)('FAILs a %s whose read-back holds but whose Survival line never appears', async (step, line) => {
      drive({ silent: { [step]: true } });
      const result = await run('road-roundtrip');
      expect(result.status).toBe('FAIL');
      expect(check(result, line)?.ok).toBe(false);
      expect(result.assertions.filter(a => !a.ok)).toHaveLength(1);
      expect(lock.read().pendingRestores).toEqual([]);
    });

    it('FAILs a break whose read-back never shows it, and the cleanup breaks the leftover tile by tile', async () => {
      drive({ ignoreBreaks: 1 });
      const result = await run('road-roundtrip');
      expect(result.status).toBe('FAIL');
      expect(check(result, /other two tiles left/)?.ok).toBe(false);
      expect(check(result, /BreakCircuit/)?.ok).toBe(true);
      expect(sentOf(WsMessageType.REQ_DEMOLISH_ROAD)).toEqual([{ x: 95, y: 45 }, { x: 95, y: 45 }, { x: 96, y: 45 }]);
      expect(sentOf(WsMessageType.REQ_DEMOLISH_ROAD_AREA)).toEqual([]);
      expect(check(result, /no segment is left/)?.ok).toBe(true);
      expect(lock.read().pendingRestores).toEqual([]);
    });

    it('FAILs a wipe whose read-back never shows it, and the cleanup breaks what is left', async () => {
      drive({ ignoreWipe: true });
      const result = await run('road-roundtrip');
      expect(result.status).toBe('FAIL');
      expect(check(result, /no segment left on the span/)?.ok).toBe(false);
      expect(check(result, /WipingCircuit/)?.ok).toBe(true);
      expect(sentOf(WsMessageType.REQ_DEMOLISH_ROAD)).toEqual([{ x: 95, y: 45 }, { x: 96, y: 45 }]);
      expect(lock.read().pendingRestores).toEqual([]);
    });

    it('FAILs the wipe step when the break removed the whole road, sending no wipe', async () => {
      drive({ breakDeletesWhole: true });
      const result = await run('road-roundtrip');
      expect(result.status).toBe('FAIL');
      expect(check(result, /a segment remained on the span for the wipe/)).toMatchObject({
        ok: false,
        detail: 'the break removed the whole road',
      });
      expect(sentOf(WsMessageType.REQ_DEMOLISH_ROAD_AREA)).toEqual([]);
      expect(lock.read().pendingRestores).toEqual([]);
    });

    it('never touches a segment extending beyond the span, and keeps the pending restore', async () => {
      drive({ foreignAfterBuild: true });
      const result = await run('road-roundtrip');
      expect(result.status).toBe('FAIL');
      expect(sentOf(WsMessageType.REQ_DEMOLISH_ROAD)).toEqual([]);
      expect(sentOf(WsMessageType.REQ_DEMOLISH_ROAD_AREA)).toEqual([]);
      expect(check(result, /no segment is left/)).toMatchObject({ ok: false });
      expect(check(result, /no segment is left/)?.detail).toMatch(/foreign=1 — pending restore kept/);
      expect(lock.read().pendingRestores).toHaveLength(1);
      expect(lock.read().pendingRestores[0].what).toMatch(/\(95,45\)-\(97,45\)/);
    });

    it('FAILs a refused build and leaves the lock clean', async () => {
      drive({ buildRefused: true });
      const result = await run('road-roundtrip');
      expect(result.status).toBe('FAIL');
      expect(check(result, /accepted the road build/)).toMatchObject({ ok: false, detail: 'success=false partial=false refused' });
      expect(sentOf(WsMessageType.REQ_DEMOLISH_ROAD)).toEqual([]);
      expect(lock.read().pendingRestores).toEqual([]);
    });

    it('keeps the pending restore when the cleanup itself throws', async () => {
      drive({ throwOn: WsMessageType.REQ_DEMOLISH_ROAD });
      const result = await run('road-roundtrip');
      expect(result.status).toBe('FAIL');
      expect(check(result, /cleanup ran without a throw/)?.ok).toBe(false);
      expect(lock.read().pendingRestores).toHaveLength(1);
    });
  });

  describe('zone-roundtrip', () => {
    const zonesSent = () => sentOf(WsMessageType.REQ_DEFINE_ZONE).map(m => m.zoneId);

    it.each([
      [0, [3, 0]],
      [3, [4, 3]],
    ])('PASSes from zone %i as the mayor: paints %j, both lines matched', async (original, writes) => {
      drive({ zone: () => original });
      const result = await run('zone-roundtrip');
      expect(result.status).toBe('PASS');
      expect(switched()).toEqual(['7', '1']);
      expect(zonesSent()).toEqual(writes);
      expect(sentOf(WsMessageType.REQ_DEFINE_ZONE)[0]).toMatchObject({ x1: 95, y1: 44, x2: 97, y2: 45 });
      expect(pendingAtFirstWrite).toHaveLength(1);
      expect(pendingAtFirstWrite?.[0]).toMatch(new RegExp(`\\(95,44\\)-\\(97,45\\) in Helartia .* put back "${original}"$`));
      expect(result.probes[0].logLine).toContain(`Defining Zone: ${writes[0]}, 12345678, 95, 44, 97, 45`);
      expect(check(result, /repaint to the original logged/)?.detail).toContain(`Defining Zone: ${original}, 12345678, 95, 44, 97, 45`);
      expect(lock.read().pendingRestores).toEqual([]);
    });

    it.each<[string, World]>([
      ['a non-uniform rectangle', { zone: (x, y) => (x === 97 && y === 45 ? 4 : 0) }],
      ['a footprint whose origin lies outside the rectangle', {
        buildings: [{ x: HALL.x, y: HALL.y, visualClass: '5' }, { x: 93, y: 43, visualClass: 'W' }],
      }],
      ['a rectangle reaching outside Helartia', { helartia: (x, y) => REGION(x, y) && !(x === 97 && y === 45) }],
      ['original zone 1 (Reserved)', { zone: () => 1 }],
      ['original zone 2 (Residential)', { zone: () => 2 }],
      ['no road within reach', { segments: [] }],
    ])('is UNPROVEN on %s — no REQ_DEFINE_ZONE, still switches back', async (_label, world) => {
      drive(world);
      const result = await run('zone-roundtrip');
      expect(result.status).toBe('UNPROVEN');
      expect(result.unproven[0]).toMatch(/no 3×2 rectangle inside Helartia/);
      expect(zonesSent()).toEqual([]);
      expect(lock.read().pendingRestores).toEqual([]);
      expect(switched()).toEqual(['7', '1']);
    });

    it('FAILs when the surface never returns to the original, keeping the pending restore', async () => {
      drive({ ignoreZone: [2] });
      const result = await run('zone-roundtrip');
      expect(result.status).toBe('FAIL');
      expect(result.probes[0].restored).toBe(false);
      expect(lock.read().pendingRestores).toHaveLength(1);
    });

    it('FAILs a paint whose line is present but whose surface never changes', async () => {
      drive({ ignoreZone: [1] });
      const result = await run('zone-roundtrip');
      expect(result.status).toBe('FAIL');
      expect(result.probes[0]).toMatchObject({ readBack: 'UNCONFIRMED', restored: true });
      expect(result.probes[0].logLine).not.toBeNull();
    });

    it('FAILs a paint whose surface changes but whose line is missing', async () => {
      drive({ silentZone: [1] });
      const result = await run('zone-roundtrip');
      expect(result.status).toBe('FAIL');
      expect(result.probes[0]).toMatchObject({ readBack: 'CONFIRMED', logLine: null });
    });

    it('FAILs when the repaint never logs its line', async () => {
      drive({ silentZone: [2] });
      const result = await run('zone-roundtrip');
      expect(result.status).toBe('FAIL');
      expect(result.probes[0].status).toBe('PASS');
      expect(check(result, /repaint to the original logged/)).toMatchObject({ ok: false, detail: '(no line)' });
    });

    it('FAILs on a throw after the switch, and still switches back', async () => {
      drive({ throwOn: WsMessageType.REQ_GET_SURFACE });
      const result = await run('zone-roundtrip');
      expect(result.status).toBe('FAIL');
      expect(result.error).toMatch(/REQ_GET_SURFACE died/);
      expect(switched()).toEqual(['7', '1']);
    });
  });
});

// ---- #1152: inspector flows on SPO_test3's own fixtures -------------------------------------

describe('inspector helpers (#1152)', () => {
  it('nudgeWithin moves ±1 toward the middle and stays inside the range', () => {
    expect(nudgeWithin('150', 0, 255)).toBe('149');
    expect(nudgeWithin('100', 0, 255)).toBe('101');
    expect(nudgeWithin('0', 0, 100)).toBe('1');
    expect(nudgeWithin('100', 0, 100)).toBe('99');
    expect(nudgeWithin('900', 0, 400)).toBe('400');
    expect(nudgeWithin('-5', 0, 150)).toBe('0');
    expect(nudgeWithin('12.6', 0, 150)).toBe('14');
    expect(nudgeWithin('abc', 0, 400)).toBe('200');
    expect(nudgeWithin('', 0, 150)).toBe('75');
  });

  it('evenPriceNudge never produces an odd value, and always moves', () => {
    for (let v = 0; v <= 510; v++) {
      const next = Number(evenPriceNudge(String(v)));
      expect(next % 2).toBe(0);
      expect(next).toBeGreaterThanOrEqual(0);
      expect(next).toBeLessThanOrEqual(500);
      expect(servicePriceQuantised(String(next))).not.toBe(servicePriceQuantised(String(v)));
    }
    expect(evenPriceNudge('100')).toBe('110');
    expect(evenPriceNudge('300')).toBe('290');
    expect(evenPriceNudge('junk')).toBe('100');
    expect(evenPriceNudge(' ')).toBe('100');
  });

  it("servicePriceQuantised is 2*round(v/2) with Delphi's banker's round, capped at 255", () => {
    expect([0.5, 1.5, 2.5, 3.2, 3.7].map(roundHalfEven)).toEqual([0, 2, 2, 3, 4]);
    expect(servicePriceQuantised('110')).toBe('110');
    expect(servicePriceQuantised('5')).toBe('4'); // round(2.5) = 2
    expect(servicePriceQuantised('7')).toBe('8'); // round(3.5) = 4
    expect(servicePriceQuantised('600')).toBe('510');
    expect(servicePriceQuantised('n/a')).toBe('n/a');
  });

  it('facLineMatches wants the facility, the text, then a boundary', () => {
    const line = '12:00 - Fac(30,40) Output price set: Chemicals to 101';
    expect(facLineMatches(line, 30, 40, 'Output price set: Chemicals to 101')).toBe(true);
    expect(facLineMatches(line, 30, 41, 'Output price set: Chemicals to 101')).toBe(false);
    expect(facLineMatches(line, 30, 40, 'Output price set: Chemicals to 10')).toBe(false);
    expect(facLineMatches(`${line} OK`, 30, 40, 'Output price set: Chemicals to 101')).toBe(true);
  });

  it('servicePriceLineMatches and salariesLineMatches pin every field', () => {
    expect(servicePriceLineMatches('1/1 12:00 Service SetPrice: 0, 110', '110')).toBe(true);
    expect(servicePriceLineMatches('1/1 12:00 Service SetPrice: 1, 110', '110')).toBe(false);
    expect(servicePriceLineMatches('1/1 12:00 Service SetPrice: 0, 1100', '110')).toBe(false);
    expect(salariesLineMatches('Setting salaries: 149, 100, 90', '149', '100', '90')).toBe(true);
    expect(salariesLineMatches('Setting salaries: 149, 100, 91', '149', '100', '90')).toBe(false);
    expect(salariesLineMatches('Setting salaries: 150, 100, 90', '149', '100', '90')).toBe(false);
  });

  it('clientLinksDiff compares links by lot and name, and labels them', () => {
    const a = conn('Shop A', 'SPO_test3 - Green', 1, 2);
    const b = conn('Shop B', 'Other Co', 3, 4);
    expect(clientLinksDiff([a, b], [b, a])).toEqual({ lost: [], gained: [] });
    expect(clientLinksDiff([a, b], [a])).toEqual({ lost: ['Shop B (3,4) of Other Co'], gained: [] });
    expect(clientLinksDiff([a], [a, b])).toEqual({ lost: [], gained: ['Shop B (3,4) of Other Co'] });
  });

  it('outputPriceRefusal accepts no client or own clients only, all read', () => {
    const own = conn('Shop A', 'SPO_test3 - Green', 1, 2);
    const base = product({ connections: [], connectionCount: 0 });
    expect(outputPriceRefusal(base, 'SPO_test3 - Green')).toBeNull();
    expect(outputPriceRefusal(product({ connections: [own], connectionCount: 1 }), 'SPO_test3 - Green')).toBeNull();
    expect(outputPriceRefusal(product({ connections: [own, conn('X', 'Other Co', 5, 6)], connectionCount: 2 }), 'SPO_test3 - Green'))
      .toMatch(/another company: X \(5,6\) of Other Co/);
    expect(outputPriceRefusal(product({ connections: [own], connectionCount: 25 }), 'SPO_test3 - Green')).toMatch(/25 client/);
    expect(outputPriceRefusal(product({ pricePc: undefined }), 'SPO_test3 - Green')).toMatch(/header/);
    expect(outputPriceRefusal(undefined, 'SPO_test3 - Green')).toMatch(/header/);
  });

  it('stoppedBit reads bit $04 of Trouble', () => {
    expect(stoppedBit('0')).toBe('0');
    expect(stoppedBit('4')).toBe('1');
    expect(stoppedBit('5')).toBe('1');
    expect(stoppedBit('3')).toBe('0');
    expect(stoppedBit(undefined)).toBeUndefined();
    expect(stoppedBit('')).toBeUndefined();
    expect(stoppedBit('x')).toBeUndefined();
  });

  it('workerCountsProblem names a missing, non-numeric or unasked kind', () => {
    expect(workerCountsProblem([{ kind: 0, workers: 1 }, { kind: 1, workers: 0 }, { kind: 2, workers: 7 }])).toBeNull();
    expect(workerCountsProblem([{ kind: 0, workers: 1 }, { kind: 2, workers: 7 }])).toBe('kind 1 missing');
    expect(workerCountsProblem([{ kind: 0, workers: NaN }, { kind: 1, workers: 0 }, { kind: 2, workers: 7 }]))
      .toBe('kind 0 is not a number');
    expect(workerCountsProblem([{ kind: 0, workers: 1 }, { kind: 1, workers: 0 }, { kind: 2, workers: 7 }, { kind: 5, workers: 1 }]))
      .toBe('unasked kind(s) 5');
  });

  it('refreshMissingKeys names a dropped group and a dropped property', () => {
    const opening = { srvGeneral: [pv('Name', 'a'), pv('Cost', '1')], workforce: [pv('Workers0', '1')] };
    expect(refreshMissingKeys(opening, { ...opening, extra: [] })).toEqual([]);
    expect(refreshMissingKeys(opening, { srvGeneral: [pv('Name', 'b')] })).toEqual(['srvGeneral.Cost', 'workforce']);
  });

  it('fixtureKind finds a kind and refuses an unknown one', () => {
    expect(fixtureKind('store').id).toBe('store');
    expect(() => fixtureKind('nope' as never)).toThrow(/No fixture kind "nope"/);
  });
});

function pv(name: string, value: string): BuildingPropertyValue {
  return { name, value };
}

function conn(facilityName: string, companyName: string, x: number, y: number, overprice = '0'): BuildingConnectionData {
  return {
    facilityName, companyName, createdBy: '', price: '0', overprice, lastValue: '', cost: '$0', quality: '0%',
    connected: true, x, y,
  };
}

function product(over: Partial<BuildingProductData> = {}): BuildingProductData {
  return {
    path: 'Outputs\\Chemicals.five\\', name: 'Chemicals', metaFluid: 'Chemicals', pricePc: '100', connectionCount: 0,
    connections: [], ...over,
  };
}

function supplyGate(over: Partial<BuildingSupplyData> = {}): BuildingSupplyData {
  return {
    path: 'Inputs\\00000000.Water.five\\', name: 'Water', metaFluid: 'Water', maxPrice: '200', minK: '10',
    selected: '1', connectionCount: 1, connections: [conn('Well', 'Other Co', 7, 8, '20')], ...over,
  };
}

describe('inspector flows (#1152)', () => {
  const STORE = { x: 10, y: 20, visualClass: '4601', name: 'Food Store' };
  const INDUSTRY = { x: 30, y: 40, visualClass: '4116', name: 'Farm' };

  interface Write {
    property: string;
    value: string;
    params?: Record<string, string>;
  }

  interface World {
    storeTabs: string[];
    srvPrices0?: string;
    salaries: string[];
    trouble?: string;
    supplies: BuildingSupplyData[];
    products: BuildingProductData[];
    figures: { supply: string; demand: string };
    counts: { kind: number; workers: number }[];
    refreshGroups?: { [id: string]: BuildingPropertyValue[] };
    /** Whether a write moves the value; default yes. */
    apply: (w: Write, n: number) => boolean;
    /** Throw on this write number (1-based). */
    failWrite?: number;
    /** Members whose Survival line never appears. */
    silent: Set<string>;
    /** Runs after each applied write — lets a test move the world. */
    after?: (w: Write, n: number) => void;
    writes: Write[];
    lines: string[];
    requests: WsMessage[];
  }

  function makeWorld(over: Partial<World> = {}): World {
    return {
      storeTabs: ['srvGeneral', 'supplies', 'workforce'],
      srvPrices0: '120',
      salaries: ['150', '100', '90'],
      trouble: '0',
      supplies: [supplyGate()],
      products: [product({ connections: [conn('Own Shop', 'SPO_test3 - Green', 1, 2)], connectionCount: 1 })],
      figures: { supply: '12', demand: '30' },
      counts: [{ kind: 0, workers: 1 }, { kind: 1, workers: 2 }, { kind: 2, workers: 3 }],
      apply: () => true,
      silent: new Set(),
      writes: [],
      lines: [],
      requests: [],
      ...over,
    };
  }

  const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

  function logLine(w: Write): string {
    const fac = (text: string, x = INDUSTRY.x, y = INDUSTRY.y) => `12:00 - Fac(${x},${y}) ${text}`;
    const p = w.params ?? {};
    switch (w.property) {
      case 'RDOSetPrice': return `1/1 12:00 Service SetPrice: ${p.index}, ${w.value}`;
      case 'RDOSetSalaries': return `1/1 12:00 Setting salaries: ${p.salary0}, ${p.salary1}, ${p.salary2}`;
      case 'RDOSetOutputPrice': return fac(`Output price set: ${p.fluidId} to ${w.value}`);
      case 'RDOSetInputMaxPrice': return fac(`Input max price set: ${p.fluidId} to ${w.value}`);
      case 'RDOSetInputMinK': return fac(`Input min K set: ${p.fluidId} to ${w.value}`);
      case 'RDOSetInputOverPrice': return fac(`Input overprice set: ${p.fluidId} to ${w.value}`);
      case 'RDOSetInputSortMode': return '12:00 Changing Sort Mode.. ';
      case 'property': return '12:00 Stopping Facility.';
      default: return '';
    }
  }

  function applyWrite(world: World, w: Write): void {
    const p = w.params ?? {};
    const gateIn = world.supplies.find(s => s.metaFluid === p.fluidId);
    switch (w.property) {
      case 'RDOSetPrice': world.srvPrices0 = servicePriceQuantised(w.value); break;
      case 'RDOSetSalaries': world.salaries = [p.salary0, p.salary1, p.salary2]; break;
      case 'RDOSetOutputPrice': {
        const out = world.products.find(o => o.metaFluid === p.fluidId);
        if (out) out.pricePc = w.value;
        break;
      }
      case 'RDOSetInputMaxPrice': if (gateIn) gateIn.maxPrice = w.value; break;
      case 'RDOSetInputMinK': if (gateIn) gateIn.minK = w.value; break;
      case 'RDOSetInputSortMode': if (gateIn) gateIn.sortMode = w.value; break;
      case 'RDOSelSelected': if (gateIn) gateIn.selected = w.value; break;
      case 'RDOSetInputOverPrice': if (gateIn) gateIn.connections[Number(p.index)].overprice = w.value; break;
      case 'property': {
        const t = Number(world.trouble ?? '0');
        world.trouble = String(w.value === '-1' ? t | 4 : t & ~4);
        break;
      }
    }
  }

  function arrange(world: World, found: { store?: boolean; industry?: boolean } = {}) {
    const stub = stubSession(msg => {
      world.requests.push(msg);
      const m = msg as WsMessage & Record<string, unknown>;
      const isStore = m.x === STORE.x && m.y === STORE.y;
      switch (msg.type) {
        case WsMessageType.REQ_BUILDING_DETAILS:
          return {
            details: isStore
              ? { tabs: world.storeTabs.map(id => ({ id })), groups: { srvGeneral: [pv('Name', 'Food Store'), pv('Cost', '9')] } }
              : { tabs: [{ id: 'indGeneral' }, { id: 'supplies' }, { id: 'products' }], groups: { indGeneral: [pv('Name', 'Farm')] } },
          };
        case WsMessageType.REQ_BUILDING_TAB_DATA: {
          if (m.tabId === 'supplies') return { supplies: world.supplies.map(s => ({ path: s.path, name: s.name, connections: [] })) };
          if (m.tabId === 'products') return { products: world.products.map(o => ({ path: o.path, name: o.name, connections: [] })) };
          if (m.tabId === 'srvGeneral') {
            const g: BuildingPropertyValue[] = [];
            if (world.srvPrices0 !== undefined) g.push(pv('srvPrices0', world.srvPrices0));
            if (world.trouble !== undefined) g.push(pv('Trouble', world.trouble));
            return { groups: { srvGeneral: g } };
          }
          if (m.tabId === 'workforce') return { groups: { workforce: world.salaries.map((v, i) => pv(`Salaries${i}`, v)) } };
          throw new Error(`unexpected tab ${String(m.tabId)}`);
        }
        case WsMessageType.REQ_BUILDING_GATE_CONNECTIONS: {
          if (m.tabId === 'supplies') return { supply: clone(world.supplies.find(s => s.path === m.path)) };
          return { product: clone(world.products.find(o => o.path === m.path)) };
        }
        case WsMessageType.REQ_BUILDING_SET_PROPERTY: {
          const w: Write = { property: String(m.propertyName), value: String(m.value), params: m.additionalParams as Record<string, string> };
          world.writes.push(w);
          const n = world.writes.length;
          if (world.failWrite === n) throw new Error('write rejected');
          const line = logLine(w);
          if (line && !world.silent.has(w.property)) world.lines.push(line);
          if (world.apply(w, n)) applyWrite(world, w);
          world.after?.(w, n);
          return { type: WsMessageType.RESP_BUILDING_SET_PROPERTY, success: true, newValue: '' };
        }
        case WsMessageType.REQ_BUILDING_SERVICE_FIGURES: return world.figures;
        case WsMessageType.REQ_BUILDING_WORKER_COUNTS: return { counts: world.counts };
        case WsMessageType.REQ_BUILDING_REFRESH_PROPERTIES:
          return { details: { groups: world.refreshGroups ?? { srvGeneral: [pv('Name', 'Food Store'), pv('Cost', '9'), pv('ROI', '1')] } } };
        default:
          throw new Error(`unexpected request ${msg.type}`);
      }
    });
    jest.spyOn(session, 'login').mockResolvedValue(stub);
    const off = jest.spyOn(session, 'logoff').mockResolvedValue(undefined);
    const find = jest.spyOn(fixtures, 'findFixture').mockImplementation(async (_s, kind) => {
      if (kind.id === 'store') return found.store === false ? { kind: 'store', reason: 'none in Helartia' } : { kind: 'store', found: STORE };
      return found.industry === false ? { kind: 'industry', reason: 'under construction' } : { kind: 'industry', found: INDUSTRY };
    });
    jest.spyOn(liveLog, 'openLogWindow').mockResolvedValue(logWindow);
    jest.spyOn(liveLog, 'awaitMarker').mockImplementation(async (_w, proof) => {
      if (typeof proof !== 'object') return null;
      return [...world.lines].reverse().find(l => l.includes(proof.marker) && (proof.match?.(l) ?? true)) ?? null;
    });
    return { stub, off, find };
  }

  const run = (name: string, lock = cleanLock()) => flowByName(name).run({ lock, survivalLogUrl: 'u', ...fastClock() });
  const setProps = (world: World) => world.requests.filter(r => r.type === WsMessageType.REQ_BUILDING_SET_PROPERTY);

  describe('inspector-reads', () => {
    it('reads one supply and one product gate, service 0, workers 0..2 and a refresh — and writes nothing', async () => {
      const world = makeWorld();
      const { off } = arrange(world);
      const result = await run('inspector-reads');
      expect(result.status).toBe('PASS');
      expect(result.assertions.every(a => a.ok)).toBe(true);
      const types = world.requests.map(r => r.type);
      expect(types).toContain(WsMessageType.REQ_BUILDING_GATE_CONNECTIONS);
      expect(world.requests).toContainEqual(expect.objectContaining({ type: WsMessageType.REQ_BUILDING_SERVICE_FIGURES, serviceIndex: 0 }));
      expect(world.requests).toContainEqual(expect.objectContaining({ type: WsMessageType.REQ_BUILDING_WORKER_COUNTS, kinds: [0, 1, 2] }));
      expect(world.requests).toContainEqual(expect.objectContaining({ type: WsMessageType.REQ_BUILDING_REFRESH_PROPERTIES, activeTabId: 'srvGeneral' }));
      expect(setProps(world)).toEqual([]);
      expect(off).toHaveBeenCalledTimes(1);
    });

    it('FAILs a missing worker kind, naming it', async () => {
      const world = makeWorld({ counts: [{ kind: 0, workers: 1 }, { kind: 2, workers: 3 }] });
      arrange(world);
      const result = await run('inspector-reads');
      expect(result.status).toBe('FAIL');
      expect(result.assertions.find(a => !a.ok)?.detail).toBe('kind 1 missing');
    });

    it('FAILs a refresh that drops a key of the opening read', async () => {
      const world = makeWorld({ refreshGroups: { srvGeneral: [pv('Name', 'Food Store')] } });
      arrange(world);
      const result = await run('inspector-reads');
      expect(result.status).toBe('FAIL');
      expect(result.assertions.find(a => !a.ok)?.detail).toBe('missing: srvGeneral.Cost');
    });

    it('FAILs empty service figures and a gate with no header', async () => {
      const world = makeWorld({ figures: { supply: '', demand: '3' }, products: [product({ metaFluid: '' })] });
      arrange(world);
      const result = await run('inspector-reads');
      expect(result.status).toBe('FAIL');
      expect(result.assertions.filter(a => !a.ok).map(a => a.what)).toEqual([
        'products gate "Chemicals": header and connections parsed',
        'service 0: supply and demand are present',
      ]);
    });

    it('FAILs an industry that lists no supply gate, and still reads its product gate', async () => {
      const world = makeWorld({ supplies: [] });
      arrange(world);
      const result = await run('inspector-reads');
      expect(result.status).toBe('FAIL');
      expect(result.assertions.filter(a => !a.ok).map(a => a.what)).toEqual(['the industry fixture lists a supplies gate']);
      expect(world.requests).toContainEqual(expect.objectContaining({ type: WsMessageType.REQ_BUILDING_GATE_CONNECTIONS, tabId: 'products' }));
    });

    it('is UNPROVEN, not FAIL, when a fixture is missing — and the other half still runs', async () => {
      const world = makeWorld();
      arrange(world, { industry: false });
      const result = await run('inspector-reads');
      expect(result.status).toBe('UNPROVEN');
      expect(result.unproven).toEqual(['industry fixture — under construction']);
      expect(world.requests.some(r => r.type === WsMessageType.REQ_BUILDING_SERVICE_FIGURES)).toBe(true);
      expect(world.requests.some(r => r.type === WsMessageType.REQ_BUILDING_GATE_CONNECTIONS)).toBe(false);
    });

    it('is UNPROVEN when the store fixture is missing', async () => {
      const world = makeWorld();
      arrange(world, { store: false });
      const result = await run('inspector-reads');
      expect(result.status).toBe('UNPROVEN');
      expect(result.unproven).toEqual(['store fixture — none in Helartia']);
    });
  });

  describe('store-price-salaries', () => {
    it('writes an even price and the whole salary triplet, proves both, and restores both', async () => {
      const world = makeWorld();
      const lock = cleanLock();
      arrange(world);
      const result = await run('store-price-salaries', lock);
      expect(result.status).toBe('PASS');
      expect(world.writes).toEqual([
        { property: 'RDOSetPrice', value: '130', params: { index: '0' } },
        { property: 'RDOSetPrice', value: '120', params: { index: '0' } },
        { property: 'RDOSetSalaries', value: '149', params: { salary0: '149', salary1: '100', salary2: '90' } },
        { property: 'RDOSetSalaries', value: '150', params: { salary0: '150', salary1: '100', salary2: '90' } },
      ]);
      expect(result.probes.map(p => p.logLine)).toEqual([
        '1/1 12:00 Service SetPrice: 0, 130',
        '1/1 12:00 Setting salaries: 149, 100, 90',
      ]);
      expect(world.srvPrices0).toBe('120');
      expect(world.salaries).toEqual(['150', '100', '90']);
      expect(lock.read().pendingRestores).toEqual([]);
    });

    it('passes a read-back of 2*round(v/2), never an odd write', async () => {
      // The published price is the stored half doubled: 131 would read back 132, so it is never written.
      const world = makeWorld({ srvPrices0: '121' });
      arrange(world);
      const result = await run('store-price-salaries');
      expect(result.probes[0]).toMatchObject({ status: 'PASS', written: '130', restoreReadBack: 'CONFIRMED' });
      // The restore writes the original back; it reads 2*round(121/2) = 120, and that passes.
      expect(world.writes.map(w => w.value).slice(0, 2)).toEqual(['130', '121']);
      expect(world.srvPrices0).toBe('120');
    });

    it('FAILs a read-back that disagrees with the value written even when its Survival line is present', async () => {
      const world = makeWorld({ apply: w => w.property !== 'RDOSetPrice' });
      arrange(world);
      const result = await run('store-price-salaries');
      expect(result.status).toBe('FAIL');
      expect(result.probes[0].logLine).toBe('1/1 12:00 Service SetPrice: 0, 130');
      expect(result.probes[0].note).toMatch(/read-back never showed "130"/);
    });

    it('restores after a failed write, and after a missing Survival line', async () => {
      const world = makeWorld({ failWrite: 1, silent: new Set(['RDOSetSalaries']) });
      arrange(world);
      const result = await run('store-price-salaries');
      expect(result.status).toBe('FAIL');
      expect(result.probes[0]).toMatchObject({ status: 'FAIL', restored: true, note: 'write rejected' });
      expect(result.probes[1]).toMatchObject({ status: 'FAIL', restored: true });
      expect(result.probes[1].note).toMatch(/no model-server log line/);
      expect(world.writes.map(w => w.value)).toEqual(['130', '120', '149', '150']);
    });

    it('records RDOSetSalaries unproven by name when the template has no workforce group, and still runs RDOSetPrice', async () => {
      const world = makeWorld({ storeTabs: ['srvGeneral', 'supplies'] });
      arrange(world);
      const result = await run('store-price-salaries');
      expect(result.status).toBe('UNPROVEN');
      expect(result.unproven).toEqual([expect.stringMatching(/^RDOSetSalaries — .*workforce.*#1149/)]);
      expect(world.writes.map(w => w.property)).toEqual(['RDOSetPrice', 'RDOSetPrice']);
    });

    it('is UNPROVEN and writes nothing, anywhere, when the store fixture is missing', async () => {
      const world = makeWorld();
      arrange(world, { store: false });
      const result = await run('store-price-salaries');
      expect(result.status).toBe('UNPROVEN');
      expect(setProps(world)).toEqual([]);
    });

    it('refuses to write salaries it cannot read in full', async () => {
      const world = makeWorld({ salaries: ['150', '100'] });
      arrange(world);
      const result = await run('store-price-salaries');
      expect(result.status).toBe('FAIL');
      expect(result.probes[1].note).toMatch(/Cannot read the original/);
      expect(world.writes.map(w => w.property)).toEqual(['RDOSetPrice', 'RDOSetPrice']);
    });
  });

  describe('industry-output-price', () => {
    it("drives an own-client gate's price, proves it, restores it, and keeps every client link", async () => {
      const world = makeWorld();
      const lock = cleanLock();
      arrange(world);
      const result = await run('industry-output-price', lock);
      expect(result.status).toBe('PASS');
      expect(world.writes).toEqual([
        { property: 'RDOSetOutputPrice', value: '101', params: { fluidId: 'Chemicals' } },
        { property: 'RDOSetOutputPrice', value: '100', params: { fluidId: 'Chemicals' } },
      ]);
      expect(result.probes[0].logLine).toBe('12:00 - Fac(30,40) Output price set: Chemicals to 101');
      expect(lock.read().pendingRestores).toEqual([]);
    });

    it('writes nothing when a product client belongs to another company (UNPROVEN)', async () => {
      const world = makeWorld({ products: [product({ connections: [conn('Their Shop', 'Other Co', 5, 6)], connectionCount: 1 })] });
      arrange(world);
      const result = await run('industry-output-price');
      expect(result.status).toBe('UNPROVEN');
      expect(result.unproven[0]).toMatch(/^RDOSetOutputPrice — .*Kernel\/Kernel\.pas:7193-7205.*Their Shop \(5,6\) of Other Co/);
      expect(setProps(world)).toEqual([]);
    });

    it('takes the first safe gate when an earlier one is not', async () => {
      const unsafe = product({ path: 'p1', name: 'Fruit', metaFluid: 'Fruit', connections: [conn('T', 'Other Co', 5, 6)], connectionCount: 1 });
      const world = makeWorld({ products: [unsafe, product()] });
      arrange(world);
      const result = await run('industry-output-price');
      expect(result.status).toBe('PASS');
      expect(world.writes.map(w => w.params?.fluidId)).toEqual(['Chemicals', 'Chemicals']);
    });

    it('is UNPROVEN when the fixture lists no product gate', async () => {
      const world = makeWorld({ products: [] });
      arrange(world);
      const result = await run('industry-output-price');
      expect(result.unproven[0]).toMatch(/lists no product gate/);
      expect(setProps(world)).toEqual([]);
    });

    it('FAILs naming the lost link when the client list after the restore differs from its snapshot', async () => {
      const world = makeWorld({
        after: (_w, n) => {
          if (n === 1) {
            world.products[0].connections = [];
            world.products[0].connectionCount = 0;
          }
        },
      });
      arrange(world);
      const result = await run('industry-output-price');
      expect(result.status).toBe('FAIL');
      expect(result.probes[0].status).toBe('PASS');
      const failed = result.assertions.find(a => !a.ok);
      expect(failed?.detail).toMatch(/lost: Own Shop \(1,2\) of SPO_test3 - Green/);
    });

    it('is UNPROVEN and writes nothing when the industry fixture is missing', async () => {
      const world = makeWorld();
      arrange(world, { industry: false });
      const result = await run('industry-output-price');
      expect(result.status).toBe('UNPROVEN');
      expect(setProps(world)).toEqual([]);
    });
  });

  describe('industry-supply-limits', () => {
    it('drives max price, min K, sort mode and overprice on a sortable gate with a supplier, restoring each', async () => {
      const world = makeWorld({ supplies: [supplyGate({ qpSorted: '1', sortMode: '0' })] });
      const lock = cleanLock();
      arrange(world);
      const result = await run('industry-supply-limits', lock);
      expect(result.status).toBe('PASS');
      expect(result.probes.map(p => [p.member, p.written, p.original])).toEqual([
        ['RDOSetInputMaxPrice', '199', '200'],
        ['RDOSetInputMinK', '11', '10'],
        ['RDOSetInputSortMode', '1', '0'],
        ['RDOSetInputOverPrice', '21', '20'],
      ]);
      expect(result.probes[2].logLine).toBe('12:00 Changing Sort Mode.. ');
      expect(world.supplies[0]).toMatchObject({ maxPrice: '200', minK: '10', sortMode: '0' });
      expect(world.supplies[0].connections[0].overprice).toBe('20');
      expect(lock.read().pendingRestores).toEqual([]);
    });

    it('records the sort mode and the overprice unproven by name on a plain gate with no supplier, and runs the others', async () => {
      const world = makeWorld({ supplies: [supplyGate({ connections: [], connectionCount: 0 })] });
      arrange(world);
      const result = await run('industry-supply-limits');
      expect(result.status).toBe('UNPROVEN');
      expect(result.unproven).toEqual([
        expect.stringMatching(/^RDOSetInputSortMode — the Water gate publishes no sort mode/),
        expect.stringMatching(/^RDOSetInputOverPrice — the Water gate has no supplier row/),
      ]);
      expect(result.probes.map(p => [p.member, p.status])).toEqual([
        ['RDOSetInputMaxPrice', 'PASS'],
        ['RDOSetInputMinK', 'PASS'],
      ]);
    });

    it('restores the overprice on the same supplier after its row shifted', async () => {
      const world = makeWorld({
        after: (w, n) => {
          if (w.property === 'RDOSetInputOverPrice' && n === 5) {
            world.supplies[0].connections.unshift(conn('New Well', 'Other Co', 9, 9, '0'));
          }
        },
      });
      arrange(world);
      const result = await run('industry-supply-limits');
      const over = world.writes.filter(w => w.property === 'RDOSetInputOverPrice');
      expect(over).toEqual([
        { property: 'RDOSetInputOverPrice', value: '21', params: { fluidId: 'Water', index: '0' } },
        { property: 'RDOSetInputOverPrice', value: '20', params: { fluidId: 'Water', index: '1' } },
      ]);
      expect(world.supplies[0].connections.map(c => [c.facilityName, c.overprice])).toEqual([['New Well', '0'], ['Well', '20']]);
      expect(result.probes.find(p => p.member === 'RDOSetInputOverPrice')?.status).toBe('PASS');
    });

    it('never writes the overprice onto another row when its supplier left the gate', async () => {
      const world = makeWorld({
        after: (w, n) => {
          if (n === 5) world.supplies[0].connections = [conn('Other Well', 'Other Co', 9, 9, '0')];
        },
      });
      arrange(world);
      const result = await run('industry-supply-limits');
      const over = result.probes.find(p => p.member === 'RDOSetInputOverPrice');
      expect(over?.status).toBe('FAIL');
      expect(over?.note).toMatch(/restore failed/);
      expect(world.writes.filter(w => w.property === 'RDOSetInputOverPrice')).toHaveLength(1);
      expect(world.supplies[0].connections[0].overprice).toBe('0');
    });

    it('FAILs a max-price read-back that never moves though its line is present', async () => {
      const world = makeWorld({ apply: w => w.property !== 'RDOSetInputMaxPrice' });
      arrange(world);
      const result = await run('industry-supply-limits');
      expect(result.status).toBe('FAIL');
      expect(result.probes[0]).toMatchObject({ status: 'FAIL', logLine: '12:00 - Fac(30,40) Input max price set: Water to 199' });
    });

    it('is UNPROVEN when no supply gate publishes MaxPrice', async () => {
      const world = makeWorld({ supplies: [supplyGate({ maxPrice: undefined })] });
      arrange(world);
      const result = await run('industry-supply-limits');
      expect(result.status).toBe('UNPROVEN');
      expect(result.unproven[0]).toMatch(/Kernel\/Kernel\.pas:7813/);
      expect(setProps(world)).toEqual([]);
    });

    it('is UNPROVEN and writes nothing when the industry fixture is missing', async () => {
      const world = makeWorld();
      arrange(world, { industry: false });
      expect((await run('industry-supply-limits')).status).toBe('UNPROVEN');
      expect(setProps(world)).toEqual([]);
    });
  });

  describe('facility-open-close', () => {
    it('stops the store (#-1), reads the facStoppedByTycoon bit, and restarts it (#0)', async () => {
      const world = makeWorld({ trouble: '1' });
      const lock = cleanLock();
      arrange(world);
      const result = await run('facility-open-close', lock);
      expect(result.status).toBe('PASS');
      expect(world.writes).toEqual([
        { property: 'property', value: '-1', params: { propertyName: 'Stopped' } },
        { property: 'property', value: '0', params: { propertyName: 'Stopped' } },
      ]);
      expect(result.probes[0]).toMatchObject({ original: '0', written: '1', logLine: '12:00 Stopping Facility.' });
      expect(world.trouble).toBe('1');
      expect(lock.read().pendingRestores).toEqual([]);
    });

    it('restarts a stopped store first, then stops it again', async () => {
      const world = makeWorld({ trouble: '4' });
      arrange(world);
      const result = await run('facility-open-close');
      expect(result.status).toBe('PASS');
      expect(world.writes.map(w => w.value)).toEqual(['0', '-1']);
    });

    it('FAILs a bit that never moves though the line is present, and still restores', async () => {
      const world = makeWorld({ apply: () => false });
      arrange(world);
      const result = await run('facility-open-close');
      expect(result.status).toBe('FAIL');
      expect(result.probes[0].logLine).toBe('12:00 Stopping Facility.');
      expect(world.writes.map(w => w.value)).toEqual(['-1', '0']);
    });

    it('writes nothing when Trouble is absent', async () => {
      const world = makeWorld({ trouble: undefined });
      arrange(world);
      const result = await run('facility-open-close');
      expect(result.status).toBe('FAIL');
      expect(setProps(world)).toEqual([]);
    });

    it('is UNPROVEN and writes nothing when the store fixture is missing', async () => {
      const world = makeWorld();
      arrange(world, { store: false });
      expect((await run('facility-open-close')).status).toBe('UNPROVEN');
      expect(setProps(world)).toEqual([]);
    });
  });

  describe('industry-auto-buy', () => {
    it('toggles Selected off and back on, proven by the read-back alone', async () => {
      const world = makeWorld();
      const lock = cleanLock();
      arrange(world);
      const result = await run('industry-auto-buy', lock);
      expect(result.status).toBe('PASS');
      expect(world.writes).toEqual([
        { property: 'RDOSelSelected', value: '0', params: { fluidId: 'Water' } },
        { property: 'RDOSelSelected', value: '1', params: { fluidId: 'Water' } },
      ]);
      expect(result.probes[0].logLine).toBeNull();
      expect(liveLog.openLogWindow).not.toHaveBeenCalled();
      expect(lock.read().pendingRestores).toEqual([]);
    });

    it('FAILs a toggle that never reads back', async () => {
      const world = makeWorld({ supplies: [supplyGate({ selected: '0' })], apply: () => false });
      arrange(world);
      const result = await run('industry-auto-buy');
      expect(result.status).toBe('FAIL');
      expect(world.writes.map(w => w.value)).toEqual(['1', '0']);
    });

    it('is UNPROVEN when no supply gate publishes Selected', async () => {
      const world = makeWorld({ supplies: [supplyGate({ selected: undefined })] });
      arrange(world);
      const result = await run('industry-auto-buy');
      expect(result.status).toBe('UNPROVEN');
      expect(setProps(world)).toEqual([]);
    });

    it('is UNPROVEN and writes nothing when the industry fixture is missing', async () => {
      const world = makeWorld();
      arrange(world, { industry: false });
      expect((await run('industry-auto-buy')).status).toBe('UNPROVEN');
      expect(setProps(world)).toEqual([]);
    });
  });
});
