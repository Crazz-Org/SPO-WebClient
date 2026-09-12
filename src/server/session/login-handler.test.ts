/**
 * Login handler — the paths the protocol-validation suites do not reach.
 *
 * `auth-check.validation.test.ts`, `world-login.validation.test.ts` and
 * `company-select.validation.test.ts` drive the happy sequences through a real
 * socket; `login-handler-reconnect.test.ts` drives `reconnectWorldSocket`.
 * What was left uncovered is everything AFTER a first login: company creation,
 * company switching, people search, and every degraded answer the Directory or
 * the Interface Server can give.
 *
 * The harness here is `makeLoginCtx` — a fake `LoginContext` whose setters write
 * back to the state its getters read, exactly as `StarpeaceSession` does. That
 * is what makes the question answerable: the ids these tests assert on are
 * the ones the fake server RETURNED, never constants copied into the expectation.
 *
 * Session-lifecycle rules encoded here: one directory session per batch, with
 * `RDOEndSession` fire-and-forget (accepted divergence D1), the login order, and
 * `EnableEvents` gating every push.
 */

jest.mock('node-fetch', () => ({ __esModule: true, default: jest.fn() }));

import fetch from 'node-fetch';
import {
  checkAuth,
  connectDirectory,
  searchPeople,
  loginWorld,
  selectCompany,
  createCompany,
  switchCompany,
  reconnectWorldSocket,
} from './login-handler';
import { makeLoginCtx } from '../__tests__/session/fake-session-context';
import type { FakeLoginCtx, Responder } from '../__tests__/session/fake-session-context';
import { RdoAction, RdoVerb, SessionPhase } from '../../shared/types';
import type { CompanyInfo, RdoPacket, WorldInfo } from '../../shared/types';
import { RdoCommand, RdoValue } from '../../shared/rdo-types';
import { TimeoutCategory } from '../../shared/timeout-categories';
import { AuthError } from '../../shared/auth-error';

const fetchMock = fetch as unknown as jest.Mock;

// ── Fixture ids — deliberately distinct so a swap shows up ───────────────────
const DIRECTORY_SERVER_ID = '39751288';
const DIRECTORY_SESSION_ID = '44917624';
const INTERFACE_SERVER_ID = '6892548';
const CONTEXT_ID = '8161308';
const NEW_CONTEXT_ID = '9427733';
const TYCOON_ID = '4666201923';
const CNNT_ID = '40530807';

const WORLD: WorldInfo = {
  name: 'planitia', url: 'http://1.2.3.4', ip: '1.2.3.4', port: 8000,
  population: 0, investors: 0, online: 0, players: 0, mapSizeX: 0, mapSizeY: 0,
};

/** Answers for the property GETs `loginWorld` issues, in wire form. */
const LOGIN_PROPERTIES: Readonly<Record<string, string>> = {
  WorldName: '%planitia',
  WorldURL: '%http://1.2.3.4',
  DAAddr: '%1.2.3.4',
  // DALockPort is DAPort + 1 on the wire (InterfaceServer.pas:2639-2640); the fixture
  // keeps that relation so a value picked up from the wrong property is visible here.
  DALockPort: '#7002',
  MailAddr: '%1.2.3.5',
  MailPort: '#1234',
  WorldXSize: '#1000',
  WorldYSize: '#1200',
  WorldSeason: '%Spring',
  MailAccount: '%SPO_test3@planitia.net',
  TycoonId: `#${TYCOON_ID}`,
  RDOCnntId: `#${CNNT_ID}`,
  GetCompanyCount: '#2',
};

const COMPANY_HTML = [
  '<html><body><table>',
  '<td companyId="55" companyName="SPO_test3 - Green" companyOwnerRole="SPO_test3">a</td>',
  '<td companyId="56" companyName="Mayor of Kalisz" companyOwnerRole="Mayor of Kalisz">b</td>',
  '</table></body></html>',
].join('\n');

/** `A<rid> ;` — the ack the server sends with no payload at all. */
const EMPTY_ANSWER: RdoPacket = { raw: '', type: 'RESPONSE', rid: 1 };

/** A directory phase: idof → get RDOOpenSession → … */
function directoryResponder(authCode = '#0'): Responder {
  return (packet) => {
    if (packet.verb === RdoVerb.IDOF) return `objid="${DIRECTORY_SERVER_ID}"`;
    if (packet.member === 'RDOOpenSession') return `RDOOpenSession="#${DIRECTORY_SESSION_ID}"`;
    if (packet.member === 'RDOLogonUser') return `res="${authCode}"`;
    return 'res="%"';
  };
}

/** The world login sequence; `overrides` replaces individual answers. */
function loginResponder(overrides: Record<string, string> = {}): Responder {
  const props: Record<string, string> = { ...LOGIN_PROPERTIES, ...overrides };
  return (packet) => {
    if (packet.verb === RdoVerb.IDOF) return `objid="${INTERFACE_SERVER_ID}"`;
    if (packet.action === RdoAction.GET) {
      const member = packet.member ?? '';
      return `${member}="${props[member] ?? ''}"`;
    }
    if (packet.member === 'Logon') return overrides.Logon ?? `res="#${CONTEXT_ID}"`;
    return 'res="#0"';
  };
}

/** Drain the microtask/immediate queues until `cond` holds (or we give up). */
async function tickUntil(cond: () => boolean, maxTicks = 200): Promise<void> {
  for (let i = 0; i < maxTicks && !cond(); i++) {
    await new Promise(resolve => setImmediate(resolve));
  }
}

/**
 * `loginWorld` blocks on the InitClient push (the server fires it before
 * answering `RegisterEventsById`). Standing in for the push means calling the
 * resolver the handler installed — which is exactly what `dispatchPush` does.
 */
async function runLoginWorld(
  fake: FakeLoginCtx,
  world: WorldInfo = WORLD,
  username = 'SPO_test3',
  password = 'test3',
): Promise<Awaited<ReturnType<typeof loginWorld>>> {
  const promise = loginWorld(fake.ctx, username, password, world);
  promise.catch(() => { /* the caller awaits and asserts */ });
  await tickUntil(() => fake.state.initClientResolver !== null);
  fake.state.initClientResolver?.();
  return promise;
}

/** The exact SetLanguage push the login and re-login paths must emit. */
function setLanguageFrame(contextId: string): string {
  return RdoCommand.sel(contextId).call('SetLanguage').push().args(RdoValue.string('0')).build();
}

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockResolvedValue({
    text: async () => COMPANY_HTML,
    url: `http://1.2.3.4/chooseCompany.asp?ClientViewId=${CONTEXT_ID}`,
  });
});

// ── Directory authentication ────────────────────────────────────────────────

describe('checkAuth — the ephemeral directory session', () => {
  it('opens one session, logs on, and ends it fire-and-forget on the same socket', async () => {
    const fake = makeLoginCtx();
    fake.respond(directoryResponder());

    await checkAuth(fake.ctx, 'SPO_test3', 'test3');

    // One RDOOpenSession…RDOEndSession per batch, never kept open.
    expect(fake.sent[0].packet).toMatchObject({ verb: RdoVerb.IDOF, targetId: 'DirectoryServer' });
    expect(fake.sent.slice(1).map(s => s.packet.member)).toEqual([
      'RDOOpenSession', 'RDOMapSegaUser', 'RDOLogonUser',
    ]);
    // Every directory frame carries the legacy 20 s deadline (DSProxy.TimeOut,
    // LogonHandlerViewer.pas:341) — not the 60 s default.
    expect(fake.sent.every(s => s.category === TimeoutCategory.DIRECTORY)).toBe(true);
    // D1: RDOEndSession leaves without a RID.
    expect(fake.frames.directory_auth).toEqual([
      RdoCommand.sel(DIRECTORY_SESSION_ID).call('RDOEndSession').push().build(),
    ]);
    expect(fake.hooks.deleteSocket).toHaveBeenCalledWith('directory_auth');
  });

  it('threads the session id the server returned, not the server object id', async () => {
    const fake = makeLoginCtx();
    fake.respond(directoryResponder());

    await checkAuth(fake.ctx, 'SPO_test3', 'test3');

    const logon = fake.sent.find(s => s.packet.member === 'RDOLogonUser');
    expect(logon?.packet.targetId).toBe(DIRECTORY_SESSION_ID);
    expect(logon?.packet.targetId).not.toBe(DIRECTORY_SERVER_ID);
    // Credentials are explicit OLEStrings (P-M2) — pre-auth attacker-controlled text.
    expect(logon?.packet.args).toEqual(['"%SPO_test3"', '"%test3"']);
  });

  it('throws AuthError carrying the server code, and still closes the session', async () => {
    const fake = makeLoginCtx();
    fake.respond(directoryResponder('#12'));

    await expect(checkAuth(fake.ctx, 'BadUser', 'test3')).rejects.toBeInstanceOf(AuthError);
    // The `finally` runs even on the throw: no leaked socket entry.
    expect(fake.hooks.deleteSocket).toHaveBeenCalledWith('directory_auth');
    // …and no RDOEndSession, because the throw happens before it.
    expect(fake.frames.directory_auth).toEqual([]);
  });

  it('reports the numeric code on AuthError', async () => {
    const fake = makeLoginCtx();
    fake.respond(directoryResponder('#112'));

    await expect(checkAuth(fake.ctx, 'Nobody', 'test3')).rejects.toMatchObject({ authCode: 112 });
  });

  it('treats a bodiless answer as a failed logon rather than a success', async () => {
    const fake = makeLoginCtx();
    // `A<rid> ;` — an ack with no payload at all. Every parse falls back to the
    // empty string, so the auth code is NaN, which is not 0: refuse. Reading an
    // unparsable answer as "authenticated" is the one outcome that must not happen.
    fake.respond((packet) => (packet.verb === RdoVerb.IDOF
      ? `objid="${DIRECTORY_SERVER_ID}"`
      : EMPTY_ANSWER));

    await expect(checkAuth(fake.ctx, 'SPO_test3', 'test3')).rejects.toBeInstanceOf(AuthError);
  });
});

describe('connectDirectory — world list parsing', () => {
  /** `RDOQueryKey` answers a newline-separated key/value block. */
  function queryResponder(block: string): Responder {
    return (packet) => {
      if (packet.verb === RdoVerb.IDOF) return `objid="${DIRECTORY_SERVER_ID}"`;
      if (packet.member === 'RDOOpenSession') return `RDOOpenSession="#${DIRECTORY_SESSION_ID}"`;
      if (packet.member === 'RDOQueryKey') return `res="%${block}"`;
      if (packet.member === 'RDOLogonUser') return 'res="#0"';
      return 'res="%"';
    };
  }

  it('caches the credentials and defaults the zone path when the caller omits it', async () => {
    const fake = makeLoginCtx();
    fake.respond(queryResponder('Count=0'));

    await connectDirectory(fake.ctx, 'SPO_test3', 'test3');

    expect(fake.state.phase).toBe(SessionPhase.DIRECTORY_CONNECTED);
    expect(fake.state.cachedUsername).toBe('SPO_test3');
    expect(fake.state.activeUsername).toBe('SPO_test3');
    expect(fake.state.cachedPassword).toBe('test3');
    expect(fake.state.cachedZonePath).toBe('Root/Areas/Asia/Worlds');
    const query = fake.sent.find(s => s.packet.member === 'RDOQueryKey');
    expect(query?.packet.args?.[0]).toBe('"%Root/Areas/Asia/Worlds"');
  });

  it('queries the zone path the caller supplied', async () => {
    const fake = makeLoginCtx();
    fake.respond(queryResponder('Count=0'));

    await connectDirectory(fake.ctx, 'SPO_test3', 'test3', 'Root/Areas/Free Space/Worlds');

    const query = fake.sent.find(s => s.packet.member === 'RDOQueryKey');
    expect(query?.packet.args?.[0]).toBe('"%Root/Areas/Free Space/Worlds"');
    expect(fake.state.cachedZonePath).toBe('Root/Areas/Free Space/Worlds');
  });

  it('builds a WorldInfo per entry and indexes them by name', async () => {
    const fake = makeLoginCtx();
    fake.respond(queryResponder([
      'Count=2',
      'Key0=planitia',
      'Interface/URL0=http://1.2.3.4',
      'Interface/IP0=1.2.3.4',
      'Interface/Port0=8000',
      'Interface/Running0=True',
      'General/Date0=Spring 2027',
      'General/Population0=1234',
      'General/Investors0=56',
      'General/Online0=7',
      'Key1=shamba',
      'Interface/IP1=5.6.7.8',
      'Interface/Port1=8001',
      'Interface/Running1=false',
    ].join('\n')));

    const worlds = await connectDirectory(fake.ctx, 'SPO_test3', 'test3');

    expect(worlds).toHaveLength(2);
    expect(worlds[0]).toMatchObject({
      name: 'planitia', ip: '1.2.3.4', port: 8000, population: 1234,
      investors: 56, online: 7, players: 7, date: 'Spring 2027', running3: true,
    });
    // Missing keys fall back rather than producing undefined fields.
    expect(worlds[1]).toMatchObject({ name: 'shamba', url: '', running3: false, population: 0 });
    expect(fake.state.availableWorlds.get('planitia')).toBe(worlds[0]);
  });

  it('drops an entry whose interface port is 0 — it cannot be dialled', async () => {
    const fake = makeLoginCtx();
    fake.respond(queryResponder([
      'Count=2',
      'Key0=offline', 'Interface/Port0=0',
      'Key1=planitia', 'Interface/IP1=1.2.3.4', 'Interface/Port1=8000',
    ].join('\n')));

    const worlds = await connectDirectory(fake.ctx, 'SPO_test3', 'test3');

    expect(worlds.map(w => w.name)).toEqual(['planitia']);
  });

  it('names the unnamed and defaults a missing IP to loopback', async () => {
    const fake = makeLoginCtx();
    fake.respond(queryResponder(['Count=1', 'Interface/Port0=8000'].join('\n')));

    const worlds = await connectDirectory(fake.ctx, 'SPO_test3', 'test3');

    expect(worlds[0]).toMatchObject({ name: 'Unknown', ip: '127.0.0.1', port: 8000 });
  });

  it('returns nothing and says why when the answer carries no Count', async () => {
    const fake = makeLoginCtx();
    fake.respond(queryResponder('Junk without an equals sign\nSomething/Else=1'));

    const worlds = await connectDirectory(fake.ctx, 'SPO_test3', 'test3');

    expect(worlds).toEqual([]);
    expect(fake.log.warn).toHaveBeenCalledWith(
      expect.stringContaining('"count" key not found'),
    );
  });

  it('refuses to close a session the directory never opened, rather than sending sel 0', async () => {
    const fake = makeLoginCtx();
    // Both phases parse an empty RDOOpenSession answer into an empty session id.
    // `RdoCommand.sel('')` then throws instead of putting `sel 0` — a null
    // pointer server-side — on the wire.
    fake.respond((packet) => (packet.verb === RdoVerb.IDOF
      ? `objid="${DIRECTORY_SERVER_ID}"`
      : (packet.member === 'RDOLogonUser' ? 'res="#0"' : EMPTY_ANSWER)));

    await expect(connectDirectory(fake.ctx, 'SPO_test3', 'test3'))
      .rejects.toThrow(/Invalid RDO target ID/);
    expect(fake.frames.directory_query).toEqual([]);
    expect(fake.frames.directory_auth).toEqual([]);
  });
});

// ── People search ───────────────────────────────────────────────────────────

describe('searchPeople', () => {
  const SEARCH_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

  /** idof/open-session plumbing shared by every scenario below. */
  function directoryPlumbing(packet: Partial<RdoPacket>): string | undefined {
    if (packet.verb === RdoVerb.IDOF) return `objid="${DIRECTORY_SERVER_ID}"`;
    if (packet.member === 'RDOOpenSession') return `RDOOpenSession="#${DIRECTORY_SESSION_ID}"`;
    return undefined;
  }

  it('sweeps exactly the 26 Root/Users buckets in order with the wildcard pattern, and aggregates Alias values across buckets', async () => {
    const fake = makeLoginCtx();
    let currentLetter = '';
    fake.respond((packet) => {
      const plumbing = directoryPlumbing(packet);
      if (plumbing) return plumbing;
      if (packet.member === 'RDOSetCurrentKey') {
        currentLetter = String(packet.args?.[0] ?? '').replace(/^"%Root\/Users\//, '').replace(/"$/, '');
        return 'res="#-1"';
      }
      if (packet.member === 'RDOSearchKey') {
        if (currentLetter === 'A') return 'res="%Count=1\r\nKey0=aaron\r\nAlias0=Aaron"';
        if (currentLetter === 'Z') return 'res="%Count=1\r\nKey0=zoe\r\nAlias0=Zoe"';
        return 'res="%Count=0"';
      }
      return 'res="%"';
    });

    const names = await searchPeople(fake.ctx, 'test');

    const setKeys = fake.sent.filter(s => s.packet.member === 'RDOSetCurrentKey');
    expect(setKeys.map(s => s.packet.args)).toEqual(
      Array.from(SEARCH_ALPHABET).map(letter => [`"%Root/Users/${letter}"`]),
    );

    const searches = fake.sent.filter(s => s.packet.member === 'RDOSearchKey');
    expect(searches).toHaveLength(26);
    for (const s of searches) {
      // ValueNameList must never be empty — the server never builds its SQL
      // query with an empty list (DirectoryManager.pas:976-1104).
      expect(s.packet.args).toEqual(['"%*test*"', '"%Alias\r\n"']);
      expect(s.packet.args?.[1]).not.toBe('"%"');
      expect(s.packet.targetId).toBe(DIRECTORY_SESSION_ID);
    }

    expect(names).toEqual(['Aaron', 'Zoe']);
  });

  it('narrows a single letter to its own bucket, with pattern "*"', async () => {
    const fake = makeLoginCtx();
    fake.respond((packet) => {
      const plumbing = directoryPlumbing(packet);
      if (plumbing) return plumbing;
      if (packet.member === 'RDOSetCurrentKey') return 'res="#-1"';
      if (packet.member === 'RDOSearchKey') return 'res="%Count=1\r\nKey0=crazz\r\nAlias0=Crazz"';
      return 'res="%"';
    });

    const names = await searchPeople(fake.ctx, 'c');

    const setKeys = fake.sent.filter(s => s.packet.member === 'RDOSetCurrentKey');
    expect(setKeys).toHaveLength(1);
    expect(setKeys[0].packet.args).toEqual(['"%Root/Users/C"']);

    const searches = fake.sent.filter(s => s.packet.member === 'RDOSearchKey');
    expect(searches).toHaveLength(1);
    expect(searches[0].packet.args).toEqual(['"%*"', '"%Alias\r\n"']);

    expect(names).toEqual(['Crazz']);
  });

  it('skips a bucket whose RDOSetCurrentKey answers false — no RDOSearchKey follows it', async () => {
    const fake = makeLoginCtx();
    fake.respond((packet) => {
      const plumbing = directoryPlumbing(packet);
      if (plumbing) return plumbing;
      if (packet.member === 'RDOSetCurrentKey') return 'res="#0"';
      return 'res="%"';
    });

    const names = await searchPeople(fake.ctx, 'test');

    expect(fake.sent.filter(s => s.packet.member === 'RDOSetCurrentKey')).toHaveLength(26);
    expect(fake.sent.filter(s => s.packet.member === 'RDOSearchKey')).toHaveLength(0);
    expect(names).toEqual([]);
  });

  it('reads names from Alias<i>, not Key<i>, and skips indices whose Alias is absent', async () => {
    const fake = makeLoginCtx();
    fake.respond((packet) => {
      const plumbing = directoryPlumbing(packet);
      if (plumbing) return plumbing;
      if (packet.member === 'RDOSetCurrentKey') return 'res="#-1"';
      // Count=3, but Alias1 is absent and Key0/Key2 deliberately differ from
      // Alias0/Alias2 — a Key-based read would return the wrong names.
      if (packet.member === 'RDOSearchKey') {
        return 'res="%Count=3\r\nKey0=k-spo_test3\r\nAlias0=SPO_test3\r\nKey2=k-mayor\r\nAlias2=Mayor of Kalisz"';
      }
      return 'res="%"';
    });

    const names = await searchPeople(fake.ctx, 'q');

    expect(names).toEqual(['SPO_test3', 'Mayor of Kalisz']);
  });

  it('returns nothing and says why when the answer carries no Count', async () => {
    const fake = makeLoginCtx();
    fake.respond((packet) => {
      const plumbing = directoryPlumbing(packet);
      if (plumbing) return plumbing;
      if (packet.member === 'RDOSetCurrentKey') return 'res="#-1"';
      if (packet.member === 'RDOSearchKey') return 'res="%Nothing=here"';
      return 'res="%"';
    });

    await expect(searchPeople(fake.ctx, 'q')).resolves.toEqual([]);
    expect(fake.log.warn).toHaveBeenCalledWith('[Session] SearchKey: no "count" key in response');
  });

  it('returns nothing, silently, for an empty answer — the server\'s normal zero-match reply', async () => {
    const fake = makeLoginCtx();
    fake.respond((packet) => {
      const plumbing = directoryPlumbing(packet);
      if (plumbing) return plumbing;
      if (packet.member === 'RDOSetCurrentKey') return 'res="#-1"';
      if (packet.member === 'RDOSearchKey') return 'res="%"';
      return 'res="%"';
    });

    await expect(searchPeople(fake.ctx, 'q')).resolves.toEqual([]);
    expect(fake.log.warn).not.toHaveBeenCalled();
  });

  it('returns nothing when the directory answers with no payload at all', async () => {
    const fake = makeLoginCtx();
    fake.respond((packet) => {
      const plumbing = directoryPlumbing(packet);
      if (plumbing) return plumbing;
      if (packet.member === 'RDOSetCurrentKey') return 'res="#-1"';
      return EMPTY_ANSWER;
    });

    await expect(searchPeople(fake.ctx, 'q')).resolves.toEqual([]);
  });

  it('a directory failure now rejects — no more laundering into an empty list', async () => {
    const fake = makeLoginCtx();
    fake.respond((packet) => (packet.verb === RdoVerb.IDOF
      ? new Error('Request timeout: idof')
      : 'res="%"'));

    await expect(searchPeople(fake.ctx, 'test')).rejects.toThrow('Request timeout: idof');
    expect(fake.log.error).toHaveBeenCalledWith(
      '[Session] searchPeople failed:', 'Request timeout: idof',
    );
    // The `finally` still runs — the socket is not leaked on the error path.
    expect(fake.hooks.deleteSocket).toHaveBeenCalledWith('directory_search');
  });

  it('resolves empty with zero sockets created for an empty or whitespace-only search string', async () => {
    const fake = makeLoginCtx();
    fake.respond(() => 'res="%"');

    await expect(searchPeople(fake.ctx, '   ')).resolves.toEqual([]);
    expect(fake.hooks.createSocket).not.toHaveBeenCalled();
    expect(fake.sent).toEqual([]);
  });

  it('ends its own directory session fire-and-forget once and drops the socket', async () => {
    const fake = makeLoginCtx();
    fake.respond((packet) => {
      const plumbing = directoryPlumbing(packet);
      if (plumbing) return plumbing;
      if (packet.member === 'RDOSetCurrentKey') return 'res="#-1"';
      if (packet.member === 'RDOSearchKey') return 'res="%Count=0"';
      return 'res="%"';
    });

    await searchPeople(fake.ctx, 'q');

    expect(fake.frames.directory_search).toEqual([
      RdoCommand.sel(DIRECTORY_SESSION_ID).call('RDOEndSession').push().build(),
    ]);
    expect(fake.hooks.deleteSocket).toHaveBeenCalledWith('directory_search');
  });
});

// ── World login ─────────────────────────────────────────────────────────────

describe('loginWorld', () => {
  it('stores the world properties the InterfaceServer answered', async () => {
    const fake = makeLoginCtx();
    fake.respond(loginResponder());

    const result = await runLoginWorld(fake);

    expect(fake.state.daAddr).toBe('1.2.3.4');
    // Fed by DALockPort, as Voyager feeds its own fDAPort (ServerCnxHandler.pas:1046).
    expect(fake.state.daPort).toBe(7002);
    expect(fake.state.mailAddr).toBe('1.2.3.5');
    expect(fake.state.mailPort).toBe(1234);
    expect(fake.state.worldXSize).toBe(1000);
    expect(fake.state.worldYSize).toBe(1200);
    expect(fake.state.mailAccount).toBe('SPO_test3@planitia.net');
    // WorldName rewrites the WorldInfo the caller passed in.
    expect(fake.state.currentWorldInfo).toMatchObject({ name: 'planitia', mapSizeX: 1000, mapSizeY: 1200 });
    expect(result.contextId).toBe(CONTEXT_ID);
    expect(result.tycoonId).toBe(TYCOON_ID);
    // worldSeason is reported as null by loginWorld — fetchWorldProperties owns it.
    expect(result.worldSeason).toBeNull();
    expect(fake.state.worldSeason).toBe(1);
  });

  const SEASONS: ReadonlyArray<[string, number, string]> = [
    ['#0', 0, 'a numeric season in range is taken as-is'],
    ['#3', 3, 'the top of the range is in range'],
    ['%winter', 0, 'a lowercase name maps'],
    ['%Autumn', 3, 'the mapping is case-insensitive'],
    ['%fall', 3, 'fall is an alias for autumn'],
    ['#9', 2, 'out of range falls back to Summer'],
    ['%monsoon', 2, 'an unknown name falls back to Summer'],
  ];

  it.each(SEASONS)('parses WorldSeason %s as %i — %s', async (wire, expected) => {
    const fake = makeLoginCtx();
    fake.respond(loginResponder({ WorldSeason: wire }));

    await runLoginWorld(fake);

    expect(fake.state.worldSeason).toBe(expected);
  });

  it('reports a non-numeric map size as unknown rather than NaN', async () => {
    const fake = makeLoginCtx();
    fake.respond(loginResponder({ WorldXSize: '%', WorldYSize: '%' }));

    const result = await runLoginWorld(fake);

    expect(fake.state.worldXSize).toBeNull();
    expect(fake.state.worldYSize).toBeNull();
    expect(result.worldXSize).toBeNull();
  });

  it('registers the virtual InterfaceEvents object before anything is sent', async () => {
    const fake = makeLoginCtx();
    fake.respond(loginResponder());

    await runLoginWorld(fake);

    // The server turns around and asks `idof "InterfaceEvents"` from inside
    // RegisterEventsById; an unresolvable name kills the handshake.
    const virtualId = fake.state.knownObjects.get('InterfaceEvents');
    expect(virtualId).toMatch(/^\d+$/);
    const known = fake.hooks.setKnownObject.mock.invocationCallOrder[0];
    const firstSend = fake.hooks.sendRdoRequest.mock.invocationCallOrder[0];
    expect(known).toBeLessThan(firstSend);
  });

  it('populates the world pool only after RegisterEventsById has bound the session', async () => {
    const fake = makeLoginCtx();
    fake.respond(loginResponder());

    await runLoginWorld(fake);

    // The pool is CONSTRUCTED at connect time and POPULATED later: `get
    // RDOCnntId` is answered with the id of the carrying connection
    // (RDOQueryServer.pas:269-274) and RegisterEventsById binds the ClientView
    // to it (InterfaceServer.pas:1919-1923).
    expect(fake.hooks.initWorldPool).toHaveBeenCalledWith('1.2.3.4', 8000);
    const construct = fake.hooks.initWorldPool.mock.invocationCallOrder[0];
    const populate = fake.hooks.populateWorldPool.mock.invocationCallOrder[0];
    const register = fake.hooks.sendRdoRequest.mock.invocationCallOrder[
      fake.sent.findIndex(s => s.packet.member === 'RegisterEventsById')
    ];
    expect(construct).toBeLessThan(register);
    expect(populate).toBeGreaterThan(register);
  });

  it('sends SetLanguage as a fire-and-forget push carrying the widestring "0"', async () => {
    const fake = makeLoginCtx();
    fake.respond(loginResponder());

    await runLoginWorld(fake);

    // %0, not #0: SetLanguage(langid: widestring). An integer nils the
    // widestring and every MLS hint lookup comes back empty.
    expect(fake.frames.world).toEqual([setLanguageFrame(CONTEXT_ID)]);
  });

  it('skips SetLanguage when the world socket died during the handshake', async () => {
    const fake = makeLoginCtx();
    const base = loginResponder();
    fake.respond((packet, index) => {
      // The socket is gone by the time the login reaches its push step.
      if (packet.member === 'RegisterEventsById') fake.ctx.deleteSocket('world');
      return base(packet, index);
    });

    await runLoginWorld(fake);

    expect(fake.frames.world).toEqual([]);
  });

  it('does not let a RegisterEventsById rejection fail the login', async () => {
    const fake = makeLoginCtx();
    const base = loginResponder();
    fake.respond((packet, index) => (packet.member === 'RegisterEventsById'
      ? new Error('Request timeout: RegisterEventsById')
      : base(packet, index)));

    await expect(runLoginWorld(fake)).resolves.toMatchObject({ contextId: CONTEXT_ID });
    await new Promise(resolve => setImmediate(resolve));
    expect(fake.log.debug).toHaveBeenCalledWith(
      '[Session] RegisterEventsById completed (or timed out, which is normal)',
    );
  });

  it('reads the context id out of a Logon answer that carries more than res=', async () => {
    const fake = makeLoginCtx();
    // cleanPayload() only unwraps a payload that is EXACTLY `res="…"`. When the
    // answer carries a second key the raw text survives, and the handler falls
    // back to the property extractor rather than shipping `res="#…` as an id.
    fake.respond(loginResponder({ Logon: `res="#${CONTEXT_ID}"\nDiag="%ok"` }));

    const result = await runLoginWorld(fake);

    expect(result.contextId).toBe(CONTEXT_ID);
    expect(fake.state.worldContextId).toBe(CONTEXT_ID);
  });

  const BAD_LOGONS: ReadonlyArray<[string, string]> = [
    ['res="%"', 'an empty result'],
    ['res="#0"', 'the zero context id'],
    ['error 5', 'an RDO error line'],
  ];

  it.each(BAD_LOGONS)('refuses to continue when Logon answers %s — %s', async (payload) => {
    const fake = makeLoginCtx();
    fake.respond(loginResponder({ Logon: payload }));

    await expect(runLoginWorld(fake)).rejects.toThrow(/Login failed/);
    expect(fake.state.worldContextId).toBeNull();
  });

  it('returns an empty company list when the ASP fetch fails', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNREFUSED'));
    const fake = makeLoginCtx();
    fake.respond(loginResponder());

    const result = await runLoginWorld(fake);

    expect(result.companies).toEqual([]);
    expect(fake.state.availableCompanies).toEqual([]);
    expect(fake.log.error).toHaveBeenCalledWith(
      '[HTTP] Failed to fetch companies:', expect.any(Error),
    );
  });

  it('parses the company table, defaulting the name and the owner role', async () => {
    fetchMock.mockResolvedValue({
      url: 'http://1.2.3.4/chooseCompany.asp',
      text: async () => '<td companyId="77">no attributes</td>',
    });
    const fake = makeLoginCtx();
    fake.respond(loginResponder());

    const result = await runLoginWorld(fake, WORLD, 'SPO_test3');

    expect(result.companies).toEqual([
      { id: '77', name: 'Company 77', ownerRole: 'SPO_test3' },
    ]);
  });

  it('encodes spaces as %20 in the logonComplete URL, as the Voyager client does', async () => {
    const fake = makeLoginCtx();
    fake.respond(loginResponder());

    await runLoginWorld(fake, WORLD, 'Mayor of Kalisz');

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain('UserName=Mayor%20of%20Kalisz');
    expect(url).not.toContain('+');
  });

  it('recovers the ClientViewId from the page body when the URL does not carry it', async () => {
    fetchMock.mockResolvedValue({
      url: 'http://1.2.3.4/chooseCompany.asp',
      text: async () => `<input name="ClientViewId" value="x"><!-- ClientViewId=${CONTEXT_ID} -->${COMPANY_HTML}`,
    });
    const fake = makeLoginCtx();
    fake.respond(loginResponder());

    await runLoginWorld(fake);

    expect(fake.log.debug).toHaveBeenCalledWith(
      `[HTTP] Found 2 companies, realContextId: ${CONTEXT_ID}`,
    );
  });

  it('falls back to Shamba in the ASP URL when no world name is known', async () => {
    const fake = makeLoginCtx();
    // WorldName answers empty, so the WorldInfo the caller passed is not rewritten.
    fake.respond(loginResponder({ WorldName: '%' }));

    await runLoginWorld(fake, { ...WORLD, name: '' });

    expect(String(fetchMock.mock.calls[0][0])).toContain('WorldName=Shamba');
  });

  it('treats an unreadable company count as zero', async () => {
    const fake = makeLoginCtx();
    fake.respond(loginResponder({ GetCompanyCount: '%' }));

    await runLoginWorld(fake);

    expect(fake.log.debug).toHaveBeenCalledWith('[Session] Company Count: 0');
  });

  it('reports a denial when the ASP redirect chain lands on logonNoAccess.asp', async () => {
    fetchMock.mockResolvedValue({
      url: 'http://1.2.3.4/Five/0/Visual/Voyager/NewLogon/logonNoAccess.asp?PA=01%2F01%2F2020&Logon=FALSE&ErrorCode=ERROR_REQUESTDENIED',
      text: async () => '<html>Your portal travel privileges expired</html>',
    });
    const fake = makeLoginCtx();
    fake.respond(loginResponder());

    const result = await runLoginWorld(fake);

    expect(result.loginPage).toEqual({ kind: 'denied', expiresOn: '01/01/2020' });
    expect(result.companies).toEqual([]);
    expect(fake.log.warn).toHaveBeenCalledWith(
      '[HTTP] Login denied by logonNoAccess.asp — access expired on 01/01/2020',
    );
  });

  it('reports an error when the ASP redirect chain lands on logonError.asp', async () => {
    fetchMock.mockResolvedValue({
      url: 'http://1.2.3.4/Five/0/Visual/Voyager/NewLogon/logonError.asp?ErrorCode=ERROR_FIVEISDOWN&Logon=FALSE',
      text: async () => '<html>Could not access the portal to this Planet!</html>',
    });
    const fake = makeLoginCtx();
    fake.respond(loginResponder());

    const result = await runLoginWorld(fake);

    expect(result.loginPage).toEqual({ kind: 'error', errorCode: 'ERROR_FIVEISDOWN' });
    expect(result.companies).toEqual([]);
  });

  it('shows the welcome (no loginPage) for a genuine newcomer: page reached, zero cells, count 0', async () => {
    fetchMock.mockResolvedValue({
      url: 'http://1.2.3.4/chooseCompany.asp',
      text: async () => '<html><body>no companies here</body></html>',
    });
    const fake = makeLoginCtx();
    fake.respond(loginResponder({ GetCompanyCount: '#0' }));

    const result = await runLoginWorld(fake);

    expect(result.loginPage).toBeUndefined();
    expect(result.companies).toEqual([]);
    expect(fake.log.error).not.toHaveBeenCalled();
  });

  it('logs an error and reports COMPANY_LIST_MISMATCH when GetCompanyCount > 0 but the scrape is empty', async () => {
    fetchMock.mockResolvedValue({
      url: 'http://1.2.3.4/chooseCompany.asp',
      text: async () => '<html><body>no companies here</body></html>',
    });
    const fake = makeLoginCtx();
    fake.respond(loginResponder()); // default GetCompanyCount: '#2'

    const result = await runLoginWorld(fake);

    expect(fake.log.error).toHaveBeenCalledWith(
      '[Session] GetCompanyCount says 2 but chooseCompany.asp listed none — company scrape failed',
    );
    expect(result.loginPage).toEqual({ kind: 'error', errorCode: 'COMPANY_LIST_MISMATCH' });
    expect(result.companies).toEqual([]);
  });

  it('gives up after 15 s when the InitClient push never arrives', async () => {
    jest.useFakeTimers();
    try {
      const fake = makeLoginCtx();
      fake.respond(loginResponder());

      const settled = loginWorld(fake.ctx, 'SPO_test3', 'test3', WORLD)
        .then(() => null, (err: Error) => err);

      // The server fires InitClient synchronously, BEFORE answering
      // RegisterEventsById. A login that never sees it is not a login — the
      // push channel is what the whole session runs on.
      await jest.advanceTimersByTimeAsync(0);
      await jest.advanceTimersByTimeAsync(15_001);

      await expect(settled).resolves.toMatchObject({
        message: 'InitClient push timeout after 15s',
      });
    } finally {
      jest.useRealTimers();
    }
  });
});

// ── Company selection ───────────────────────────────────────────────────────

describe('selectCompany', () => {
  const COMPANIES: CompanyInfo[] = [
    { id: '55', name: 'SPO_test3 - Green', ownerRole: 'SPO_test3' },
    { id: '56', name: 'Mayor of Kalisz', ownerRole: 'Mayor of Kalisz' },
  ];

  function selectResponder(overrides: Record<string, string> = {}): Responder {
    return (packet) => {
      const member = packet.member ?? '';
      if (overrides[member] !== undefined) return overrides[member];
      if (member === 'GetTycoonCookie') return 'res="%128"';
      return 'res="#0"';
    };
  }

  it('refuses to select a company before the world session exists', async () => {
    const fake = makeLoginCtx();

    await expect(selectCompany(fake.ctx, '55')).rejects.toThrow('Not logged into world');
    expect(fake.sent).toEqual([]);
  });

  it('carries the session ids into every frame and finishes in WORLD_CONNECTED', async () => {
    const fake = makeLoginCtx({
      sockets: ['world'],
      worldContextId: CONTEXT_ID,
      tycoonId: TYCOON_ID,
      availableCompanies: COMPANIES,
    });
    fake.respond(selectResponder());

    await selectCompany(fake.ctx, '56');

    expect(fake.state.currentCompany).toBe(COMPANIES[1]);
    // Order: EnableEvents → PickEvent → 3 cookies → ClientAware → PickEvent.
    expect(fake.sent.map(s => s.packet.member)).toEqual([
      'EnableEvents', 'PickEvent', 'GetTycoonCookie', 'GetTycoonCookie', 'GetTycoonCookie', 'PickEvent',
    ]);
    for (const request of fake.sent) {
      expect(request.packet.targetId).toBe(CONTEXT_ID);
      expect(request.category).toBe(TimeoutCategory.NORMAL);
    }
    // Wordbool TRUE is "#-1"; "%-1" would silently disable every push (O-L7).
    expect(fake.sent[0]).toMatchObject({ packet: { action: RdoAction.SET, args: ['"#-1"'] } });
    // PickEvent(TycoonId: integer) — the SESSION's tycoon id, as an integer.
    expect(fake.sent[1].packet.args).toEqual([`"#${TYCOON_ID}"`]);
    expect(fake.sent[2].packet.args).toEqual([`"#${TYCOON_ID}"`, '"%LastY.0"']);
    expect(fake.sent[3].packet.args).toEqual([`"#${TYCOON_ID}"`, '"%LastX.0"']);
    expect(fake.sent[4].packet.args).toEqual([`"#${TYCOON_ID}"`, '"%"']);
    // ClientAware is fire-and-forget, twice (live capture).
    const clientAware = RdoCommand.sel(CONTEXT_ID).call('ClientAware').push().build();
    expect(fake.frames.world).toEqual([clientAware, clientAware]);
    expect(fake.state.phase).toBe(SessionPhase.WORLD_CONNECTED);
    expect(fake.hooks.startServerBusyPolling).toHaveBeenCalledTimes(1);
    expect(fake.hooks.startGcSweep).toHaveBeenCalledTimes(1);
  });

  it('restores the camera from the cookies, and treats an unparsable one as 0', async () => {
    const fake = makeLoginCtx({
      sockets: ['world'], worldContextId: CONTEXT_ID, tycoonId: TYCOON_ID,
    });
    let cookie = 0;
    fake.respond((packet) => {
      if (packet.member !== 'GetTycoonCookie') return 'res="#0"';
      cookie += 1;
      return cookie === 1 ? 'res="%436"' : 'res="%"';
    });

    await selectCompany(fake.ctx, '55');

    expect(fake.state.lastPlayerY).toBe(436);
    expect(fake.state.lastPlayerX).toBe(0);
  });

  it('leaves currentCompany alone when the id is not in the list', async () => {
    const fake = makeLoginCtx({
      sockets: ['world'], worldContextId: CONTEXT_ID, tycoonId: TYCOON_ID,
      availableCompanies: COMPANIES,
    });
    fake.respond(selectResponder());

    await selectCompany(fake.ctx, '999');

    expect(fake.hooks.setCurrentCompany).not.toHaveBeenCalled();
    expect(fake.state.currentCompany).toBeNull();
  });

  it('fails loudly when EnableEvents is refused — a silent session receives no pushes', async () => {
    const fake = makeLoginCtx({
      sockets: ['world'], worldContextId: CONTEXT_ID, tycoonId: TYCOON_ID,
    });
    const refused: RdoPacket = {
      raw: '', type: 'RESPONSE', rid: 1, errorCode: 5, errorName: 'errIllegalObject',
    };
    fake.respond((packet) => (packet.member === 'EnableEvents' ? refused : 'res="#0"'));

    // P-L1 + P-M3: the reply used to be discarded, and this is the call that
    // turns pushes ON. Failing it silently is the O-H1 symptom — a session that
    // looks connected, loads the map, and never updates again.
    await expect(selectCompany(fake.ctx, '55')).rejects.toThrow(/EnableEvents failed \(errIllegalObject 5\)/);
    expect(fake.sent).toHaveLength(1);
    expect(fake.state.phase).not.toBe(SessionPhase.WORLD_CONNECTED);
  });

  it('names the refusal "error" when the server sent a code without a name', async () => {
    const fake = makeLoginCtx({
      sockets: ['world'], worldContextId: CONTEXT_ID, tycoonId: TYCOON_ID,
    });
    const unnamed: RdoPacket = { raw: '', type: 'RESPONSE', rid: 1, errorCode: 42 };
    fake.respond((packet) => (packet.member === 'EnableEvents' ? unnamed : 'res="#0"'));

    await expect(selectCompany(fake.ctx, '55')).rejects.toThrow(/EnableEvents failed \(error 42\)/);
  });

  it('emits nothing on the "*" channel when the world socket is gone', async () => {
    const fake = makeLoginCtx({ worldContextId: CONTEXT_ID, tycoonId: TYCOON_ID });
    fake.respond(selectResponder());

    await selectCompany(fake.ctx, '55');

    expect(fake.frames.world).toBeUndefined();
    expect(fake.state.phase).toBe(SessionPhase.WORLD_CONNECTED);
  });
});

// ── Company creation ────────────────────────────────────────────────────────

describe('createCompany', () => {
  const loggedIn = () => makeLoginCtx({ worldContextId: CONTEXT_ID, cachedUsername: 'SPO_test3' });

  it('refuses before the world session exists, without touching the wire', async () => {
    const fake = makeLoginCtx();

    await expect(createCompany(fake.ctx, 'Green Inc', 'Industry')).resolves.toEqual({
      success: false, companyName: '', companyId: '', message: 'Not connected to world',
    });
    expect(fake.sent).toEqual([]);
  });

  it('calls NewCompany on the ClientView with two OLEString arguments', async () => {
    const fake = loggedIn();
    fake.respond(() => 'res="%[Green Inc,55]"');

    await createCompany(fake.ctx, 'Green Inc', 'Industry');

    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]).toMatchObject({
      socketName: 'world',
      // Company creation is the heaviest mutation the client can ask for.
      category: TimeoutCategory.VERY_SLOW,
      packet: {
        verb: RdoVerb.SEL,
        targetId: CONTEXT_ID,
        action: RdoAction.CALL,
        member: 'NewCompany',
        separator: '"^"',
        args: ['"%Green Inc"', '"%Industry"'],
      },
    });
  });

  it('registers the company the server named, with the id the server assigned', async () => {
    const fake = loggedIn();
    fake.respond(() => 'res="%[Green Inc.,55]"');

    const result = await createCompany(fake.ctx, 'Green Inc', 'Industry');

    // The NAME and ID come back from the server — the request name is not reused.
    expect(result).toEqual({ success: true, companyName: 'Green Inc.', companyId: '55' });
    expect(fake.state.availableCompanies).toEqual([
      { id: '55', name: 'Green Inc.', ownerRole: 'SPO_test3' },
    ]);
  });

  it('falls back to an empty owner role when no username is cached', async () => {
    const fake = makeLoginCtx({ worldContextId: CONTEXT_ID });
    fake.respond(() => 'res="%[Green Inc,55]"');

    await createCompany(fake.ctx, 'Green Inc', 'Industry');

    expect(fake.state.availableCompanies).toEqual([{ id: '55', name: 'Green Inc', ownerRole: '' }]);
  });

  const CREATE_ERRORS: ReadonlyArray<[string, string]> = [
    ['6', 'Unknown cluster'],
    ['11', 'Company name already taken'],
    ['28', 'Zone tier mismatch'],
    ['33', 'Maximum number of companies reached'],
    ['41', 'Failed with error code 41'],
  ];

  it.each(CREATE_ERRORS)('maps the widestring error code %s to "%s"', async (code, message) => {
    const fake = loggedIn();
    fake.respond(() => `res="%${code}"`);

    await expect(createCompany(fake.ctx, 'Green Inc', 'Industry')).resolves.toEqual({
      success: false, companyName: '', companyId: '', message,
    });
    expect(fake.state.availableCompanies).toEqual([]);
  });

  it('reports a widestring result that is neither a pair nor a number', async () => {
    const fake = loggedIn();
    fake.respond(() => 'res="%not today"');

    await expect(createCompany(fake.ctx, 'Green Inc', 'Industry')).resolves.toMatchObject({
      success: false, message: 'Unexpected result: not today',
    });
  });

  it('reads an integer-typed error code too, negatives included', async () => {
    const fake = loggedIn();
    fake.respond(() => 'res="#-2"');

    await expect(createCompany(fake.ctx, 'Green Inc', 'Industry')).resolves.toMatchObject({
      success: false, message: 'Failed with error code -2',
    });
  });

  it('reports an answer it cannot read at all', async () => {
    const fake = loggedIn();
    fake.respond(() => 'objid="55"');

    await expect(createCompany(fake.ctx, 'Green Inc', 'Industry')).resolves.toMatchObject({
      success: false, message: 'Unexpected response from server',
    });
  });

  it('reports a bodiless ack the same way — a company was not created', async () => {
    const fake = loggedIn();
    fake.respond(() => EMPTY_ANSWER);

    await expect(createCompany(fake.ctx, 'Green Inc', 'Industry')).resolves.toMatchObject({
      success: false, message: 'Unexpected response from server',
    });
  });

  it('turns a transport failure into a failed result, never a rejection', async () => {
    const fake = loggedIn();
    fake.respond(() => new Error('Request timeout: NewCompany'));

    await expect(createCompany(fake.ctx, 'Green Inc', 'Industry')).resolves.toEqual({
      success: false, companyName: '', companyId: '', message: 'Request timeout: NewCompany',
    });
  });
});

// ── Company switching ───────────────────────────────────────────────────────

describe('switchCompany', () => {
  const GREEN: CompanyInfo = { id: '55', name: 'SPO_test3 - Green', ownerRole: 'SPO_test3' };
  const MAYOR: CompanyInfo = { id: '56', name: 'Mayor of Kalisz', ownerRole: 'Mayor of Kalisz' };

  function switchFake(): FakeLoginCtx {
    const fake = makeLoginCtx({
      sockets: ['world', 'map', 'construction', 'directory_auth', 'directory_query'],
      currentWorldInfo: WORLD,
      cachedUsername: 'SPO_test3',
      cachedPassword: 'test3',
      worldContextId: CONTEXT_ID,
      tycoonId: '1',
      interfaceServerId: 'stale',
      cacherId: 'stale',
      worldId: 'stale',
      daPort: 1,
      rdoCnntId: 'stale',
    });
    const login = loginResponder();
    fake.respond((packet, index) => {
      if (packet.member === 'GetTycoonCookie') return 'res="%0"';
      if (packet.member === 'EnableEvents' || packet.member === 'PickEvent') return 'res="#0"';
      return login(packet, index);
    });
    return fake;
  }

  /** switchCompany waits 200 ms between the re-login and selectCompany. */
  async function runSwitch(fake: FakeLoginCtx, company: CompanyInfo): Promise<void> {
    const promise = switchCompany(fake.ctx, company);
    promise.catch(() => { /* the caller awaits and asserts */ });
    await tickUntil(() => fake.state.initClientResolver !== null);
    fake.state.initClientResolver?.();
    return promise;
  }

  it('refuses without a world', async () => {
    const fake = makeLoginCtx({ cachedPassword: 'test3' });

    await expect(switchCompany(fake.ctx, GREEN)).rejects.toThrow(/world or credentials not available/);
  });

  it('refuses without cached credentials', async () => {
    const fake = makeLoginCtx({ currentWorldInfo: WORLD });

    await expect(switchCompany(fake.ctx, GREEN)).rejects.toThrow(/world or credentials not available/);
  });

  it('tears down every world-side socket but keeps the directory ones', async () => {
    const fake = switchFake();

    await runSwitch(fake, GREEN);

    const closed = fake.hooks.destroySocket.mock.calls.map(call => call[0]);
    expect(closed).toEqual(['world', 'map', 'construction']);
    for (const name of closed) {
      expect(fake.hooks.removeAllSocketListeners).toHaveBeenCalledWith(name);
      expect(fake.hooks.deleteFramer).toHaveBeenCalledWith(name);
    }
    expect(closed).not.toContain('directory_auth');
    expect(closed).not.toContain('directory_query');
    // KeepAlive must stop BEFORE the sockets go — it targets the map socket.
    expect(fake.hooks.stopCacherKeepAlive.mock.invocationCallOrder[0])
      .toBeLessThan(fake.hooks.destroySocket.mock.invocationCallOrder[0]);
  });

  it('drops every stale world id and re-logs in under the role name', async () => {
    const fake = switchFake();

    await runSwitch(fake, MAYOR);

    // The role IS the login identity for a role-based company.
    expect(fake.state.activeUsername).toBe('Mayor of Kalisz');
    const logon = fake.sent.find(s => s.packet.member === 'Logon');
    expect(logon?.packet.args).toEqual(['"%Mayor of Kalisz"', '"%test3"']);
    // Ids from the previous session are cleared before the new login fills them.
    expect(fake.hooks.clearAspActionCache).toHaveBeenCalledTimes(1);
    expect(fake.hooks.clearBuildingFocus).toHaveBeenCalledTimes(1);
    expect(fake.state.worldContextId).toBe(CONTEXT_ID);
    expect(fake.state.interfaceServerId).toBe(INTERFACE_SERVER_ID);
    expect(fake.state.phase).toBe(SessionPhase.WORLD_CONNECTED);
  });

  it('keeps the original username when the company carries no owner role', async () => {
    const fake = switchFake();

    await runSwitch(fake, { id: '55', name: 'SPO_test3 - Green' });

    expect(fake.state.activeUsername).toBe('SPO_test3');
    const logon = fake.sent.find(s => s.packet.member === 'Logon');
    expect(logon?.packet.args?.[0]).toBe('"%SPO_test3"');
  });

  it('logs on anonymously when neither the company nor the cache names a user', async () => {
    const fake = switchFake();
    fake.ctx.setCachedUsername(null);

    await runSwitch(fake, { id: '55', name: 'SPO_test3 - Green' });

    expect(fake.state.activeUsername).toBe('');
    const logon = fake.sent.find(s => s.packet.member === 'Logon');
    expect(logon?.packet.args?.[0]).toBe('"%"');
  });

  it('re-injects a company the refreshed ASP list does not yet carry', async () => {
    const fake = switchFake();
    const fresh: CompanyInfo = { id: '99', name: 'Brand New', ownerRole: 'SPO_test3' };

    await runSwitch(fake, fresh);

    // The ASP endpoint serves a cached page; a company created seconds ago is
    // missing from it, and selecting it would then find nothing.
    expect(fake.hooks.pushAvailableCompany).toHaveBeenCalledWith(fresh);
    expect(fake.log.warn).toHaveBeenCalledWith(expect.stringContaining('missing from refreshed list'));
    expect(fake.state.currentCompany).toBe(fresh);
  });

  it('does not re-inject a company the refreshed list already carries', async () => {
    const fake = switchFake();

    await runSwitch(fake, GREEN);

    expect(fake.hooks.pushAvailableCompany).not.toHaveBeenCalled();
  });
});

// ── Reconnection ────────────────────────────────────────────────────────────

describe('reconnectWorldSocket — the full re-login', () => {
  function reconnectFake(overrides: Record<string, string> = {}): FakeLoginCtx {
    const fake = makeLoginCtx({
      sockets: ['world'],
      currentWorldInfo: WORLD,
      cachedUsername: 'SPO_test3',
      cachedPassword: 'test3',
      worldContextId: CONTEXT_ID,
      interfaceServerId: 'stale-interface-id',
      rdoCnntId: 'stale-cnnt-id',
      tycoonId: '1',
    });
    fake.respond((packet) => {
      const member = packet.member ?? '';
      if (overrides[member] !== undefined) return overrides[member];
      if (packet.verb === RdoVerb.IDOF) return `objid="${INTERFACE_SERVER_ID}"`;
      if (member === 'Logon') return `res="#${NEW_CONTEXT_ID}"`;
      if (member === 'TycoonId') return `TycoonId="#${TYCOON_ID}"`;
      if (member === 'RDOCnntId') return `RDOCnntId="#${CNNT_ID}"`;
      if (member === 'GetTycoonCookie') return 'res="%0"';
      return 'res="#0"';
    });
    return fake;
  }

  it('re-reads every connection-bound id and re-arms the push channel', async () => {
    const fake = reconnectFake();

    await reconnectWorldSocket(fake.ctx);

    expect(fake.hooks.createSocket).toHaveBeenCalledWith('world', '1.2.3.4', 8000);
    expect(fake.hooks.initWorldPool).toHaveBeenCalledWith('1.2.3.4', 8000);
    // O-H2: RDOCnntId is the ADDRESS of the socket object
    // (WinSockRDOConnectionsServer.pas:664-668). Reusing the one read from the
    // dead socket either matched nothing or matched another client's wire.
    expect(fake.state.interfaceServerId).toBe(INTERFACE_SERVER_ID);
    expect(fake.state.rdoCnntId).toBe(CNNT_ID);
    expect(fake.state.worldContextId).toBe(NEW_CONTEXT_ID);
    expect(fake.state.tycoonId).toBe(TYCOON_ID);
    const register = fake.sent.find(s => s.packet.member === 'RegisterEventsById');
    expect(register?.packet.targetId).toBe(NEW_CONTEXT_ID);
    expect(register?.packet.args).toEqual([`"#${CNNT_ID}"`]);
    // Same ordering rule as the initial login.
    expect(fake.hooks.populateWorldPool).toHaveBeenCalledTimes(1);
  });

  it('re-sends SetLanguage against the NEW context id', async () => {
    const fake = reconnectFake();

    await reconnectWorldSocket(fake.ctx);

    expect(fake.frames.world).toContain(setLanguageFrame(NEW_CONTEXT_ID));
  });

  it('reads the context id out of a Logon answer that carries more than res=', async () => {
    const fake = reconnectFake({ Logon: `res="#${NEW_CONTEXT_ID}"\nDiag="%ok"` });

    await reconnectWorldSocket(fake.ctx);

    expect(fake.state.worldContextId).toBe(NEW_CONTEXT_ID);
  });

  const BAD_RELOGONS: ReadonlyArray<[string, string]> = [
    ['res="%"', 'an empty result'],
    ['res="#0"', 'the zero context id'],
  ];

  it.each(BAD_RELOGONS)('gives up when the re-Logon answers %s — %s', async (payload) => {
    const fake = reconnectFake({ Logon: payload });

    await expect(reconnectWorldSocket(fake.ctx)).rejects.toThrow('Re-login failed');
  });

  it('gives up when the idof resolved to nothing', async () => {
    // `objid="#"` is a resolved-to-nothing answer: parseIdOfResponse strips the
    // type prefix and hands back an empty id, so there is nothing to Logon to.
    const fake = reconnectFake();
    fake.respond((packet) => (packet.verb === RdoVerb.IDOF ? 'objid="#"' : 'res="#0"'));

    await expect(reconnectWorldSocket(fake.ctx)).rejects.toThrow('No interfaceServerId for re-login');
    expect(fake.state.interfaceServerId).toBe('');
  });

  it('gives up without credentials, before opening anything', async () => {
    const fake = reconnectFake();
    fake.ctx.setCachedPassword(null);

    await expect(reconnectWorldSocket(fake.ctx)).rejects.toThrow('No cached credentials for re-login');
  });

  it('does not re-register events when the new connection id came back empty', async () => {
    const fake = reconnectFake({ RDOCnntId: 'RDOCnntId="%"' });

    await reconnectWorldSocket(fake.ctx);

    expect(fake.state.rdoCnntId).toBe('');
    expect(fake.sent.some(s => s.packet.member === 'RegisterEventsById')).toBe(false);
    // SetLanguage still goes out — the session exists, only the push channel does not.
    expect(fake.frames.world.some(f => f.includes('SetLanguage'))).toBe(true);
  });

  it('survives a RegisterEventsById that never answers', async () => {
    const fake = reconnectFake();
    fake.respond((packet) => {
      if (packet.member === 'RegisterEventsById') return new Error('Request timeout: RegisterEventsById');
      if (packet.verb === RdoVerb.IDOF) return `objid="${INTERFACE_SERVER_ID}"`;
      if (packet.member === 'Logon') return `res="#${NEW_CONTEXT_ID}"`;
      if (packet.member === 'TycoonId') return `TycoonId="#${TYCOON_ID}"`;
      if (packet.member === 'RDOCnntId') return `RDOCnntId="#${CNNT_ID}"`;
      return 'res="#0"';
    });

    await expect(reconnectWorldSocket(fake.ctx)).resolves.toBeUndefined();
    // The rejection is handled out of band — let its handler run before asserting.
    await new Promise(resolve => setImmediate(resolve));
    expect(fake.log.debug).toHaveBeenCalledWith(
      '[Reconnect] RegisterEventsById completed (or timed out, normal)',
    );
  });

  it('re-selects the company that was active before the drop', async () => {
    const fake = reconnectFake();
    fake.ctx.setCurrentCompany({ id: '55', name: 'SPO_test3 - Green' });

    await reconnectWorldSocket(fake.ctx);

    // selectCompany runs against the NEW ClientView, not the dead one.
    const enable = fake.sent.find(s => s.packet.member === 'EnableEvents');
    expect(enable?.packet.targetId).toBe(NEW_CONTEXT_ID);
    expect(fake.state.phase).toBe(SessionPhase.WORLD_CONNECTED);
  });

  it('stops short of company selection when none was active', async () => {
    const fake = reconnectFake();

    await reconnectWorldSocket(fake.ctx);

    expect(fake.sent.some(s => s.packet.member === 'EnableEvents')).toBe(false);
  });
});
