import { WsMessageType } from '@/shared/types/message-types';
import type { WsMessage } from '@/shared/types/message-types';
import type { CompanyInfo, TownInfo } from '@/shared/types/domain-types';
import { WsDriver, WsDriverError } from './ws-driver';
import {
  awaitResumeToken,
  findTown,
  resolveVisualClass,
  listTowns,
  login,
  loginSecondary,
  logoff,
  pickCompany,
  propertyValue,
  readBuildingDetails,
  resumeSession,
  setBuildingProperty,
  switchToMayor,
  type LiveSession,
} from './session';
import { PRIMARY_ACCOUNT } from './config';
import { DIR_ERROR_InvalidPassword, DIR_ERROR_Unknown } from '@/shared/directory-error-codes';
import { ERROR_InvalidLogonData, ERROR_InvalidPassword, ERROR_Unknown } from '@/shared/error-codes';

type Responder = (msg: WsMessage) => unknown;

function stubDriver(responder: Responder) {
  const close = jest.fn(async () => undefined);
  return {
    close,
    log: [] as { direction: string }[],
    errors: [] as WsMessage[],
    request: jest.fn(async (msg: WsMessage) => responder(msg)),
    send: jest.fn(),
    seen: jest.fn(() => []),
    waitFor: jest.fn(
      async (_match: (msg: WsMessage) => boolean, _timeout?: number, _label?: string) => ({
        type: WsMessageType.RESP_CAPITOL_COORDS,
      }),
    ),
  };
}

function sessionWith(responder: Responder): LiveSession {
  return {
    driver: stubDriver(responder) as unknown as WsDriver,
    account: PRIMARY_ACCOUNT,
    company: { id: '1', name: 'SPO_test3 - Green' },
    worlds: 3,
    companies: [],
    playerX: 0,
    playerY: 0,
  };
}

const town: TownInfo = {
  name: 'Helartia',
  iconUrl: '',
  mayor: 'SPO_test3',
  population: 1,
  unemploymentPercent: 0,
  qualityOfLife: 0,
  x: 100,
  y: 200,
  path: '',
  classId: '512',
};

describe('pickCompany', () => {
  const own: CompanyInfo = { id: '1', name: 'SPO_test3 - Green' };
  const role: CompanyInfo = { id: '2', name: 'Mayor of Helartia', ownerRole: 'Mayor' };

  it('prefers the tycoon company over a civic role company', () => {
    expect(pickCompany([role, own], 'SPO_test3').id).toBe('1');
  });

  it('accepts a company whose ownerRole is the tycoon themself', () => {
    const self: CompanyInfo = { id: '3', name: 'SPO_test3 - Blue', ownerRole: 'SPO_test3' };
    expect(pickCompany([self], 'SPO_test3').id).toBe('3');
  });

  it('falls back to the first entry when nothing matches the naming convention', () => {
    expect(pickCompany([{ id: '9', name: 'Something Else' }], 'SPO_test3').id).toBe('9');
  });

  it('refuses when the world returned no company at all', () => {
    expect(() => pickCompany([], 'SPO_test3')).toThrow(/No company/);
  });
});

describe('switchToMayor', () => {
  const own: CompanyInfo = { id: '1', name: 'SPO_test3 - Green' };
  const minister: CompanyInfo = { id: '9', name: 'Ministry', ownerRole: 'Minister of Agriculture' };
  const mayor: CompanyInfo = { id: '7', name: 'Helartia Town', ownerRole: 'Mayor of Helartia' };

  function withCompanies(companies: CompanyInfo[], responder: Responder = () => ({ result: '' })) {
    const s = sessionWith(responder);
    s.companies = companies;
    return s;
  }

  it('sends REQ_SWITCH_COMPANY with the Mayor entry, not a Minister listed first, and returns it', async () => {
    const s = withCompanies([own, minister, mayor]);
    await expect(switchToMayor(s)).resolves.toBe(mayor);
    expect(s.driver.request).toHaveBeenCalledTimes(1);
    expect(s.driver.request).toHaveBeenCalledWith(
      { type: WsMessageType.REQ_SWITCH_COMPANY, company: mayor },
      WsMessageType.RESP_RDO_RESULT,
      expect.any(Number),
    );
  });

  it('matches the ownerRole case-insensitively', async () => {
    const lower = { ...mayor, ownerRole: 'MAYOR OF helartia' };
    await expect(switchToMayor(withCompanies([minister, lower]))).resolves.toBe(lower);
  });

  it('throws naming the entries, having sent nothing, when there is no Mayor entry', async () => {
    const s = withCompanies([own, minister]);
    await expect(switchToMayor(s)).rejects.toThrow(
      'No Mayor of Helartia entry in the company list: SPO_test3 - Green [], Ministry [Minister of Agriculture]',
    );
    expect(s.driver.request).not.toHaveBeenCalled();
  });

  it('names an empty list (empty)', async () => {
    await expect(switchToMayor(withCompanies([]))).rejects.toThrow(/company list: \(empty\)$/);
  });

  it('propagates a RESP_ERROR from the switch', async () => {
    const s = withCompanies([mayor], msg => {
      throw new WsDriverError('refused', 42, msg.type);
    });
    await expect(switchToMayor(s)).rejects.toBeInstanceOf(WsDriverError);
  });
});

describe('login', () => {
  afterEach(() => jest.restoreAllMocks());

  function loginResponder(worlds = [{ name: 'planitia' }]): Responder {
    return msg => {
      switch (msg.type) {
        case WsMessageType.REQ_AUTH_CHECK:
          return { type: WsMessageType.RESP_AUTH_SUCCESS };
        case WsMessageType.REQ_CONNECT_DIRECTORY:
          return { type: WsMessageType.RESP_CONNECT_SUCCESS, worlds };
        case WsMessageType.REQ_LOGIN_WORLD:
          return {
            type: WsMessageType.RESP_LOGIN_SUCCESS,
            companies: [{ id: '1', name: 'SPO_test3 - Green' }],
          };
        default:
          return { type: WsMessageType.RESP_RDO_RESULT, result: '' };
      }
    };
  }

  it('drives the spine in order and selects a company', async () => {
    const driver = stubDriver(loginResponder());
    jest.spyOn(WsDriver, 'connect').mockResolvedValue(driver as unknown as WsDriver);

    const session = await login(PRIMARY_ACCOUNT);
    const order = driver.request.mock.calls.map(call => (call[0] as WsMessage).type);
    expect(order).toEqual([
      WsMessageType.REQ_AUTH_CHECK,
      WsMessageType.REQ_CONNECT_DIRECTORY,
      WsMessageType.REQ_LOGIN_WORLD,
      WsMessageType.REQ_SELECT_COMPANY,
    ]);
    expect(session.company.name).toBe('SPO_test3 - Green');
    expect(session.worlds).toBe(1);
    expect(session.world).toEqual({ name: 'planitia' });
  });

  it('keeps the saved position the select-company reply carried', async () => {
    const base = loginResponder();
    const driver = stubDriver(msg =>
      msg.type === WsMessageType.REQ_SELECT_COMPANY
        ? { type: WsMessageType.RESP_RDO_RESULT, result: '', playerX: 321, playerY: 654 }
        : base(msg),
    );
    jest.spyOn(WsDriver, 'connect').mockResolvedValue(driver as unknown as WsDriver);

    const session = await login(PRIMARY_ACCOUNT);
    expect([session.playerX, session.playerY]).toEqual([321, 654]);
  });

  it('defaults the saved position to 0,0 when the reply carries none', async () => {
    const driver = stubDriver(loginResponder());
    jest.spyOn(WsDriver, 'connect').mockResolvedValue(driver as unknown as WsDriver);

    const session = await login(PRIMARY_ACCOUNT);
    expect([session.playerX, session.playerY]).toEqual([0, 0]);
  });

  it('waits for the search menu before handing the session back', async () => {
    const driver = stubDriver(loginResponder());
    jest.spyOn(WsDriver, 'connect').mockResolvedValue(driver as unknown as WsDriver);

    await login(PRIMARY_ACCOUNT);

    // Company selection returns before the gateway has built its search menu
    // (server.ts:1191-1229); RESP_CAPITOL_COORDS is the push that says it exists.
    expect(driver.waitFor).toHaveBeenCalled();
    const label = driver.waitFor.mock.calls[0][2];
    expect(label).toMatch(/RESP_CAPITOL_COORDS/);
  });

  it('says which worlds it did see when the target world is missing', async () => {
    const driver = stubDriver(loginResponder([{ name: 'aries' }]));
    jest.spyOn(WsDriver, 'connect').mockResolvedValue(driver as unknown as WsDriver);
    await expect(login(PRIMARY_ACCOUNT)).rejects.toThrow(/got: aries/);
  });

  it('closes the driver and rethrows when the spine fails', async () => {
    const driver = stubDriver(loginResponder([{ name: 'aries' }]));
    jest.spyOn(WsDriver, 'connect').mockResolvedValue(driver as unknown as WsDriver);
    await expect(login(PRIMARY_ACCOUNT)).rejects.toThrow(/got: aries/);
    expect(driver.close).toHaveBeenCalledTimes(1);
  });

  it('logoff sends REQ_LOGOUT, awaits RESP_LOGOUT, and only then closes', async () => {
    const order: string[] = [];
    const session = sessionWith(() => {
      order.push('request');
      return { type: WsMessageType.RESP_LOGOUT, success: true };
    });
    (session.driver.close as jest.Mock).mockImplementation(async () => {
      order.push('close');
    });
    await logoff(session);
    expect(session.driver.request).toHaveBeenCalledWith(
      { type: WsMessageType.REQ_LOGOUT },
      WsMessageType.RESP_LOGOUT,
      expect.any(Number),
    );
    expect(order).toEqual(['request', 'close']);
  });

  it('logoff still closes, and does not throw, when the logout request fails', async () => {
    const session = sessionWith(() => {
      throw new Error('Cannot send REQ_LOGOUT: driver is closed');
    });
    await expect(logoff(session)).resolves.toBeUndefined();
    expect(session.driver.close).toHaveBeenCalledTimes(1);
  });
});

describe('findTown', () => {
  it('returns the town by name', async () => {
    const session = sessionWith(() => ({ type: WsMessageType.RESP_SEARCH_MENU_TOWNS, towns: [town] }));
    expect((await findTown(session, 'Helartia')).x).toBe(100);
  });

  it('does not rely on the mayor field, which the world reports as null', async () => {
    const session = sessionWith(() => ({
      type: WsMessageType.RESP_SEARCH_MENU_TOWNS,
      towns: [{ ...town, mayor: null }],
    }));
    await expect(findTown(session, 'Helartia')).resolves.toMatchObject({ name: 'Helartia' });
  });

  it('says how many towns it did see when the name is absent', async () => {
    const session = sessionWith(() => ({
      type: WsMessageType.RESP_SEARCH_MENU_TOWNS,
      towns: [{ ...town, name: 'Elsewhere' }],
    }));
    await expect(findTown(session, 'Helartia')).rejects.toThrow(/\(1 listed\)/);
  });

  it('listTowns returns whatever the world listed', async () => {
    const session = sessionWith(() => ({ type: WsMessageType.RESP_SEARCH_MENU_TOWNS, towns: [town] }));
    expect(await listTowns(session)).toHaveLength(1);
  });
});

describe('resolveVisualClass', () => {
  const mapWith = (buildings: unknown[]) => () => ({
    type: WsMessageType.RESP_MAP_DATA,
    data: { x: 0, y: 0, w: 0, h: 0, buildings, segments: [] },
  });

  it('reads the class of the building anchored at the coordinate', async () => {
    const session = sessionWith(
      mapWith([
        { x: 100, y: 200, visualClass: '7010' },
        { x: 101, y: 200, visualClass: '9999' },
      ]),
    );
    expect(await resolveVisualClass(session, 100, 200)).toBe('7010');
  });

  it('loads a window around the coordinate, clamped at the world edge', async () => {
    const session = sessionWith(mapWith([{ x: 2, y: 3, visualClass: '7010' }]));
    await resolveVisualClass(session, 2, 3, 8);
    const sent = (session.driver.request as unknown as jest.Mock).mock.calls[0][0];
    expect(sent).toMatchObject({ x: 0, y: 0, width: 17, height: 17 });
  });

  it('fails clearly when nothing is anchored there', async () => {
    const session = sessionWith(mapWith([{ x: 1, y: 1, visualClass: '7010' }]));
    await expect(resolveVisualClass(session, 100, 200)).rejects.toThrow(/none anchored there/);
  });

  it('fails when the map window comes back empty', async () => {
    const session = sessionWith(mapWith([]));
    await expect(resolveVisualClass(session, 100, 200)).rejects.toThrow(/0 building\(s\)/);
  });
});

describe('building reads and writes', () => {
  it('reads details for a coordinate and visual class', async () => {
    const session = sessionWith(msg => ({
      type: WsMessageType.RESP_BUILDING_DETAILS,
      details: { visualClass: (msg as unknown as { visualClass: string }).visualClass },
    }));
    const details = await readBuildingDetails(session, 1, 2, '512');
    expect(details.visualClass).toBe('512');
  });

  it('passes the additional params the tax row index needs', async () => {
    const session = sessionWith(() => ({
      type: WsMessageType.RESP_BUILDING_SET_PROPERTY,
      success: true,
      propertyName: 'RDOSetTaxValue',
      newValue: '8',
    }));
    await setBuildingProperty(session, 1, 2, 'RDOSetTaxValue', '8', { index: '0' });
    const sent = (session.driver.request as unknown as jest.Mock).mock.calls[0][0];
    expect(sent).toMatchObject({ propertyName: 'RDOSetTaxValue', additionalParams: { index: '0' } });
  });
});

describe('propertyValue', () => {
  const groups = { townTaxes: [{ name: 'Tax0Percent', value: '7' }] };

  it('finds a property inside its group', () => {
    expect(propertyValue(groups, 'townTaxes', 'Tax0Percent')).toBe('7');
  });

  it('is undefined for an absent property', () => {
    expect(propertyValue(groups, 'townTaxes', 'Tax9Percent')).toBeUndefined();
  });

  it('is undefined for an absent group rather than throwing', () => {
    expect(propertyValue(groups, 'townJobs', 'hiMinSalary')).toBeUndefined();
  });
});

describe('awaitResumeToken', () => {
  it('returns the token of the EVENT_SESSION_RESUME_TOKEN push', async () => {
    const driver = stubDriver(() => undefined);
    driver.waitFor.mockResolvedValue({
      type: WsMessageType.EVENT_SESSION_RESUME_TOKEN,
      token: 'tok-1',
    } as unknown as { type: WsMessageType.RESP_CAPITOL_COORDS });
    expect(await awaitResumeToken(driver as unknown as WsDriver)).toBe('tok-1');
    const match = driver.waitFor.mock.calls[0][0];
    expect(match({ type: WsMessageType.EVENT_SESSION_RESUME_TOKEN })).toBe(true);
    expect(match({ type: WsMessageType.RESP_CAPITOL_COORDS })).toBe(false);
  });
});

describe('resumeSession', () => {
  afterEach(() => jest.restoreAllMocks());

  it('sends REQ_RESUME_SESSION first on a fresh socket and returns the driver and snapshot', async () => {
    const snapshot = { type: WsMessageType.RESP_RESUME_SESSION, company: { id: '1', name: 'SPO_test3 - Green' } };
    const driver = stubDriver(() => snapshot);
    jest.spyOn(WsDriver, 'connect').mockResolvedValue(driver as unknown as WsDriver);

    const resumed = await resumeSession(PRIMARY_ACCOUNT, 'tok-1');

    expect(resumed.driver).toBe(driver);
    expect(resumed.snapshot).toBe(snapshot);
    expect(driver.request).toHaveBeenCalledTimes(1);
    expect(driver.request).toHaveBeenCalledWith(
      { type: WsMessageType.REQ_RESUME_SESSION, username: 'SPO_test3', token: 'tok-1' },
      WsMessageType.RESP_RESUME_SESSION,
      expect.any(Number),
    );
    expect(driver.close).not.toHaveBeenCalled();
  });

  it('closes the socket and rethrows the refusal', async () => {
    const refusal = new WsDriverError('refused', 15, WsMessageType.REQ_RESUME_SESSION);
    const driver = stubDriver(() => {
      throw refusal;
    });
    jest.spyOn(WsDriver, 'connect').mockResolvedValue(driver as unknown as WsDriver);

    await expect(resumeSession(PRIMARY_ACCOUNT, 'old')).rejects.toBe(refusal);
    expect(driver.close).toHaveBeenCalledTimes(1);
  });
});

describe('loginSecondary', () => {
  afterEach(() => jest.restoreAllMocks());

  /** A spine that answers every step, except `refuseOn`, which fails with `err`. */
  function refusing(refuseOn: string | null, err: (msg: WsMessage) => Error) {
    const driver = stubDriver(msg => {
      if (msg.type === refuseOn) throw err(msg);
      switch (msg.type) {
        case WsMessageType.REQ_AUTH_CHECK:
          return { type: WsMessageType.RESP_AUTH_SUCCESS };
        case WsMessageType.REQ_CONNECT_DIRECTORY:
          return { type: WsMessageType.RESP_CONNECT_SUCCESS, worlds: [{ name: 'planitia' }] };
        case WsMessageType.REQ_LOGIN_WORLD:
          return { type: WsMessageType.RESP_LOGIN_SUCCESS, companies: [{ id: '5', name: 'Crazz - Red' }] };
        default:
          return { type: WsMessageType.RESP_RDO_RESULT, result: '' };
      }
    });
    jest.spyOn(WsDriver, 'connect').mockResolvedValue(driver as unknown as WsDriver);
    return driver;
  }
  const typed = (code: number) => (msg: WsMessage) => new WsDriverError('refused', code, msg.type);

  it('logs the second account in when nothing refuses it', async () => {
    const driver = refusing(null, typed(0));
    const result = await loginSecondary();
    expect('skipped' in result).toBe(false);
    expect(driver.request.mock.calls[0][0]).toMatchObject({
      type: WsMessageType.REQ_AUTH_CHECK,
      username: 'Crazz',
    });
  });

  it('skips on a named directory refusal at REQ_AUTH_CHECK, and closes the socket', async () => {
    const driver = refusing(WsMessageType.REQ_AUTH_CHECK, typed(DIR_ERROR_InvalidPassword));
    const result = await loginSecondary();
    expect(result).toEqual({
      skipped: expect.stringMatching(/^Crazz refused at REQ_AUTH_CHECK \(code 7\): refused$/),
    });
    expect(driver.close).toHaveBeenCalledTimes(1);
  });

  it('skips on ERROR_InvalidPassword at REQ_LOGIN_WORLD', async () => {
    refusing(WsMessageType.REQ_LOGIN_WORLD, typed(ERROR_InvalidPassword));
    expect(await loginSecondary()).toEqual({ skipped: expect.stringMatching(/REQ_LOGIN_WORLD \(code 13\)/) });
  });

  it.each([
    ['DIR_ERROR_Unknown', WsMessageType.REQ_AUTH_CHECK, DIR_ERROR_Unknown],
    ['ERROR_InvalidLogonData', WsMessageType.REQ_AUTH_CHECK, ERROR_InvalidLogonData],
    ['ERROR_Unknown', WsMessageType.REQ_CONNECT_DIRECTORY, ERROR_Unknown],
    ['a named refusal', WsMessageType.REQ_CONNECT_DIRECTORY, DIR_ERROR_InvalidPassword],
    ['missing credentials', WsMessageType.REQ_CONNECT_DIRECTORY, ERROR_InvalidLogonData],
    ['ERROR_Unknown', WsMessageType.REQ_LOGIN_WORLD, ERROR_Unknown],
    ['a code outside the credential refusals', WsMessageType.REQ_SELECT_COMPANY, ERROR_InvalidPassword],
  ])('rethrows %s on %s', async (_label, type, code) => {
    const refusal = new WsDriverError('refused', code, type);
    refusing(type, () => refusal);
    await expect(loginSecondary()).rejects.toBe(refusal);
  });

  it('rethrows a timeout', async () => {
    refusing(WsMessageType.REQ_AUTH_CHECK, () => new Error('Timed out waiting for RESP_AUTH_SUCCESS'));
    await expect(loginSecondary()).rejects.toThrow(/Timed out/);
  });
});
