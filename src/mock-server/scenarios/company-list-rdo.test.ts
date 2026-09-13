/// <reference path="../../server/__tests__/matchers/rdo-matchers.d.ts" />

/**
 * `company-list` — the RDO half, driven through the real gateway.
 *
 * The company list is read off the bound `TClientView` with the five
 * one-argument published FUNCTIONS the reference client used
 * (`chooseCompany.asp:166-170`, `Interface Server/InterfaceServer.pas:169-173`),
 * so every frame carries `"^"`, a QueryId and the row index as a single
 * `#`-prefixed integer. What the old HTML scrape threw away — the cluster, the
 * `Private` marker and the facility count — is what the parsed `CompanyInfo`
 * must now carry, and `CAPTURED_COMPANY` is the oracle for all three.
 *
 * It also writes the two files the rewrite's equivalence check compares: the
 * three fields the HTTP scrape produced, from each of the two readers. Identical
 * files prove the rewrite lost nothing.
 */

jest.mock('node-fetch', () => ({ __esModule: true, default: jest.fn() }));

import * as fs from 'fs';
import fetch from 'node-fetch';
import { RdoProtocol } from '@/server/rdo';
import { RdoValue } from '@/shared/rdo-types';
import { RDO_MEMBERS } from '@/shared/rdo-members';
import type { CompanyInfo, RdoPacket } from '@/shared/types';
import { fetchCompaniesViaRdo, fetchCompaniesViaHttp } from '@/server/session/login-handler';
import { makeLoginCtx } from '@/server/__tests__/session/fake-session-context';
import { RdoMock } from '../rdo-mock';
import { HttpMock } from '../http-mock';
import { DEFAULT_VARIABLES } from './scenario-variables';
import {
  createCompanyListScenario,
  CAPTURED_COMPANY,
  COMPANY_ROW_INDEX,
} from './company-list-scenario';

const fetchMock = fetch as unknown as jest.Mock;

const { rdo, http } = createCompanyListScenario();

const CLIENT_VIEW_ID = DEFAULT_VARIABLES.clientViewId;
const WORLD_IP = DEFAULT_VARIABLES.worldIp;

/** The five members, in the order chooseCompany.asp:166-170 reads them. */
const MEMBERS = [
  'GetCompanyOwnerRole', 'GetCompanyName', 'GetCompanyId',
  'GetCompanyCluster', 'GetCompanyFacilityCount',
] as const;

const HTTP_FILE = '/tmp/spo534-http-companies.txt';
const RDO_FILE = '/tmp/spo534-rdo-companies.txt';

/** The complete output of the old HTTP scrape, one line per company, sorted. */
function asScrapeLines(companies: CompanyInfo[]): string {
  return companies
    .map(c => `${c.id}|${c.name}|${c.ownerRole ?? ''}`)
    .sort()
    .join('\n') + '\n';
}

/** Drive the real reader against an `RdoMock` loaded with the scenario. */
async function readOverRdo(count = 1, username = CAPTURED_COMPANY.ownerRole) {
  const fake = makeLoginCtx({ currentWorldInfo: { name: 'Shamba', url: '', ip: WORLD_IP, port: 8000 } });
  const mock = new RdoMock();
  mock.addScenario(rdo);

  fake.respond((packet) => {
    const frame = `${RdoProtocol.format(packet as RdoPacket)};`;
    const match = mock.match(frame);
    return match ? (RdoProtocol.parse(match.response).payload ?? '') : '';
  });

  const companies = await fetchCompaniesViaRdo(fake.ctx, CLIENT_VIEW_ID, count, username);
  return { fake, mock, companies };
}

describe('company-list scenario — the catalogue and the wire', () => {
  it('passes strict RDO validation', () => {
    expect(rdo).toPassStrictRdoValidation();
  });

  it('catalogues all five getters as 1-argument functions', () => {
    for (const member of MEMBERS) {
      expect(RDO_MEMBERS[member]).toEqual({ kind: 'function', arity: 1 });
    }
  });

  it('every frame carries the "^" read form, never the void "*"', () => {
    for (const ex of rdo.exchanges) {
      expect(ex.request).toContain('"^"');
      expect(ex.request).not.toContain('"*"');
    }
  });

  it('matches each frame back to its own exchange', () => {
    const mock = new RdoMock();
    mock.addScenario(rdo);
    for (const ex of rdo.exchanges) {
      expect(mock.match(ex.request)!.exchange.id).toBe(ex.id);
    }
  });
});

describe('company-list scenario — the drive', () => {
  it('emits the five CALL frames in the page order, indexed and against the ClientView', async () => {
    const { fake, mock } = await readOverRdo();

    expect(fake.sent).toHaveLength(5);
    expect(fake.sent.map(s => s.packet.member)).toEqual([...MEMBERS]);
    for (const sent of fake.sent) {
      expect(sent.socketName).toBe('world');
      expect(sent.packet.targetId).toBe(CLIENT_VIEW_ID);
      // One argument, the row index, `#`-prefixed: a widestring index would
      // reach the register file as a pointer and answer about nobody.
      expect(sent.packet.args).toEqual([RdoValue.int(COMPANY_ROW_INDEX).format()]);
    }
    const frames = fake.sent.map(s => RdoProtocol.format(s.packet as RdoPacket));
    for (const [i, member] of MEMBERS.entries()) {
      expect(frames[i]).toContain(`sel ${CLIENT_VIEW_ID} call ${member} "^" "#0"`);
    }
    expect(mock.getConsumedIds().size).toBe(5);
  });

  it('parses a CompanyInfo that reproduces the captured company', async () => {
    const { companies } = await readOverRdo();

    expect(companies).toEqual([{
      id: CAPTURED_COMPANY.id,
      name: CAPTURED_COMPANY.name,
      ownerRole: CAPTURED_COMPANY.ownerRole,
      cluster: CAPTURED_COMPANY.cluster,
      facilityCount: CAPTURED_COMPANY.facilityCount,
      // The owner role IS the account, so chooseCompany.asp:196 prints `Private`.
      status: CAPTURED_COMPANY.status,
      sealUrl: 'proxy:/Five/0/Visual/Voyager/NewLogon/images/comp-pgi.gif',
    }]);
  });

  it('shows the role instead of Private to anybody else', async () => {
    const { companies } = await readOverRdo(1, 'SomeoneElse');

    expect(companies[0].status).toBe(CAPTURED_COMPANY.ownerRole);
    expect(companies[0].status).not.toBe('Private');
  });

  it.each([[0], [-1], [NaN]])('refuses to read %p rows and emits no frame at all', async (count) => {
    const { fake, companies } = await readOverRdo(count);

    expect(companies).toEqual([]);
    // In particular, never `RdoValue.int(NaN)`.
    expect(fake.sent).toEqual([]);
  });

});

describe('company-list — the HTTP scrape and the RDO read agree', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    const mock = new HttpMock();
    mock.addScenario(http);
    fetchMock.mockImplementation(async (url: unknown) => {
      let current = String(url);
      for (let i = 0; i < 5; i++) {
        const result = mock.match('GET', current);
        if (!result) return { ok: false, status: 404, url: current, text: async () => '' };
        if (result.status === 302 && result.headers?.Location) {
          const base = current.substring(0, current.lastIndexOf('/') + 1);
          current = result.headers.Location.startsWith('http')
            ? result.headers.Location
            : base + result.headers.Location;
          continue;
        }
        return { ok: true, status: result.status, url: current, text: async () => result.body };
      }
      throw new Error('too many redirects');
    });
  });

  it('produces the same id|name|ownerRole lines from either reader', async () => {
    const fake = makeLoginCtx({
      currentWorldInfo: { name: DEFAULT_VARIABLES.worldName, url: '', ip: WORLD_IP, port: 8000 },
    });
    const scraped = await fetchCompaniesViaHttp(fake.ctx, WORLD_IP, CAPTURED_COMPANY.ownerRole);
    expect(scraped.kind).toBe('companies');
    const httpCompanies = scraped.kind === 'companies' ? scraped.companies : [];
    expect(httpCompanies).toHaveLength(1);

    const { companies } = await readOverRdo();

    fs.writeFileSync(HTTP_FILE, asScrapeLines(httpCompanies));
    fs.writeFileSync(RDO_FILE, asScrapeLines(companies));

    // The three fields above are the complete output of the old scrape, so
    // identical files say the rewrite lost nothing.
    expect(asScrapeLines(companies)).toEqual(asScrapeLines(httpCompanies));
  });
});
