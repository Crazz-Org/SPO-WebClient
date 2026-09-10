import { WsMessageType } from '@/shared/types/message-types';
import type { WsMessage, FavoritesItem } from '@/shared/types/message-types';
import { FLOWS, flowByName, nudge, runFlow } from './flows';
import { ROUTES } from './routing';
import { WorldLock } from './world-lock';
import { WsDriver } from './ws-driver';
import * as session from './session';
import * as probeModule from './probe';
import * as liveLog from './live-log';
import { PRIMARY_ACCOUNT, SECONDARY_ACCOUNT } from './config';

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
  };
}

const ctx = { lock: new WorldLock('report/e2e') };

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
    expect(mutating).toEqual(['favorites-folders', 'favorites-roundtrip', 'mail-roundtrip', 'politics-write']);
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
        probes: [],
        messagesSent: 1,
        messagesReceived: 1,
        wireErrors: 0,
      }),
    };
    expect((await runFlow(passing, ctx)).status).toBe('PASS');
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
  function mailSession(
    inboxSubjects: string[],
    record?: (msg: WsMessage) => void,
    opts: { unreadCount?: number; afterUnreadCount?: number } = {},
  ) {
    const { unreadCount = 1, afterUnreadCount = 0 } = opts;
    return stubSession(msg => {
      record?.(msg);
      switch (msg.type) {
        case WsMessageType.RESP_MAIL_CONNECTED:
        case WsMessageType.REQ_MAIL_CONNECT:
          return { type: WsMessageType.RESP_MAIL_CONNECTED, unreadCount };
        case WsMessageType.REQ_MAIL_COMPOSE:
          return { type: WsMessageType.RESP_MAIL_SENT };
        case WsMessageType.REQ_MAIL_GET_FOLDER:
          return {
            type: WsMessageType.RESP_MAIL_FOLDER,
            folder: 'Inbox',
            messages: inboxSubjects.map((subject, i) => ({ messageId: String(i), subject })),
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

    const result = await flowByName('mail-roundtrip').run(ctx);

    expect(result.status).toBe('FAIL');
    expect(result.assertions.find(a => !a.ok)?.what).toMatch(/arrived in the recipient inbox/);
  });

  it('deletes the probe message once it has been seen', async () => {
    const sent: WsMessage[] = [];
    let subject = '';
    jest.spyOn(session, 'login').mockImplementation(async () =>
      mailSession(subject ? [subject] : [], msg => {
        sent.push(msg);
        if (msg.type === WsMessageType.REQ_MAIL_COMPOSE) {
          subject = (msg as unknown as { subject: string }).subject;
        }
      }),
    );
    jest.spyOn(session, 'logoff').mockResolvedValue(undefined);

    const result = await flowByName('mail-roundtrip').run(ctx);

    expect(result.status).toBe('PASS');
    expect(sent.some(m => m.type === WsMessageType.REQ_MAIL_DELETE)).toBe(true);
  });

  it('FAILs when the unread count does not drop after the read', async () => {
    const sent: WsMessage[] = [];
    let subject = '';
    jest.spyOn(session, 'login').mockImplementation(async () =>
      mailSession(
        subject ? [subject] : [],
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

    const result = await flowByName('mail-roundtrip').run(ctx);

    expect(result.status).toBe('FAIL');
    const failed = result.assertions.find(a => !a.ok);
    expect(failed?.what).toMatch(/lowered CheckNewMail by one/);
    expect(failed?.detail).toMatch(/messageId=\d+ before=1 after=1/);
  });

  it('addresses the probe message to the second account', async () => {
    const sent: WsMessage[] = [];
    jest.spyOn(session, 'login').mockResolvedValue(mailSession([], msg => sent.push(msg)));
    jest.spyOn(session, 'logoff').mockResolvedValue(undefined);

    await flowByName('mail-roundtrip').run(ctx);

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
  it('records an exception, and opens no issue, when the paper keeps none', async () => {
    const requests = arrange({ list: { paperName: 'Helartia Herald', issues: [], error: '' } });
    const result = await flowByName('newspaper-read').run(ctx);
    expect(result.status).toBe('PASS');
    expect(result.assertions.find(a => /environment exception/.test(a.what))).toMatchObject({
      ok: true,
      detail: 'Helartia Herald: 0 issues',
    });
    expect(requests.some(m => m.type === WsMessageType.REQ_NEWSPAPER_ISSUE)).toBe(false);
  });

  it('fails when the bar itself could not be read', async () => {
    arrange({ list: { paperName: 'Helartia Herald', issues: [], error: 'HTTP 500' } });
    const result = await flowByName('newspaper-read').run(ctx);
    expect(result.status).toBe('FAIL');
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
