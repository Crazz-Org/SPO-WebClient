import { WsMessageType, type WsMessage } from '@/shared/types/message-types';
import { CAPABILITIES, capabilitiesFor, checkCapability } from './capability';
import { PRIMARY_ACCOUNT } from './config';
import * as session from './session';
import type { WsDriver } from './ws-driver';

interface StubOptions {
  hasCapitol?: boolean;
  isPresident?: boolean;
  canGovern?: boolean;
  requestThrows?: boolean;
}

function stubSession(opts: StubOptions = {}): session.LiveSession {
  const { hasCapitol = true, isPresident = false, canGovern = false, requestThrows = false } = opts;
  return {
    driver: {
      waitFor: jest.fn(async () => ({
        type: WsMessageType.RESP_CAPITOL_COORDS,
        x: 120,
        y: 340,
        hasCapitol,
      })),
      request: jest.fn(async (msg: WsMessage) => {
        if (requestThrows) throw new Error('gateway closed the socket');
        if (msg.type === WsMessageType.REQ_TYCOON_ROLE) {
          return { type: WsMessageType.RESP_TYCOON_ROLE, role: { isPresident } };
        }
        throw new Error(`unexpected ${msg.type}`);
      }),
      seen: jest.fn(() => []),
      errors: [],
    } as unknown as WsDriver,
    account: PRIMARY_ACCOUNT,
    company: { id: '1', name: 'SPO_test3 - Green' },
    worlds: 3,
    companies: [],
    playerX: 0,
    playerY: 0,
  };
}

afterEach(() => jest.restoreAllMocks());

describe('capabilitiesFor', () => {
  it('is empty when no catalogued member is touched', () => {
    expect(capabilitiesFor(['RDOSetTaxValue'])).toEqual([]);
  });

  it('names the presidency for any TPresidentialHall member', () => {
    expect(capabilitiesFor(['RDOSitMayor'])).toEqual(['president']);
    expect(CAPABILITIES.president.members).toContain('RDOSitMayor');
  });
});

describe('checkCapability(president) — read from the server, never from the UI', () => {
  function arm(opts: StubOptions): { stub: session.LiveSession; logoff: jest.SpyInstance } {
    const stub = stubSession(opts);
    jest.spyOn(session, 'login').mockResolvedValue(stub);
    const logoff = jest.spyOn(session, 'logoff').mockResolvedValue(undefined);
    jest.spyOn(session, 'resolveVisualClass').mockResolvedValue('Capitol');
    jest
      .spyOn(session, 'readBuildingDetails')
      .mockResolvedValue({ canGovern: opts.canGovern ?? false } as Awaited<
        ReturnType<typeof session.readBuildingDetails>
      >);
    return { stub, logoff };
  }

  it('is NOT granted when the Capitol refuses governance — with both server facts as evidence', async () => {
    const { logoff } = arm({ isPresident: false, canGovern: false });
    const evidence = await checkCapability('president');
    expect(evidence).toMatchObject({ determined: true, granted: false, account: 'SPO_test3' });
    expect(evidence.checks.map(c => `${c.what}=${c.value}`)).toEqual([
      'the world has a Capitol=(120,340)',
      'tycoon cache IsPresident=false',
      'canGovern on the Capitol (server grantAccess)=false',
    ]);
    expect(logoff).toHaveBeenCalled();
  });

  it('is granted when the server grants access to the Capitol', async () => {
    arm({ isPresident: true, canGovern: true });
    const evidence = await checkCapability('president');
    expect(evidence.determined).toBe(true);
    expect(evidence.granted).toBe(true);
  });

  it('follows canGovern, not the cache flag, when they disagree', async () => {
    arm({ isPresident: true, canGovern: false });
    const evidence = await checkCapability('president');
    expect(evidence.granted).toBe(false);
    expect(evidence.checks[1].value).toBe('true');
  });

  it('is determined and not granted in a world without a Capitol', async () => {
    const { stub } = arm({ hasCapitol: false });
    const evidence = await checkCapability('president');
    expect(evidence).toMatchObject({ determined: true, granted: false });
    expect(evidence.checks).toEqual([{ what: 'the world has a Capitol', value: 'false' }]);
    expect(stub.driver.request).not.toHaveBeenCalled();
  });

  it('is undetermined, with the reason, when the login itself fails', async () => {
    jest.spyOn(session, 'login').mockRejectedValue(new Error('auth refused'));
    const evidence = await checkCapability('president');
    expect(evidence.determined).toBe(false);
    expect(evidence.granted).toBe(false);
    expect(evidence.error).toMatch(/login failed: auth refused/);
  });

  it('is undetermined when a read fails mid-way, and still logs off', async () => {
    const { logoff } = arm({ requestThrows: true });
    const evidence = await checkCapability('president');
    expect(evidence.determined).toBe(false);
    expect(evidence.error).toMatch(/gateway closed the socket/);
    expect(logoff).toHaveBeenCalled();
  });
});
