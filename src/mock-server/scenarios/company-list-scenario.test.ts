/// <reference path="../../server/__tests__/matchers/rdo-matchers.d.ts" />

/**
 * Proves the L1 exchanges the criterion asks for: the five indexed company
 * reads carry an INTEGER index and answer the captured company field by field,
 * a CompanyPage.asp request naming a company is matched, the served markup
 * parses to COMPANY_PAGE_TREE through the real gateway (StarpeaceSession ->
 * fetchCompanyProfitLoss), and the active company is never what was sent or
 * what was switched to.
 */

jest.mock('node-fetch', () => ({ __esModule: true, default: jest.fn() }));

import fetch from 'node-fetch';
import { StarpeaceSession } from '@/server/spo_session';
import { RdoProtocol } from '@/server/rdo';
import { HttpMock } from '../http-mock';
import { RdoMock } from '../rdo-mock';
import { RdoStrictValidator, ViolationType } from '../rdo-strict-validator';
import { DEFAULT_VARIABLES } from './scenario-variables';
import { createCompanyListScenario, COMPANY_PAGE_TREE, CAPTURED_COMPANY } from './company-list-scenario';

const fetchMock = fetch as unknown as jest.Mock;

describe('company-list scenario — the five indexed company reads', () => {
  const { rdo } = createCompanyListScenario();

  /** Every field the login path reads, with the answer it must come back with. */
  const FIELDS: ReadonlyArray<[string, string]> = [
    ['GetCompanyOwnerRole', `%${CAPTURED_COMPANY.ownerRole}`],
    ['GetCompanyName', `%${CAPTURED_COMPANY.name}`],
    ['GetCompanyId', `#${CAPTURED_COMPANY.id}`],
    ['GetCompanyCluster', `%${CAPTURED_COMPANY.cluster}`],
    ['GetCompanyFacilityCount', `#${CAPTURED_COMPANY.facilityCount}`],
  ];

  it('passes strict RDO validation', () => {
    expect(rdo).toPassStrictRdoValidation();
  });

  it('carries the count read and the five CALLs, in the ASP\'s order', () => {
    expect(rdo.exchanges.map(e => e.matchKeys!.member)).toEqual([
      'GetCompanyCount', ...FIELDS.map(([member]) => member),
    ]);
    // All five are functions: "^", never the void "*".
    for (const exchange of rdo.exchanges.slice(1)) {
      expect(exchange.request).toContain('"^"');
      expect(exchange.request).not.toContain('"*"');
    }
  });

  it('reads a widestring index as a type mismatch, and an integer one as correct', () => {
    const validator = new RdoStrictValidator();
    validator.addScenario(rdo);

    const wrong = `C 1 sel ${DEFAULT_VARIABLES.clientViewId} call GetCompanyName "^" "%0"`;
    // `index : integer` (InterfaceServer.pas:170) — a widestring lands in the
    // register as a pointer, and the ASP itself passes CInt(i).
    expect(validator.validate(RdoProtocol.parse(wrong), wrong).map(v => v.type))
      .toEqual([ViolationType.ARG_TYPE_PREFIX_MISMATCH]);

    const right = `C 2 sel ${DEFAULT_VARIABLES.clientViewId} call GetCompanyName "^" "#0"`;
    expect(validator.validate(RdoProtocol.parse(right), right)).toEqual([]);
  });

  it('answers each frame with the captured company\'s own value', () => {
    const mock = new RdoMock();
    mock.addScenario(rdo);

    for (const [member, answer] of FIELDS) {
      const frame = `C 9 sel ${DEFAULT_VARIABLES.clientViewId} call ${member} "^" "#0"`;
      const result = mock.match(frame);
      expect(result).not.toBeNull();
      expect(result!.exchange.matchKeys!.member).toBe(member);
      expect(result!.response).toContain(`res="${answer}"`);
    }
  });
});

describe('company-list scenario — CompanyPage.asp matching', () => {
  const { http } = createCompanyListScenario();
  const mock = new HttpMock();
  mock.addScenario(http);

  it('matches a request naming this company', () => {
    const url = '/Five/0/Visual/Voyager/NewTycoon/CompanyPage.asp'
      + `?Company=${encodeURIComponent(DEFAULT_VARIABLES.companyName)}`
      + `&WorldName=${DEFAULT_VARIABLES.worldName}&Tycoon=${DEFAULT_VARIABLES.username}`;
    const result = mock.match('GET', url);
    expect(result).not.toBeNull();
    expect(result!.exchange.id).toBe('cl-http-004');
  });

  it('does not match cl-http-004 when the Company key is absent', () => {
    const url = `/Five/0/Visual/Voyager/NewTycoon/CompanyPage.asp?WorldName=${DEFAULT_VARIABLES.worldName}`
      + `&Tycoon=${DEFAULT_VARIABLES.username}`;
    const result = mock.match('GET', url);
    expect(result).toBeNull();
  });

  it('falls through to the unavailable page for any other company', () => {
    const url = '/Five/0/Visual/Voyager/NewTycoon/CompanyPage.asp?Company=Red%20Corp.';
    const result = mock.match('GET', url);
    expect(result).not.toBeNull();
    expect(result!.exchange.id).toBe('cl-http-005');
  });
});

describe('company-list scenario — gateway round-trip', () => {
  const { http } = createCompanyListScenario();
  const mock = new HttpMock();
  mock.addScenario(http);

  let session: StarpeaceSession;

  beforeEach(() => {
    fetchMock.mockReset();
    session = new StarpeaceSession();
    session.setCurrentWorldInfo({ name: 'Shamba', url: 'http://158.69.153.134', ip: '158.69.153.134', port: 8000 });
    session.setActiveUsername('SPO_test3');
    session.setCachedPassword('test3');
    session.setCurrentCompany({ id: '55', name: 'SPO_test3 - Green', ownerRole: 'SPO_test3' });
    session.setDaAddr('158.69.153.134');
    session.setDaPort(7001);
    session.setInterfaceServerId('8161308');
    fetchMock.mockImplementation(async (url: unknown) => {
      const result = mock.match('GET', String(url));
      return result
        ? { ok: true, status: result.status, statusText: 'OK', text: async () => result.body }
        : { ok: false, status: 404, statusText: 'Not Found', text: async () => '' };
    });
  });

  it('parses the served markup into COMPANY_PAGE_TREE, asking for the named company', async () => {
    const data = await session.fetchCompanyProfitLoss('Yellow Inc.', 'PGI');
    expect(data).toEqual(COMPANY_PAGE_TREE);

    const requestedUrl = String(fetchMock.mock.calls[0][0]);
    expect(requestedUrl).toContain('NewTycoon/CompanyPage.asp');
    expect(requestedUrl).toContain('Company=Yellow%20Inc.');
    expect(requestedUrl).toContain('CompanyCluster=PGI');
    expect(requestedUrl).not.toContain('Company=SPO_test3');
  });

  it('rejects with the failure state for a company the page has no account row for', async () => {
    await expect(session.fetchCompanyProfitLoss('Red Corp.', 'PGI')).rejects.toThrow(
      /carries no account tree for "Red Corp."/
    );
  });

  it('never switches the active company across either call', async () => {
    await session.fetchCompanyProfitLoss('Yellow Inc.', 'PGI');
    await session.fetchCompanyProfitLoss('Red Corp.', 'PGI').catch(() => undefined);
    expect(session.currentCompany?.name).toBe('SPO_test3 - Green');
  });
});
