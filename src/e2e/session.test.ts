import { WsMessageType } from '@/shared/types/message-types';
import type { WsMessage } from '@/shared/types/message-types';
import type { CompanyInfo, TownInfo } from '@/shared/types/domain-types';
import { WsDriver } from './ws-driver';
import {
  findTown,
  resolveVisualClass,
  listTowns,
  login,
  logoff,
  pickCompany,
  propertyValue,
  readBuildingDetails,
  setBuildingProperty,
  type LiveSession,
} from './session';
import { PRIMARY_ACCOUNT } from './config';

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

  it('logoff closes the socket so the gateway issues its Logoff', async () => {
    const session = sessionWith(() => undefined);
    await logoff(session);
    expect(session.driver.close).toHaveBeenCalled();
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
