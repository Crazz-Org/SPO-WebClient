/**
 * Protocol Validation: Profile Tabs
 *
 * The profile tabs emit NO RDO at all. Bank account, profit & loss,
 * companies, auto-connections and policy are the ASP pages the reference
 * client showed (`NewTycoon/TycoonBankAccount.asp`,
 * `NewTycoon/TycoonProfitAndLoses.asp`, `NewLogon/chooseCompany.asp`,
 * `NewTycoon/TycoonAutoConnections.asp`, `NewTycoon/TycoonPolicy.asp`), and the
 * gateway fetches them over HTTP.
 *
 * These tests drive the production fetchers on a real StarpeaceSession through
 * the protocol harness, pin the URL each one fetches as a literal, and assert
 * that no socket was opened and no RDO frame was written. Parsing of these
 * pages is covered by `profile-finance-handler.test.ts` and
 * `auto-connection-handler.test.ts`.
 */

jest.mock('net', () => ({
  Socket: jest.fn(),
}));
jest.mock('node-fetch', () => ({
  __esModule: true,
  default: jest.fn(),
}));

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { createProtocolTestHarness, ProtocolTestHarness } from './protocol-test-harness';
import type { HttpScenario } from '../../../mock-server/types/http-exchange-types';

/** The mocked node-fetch default export — the harness routes it to the HTTP scenario. */
function fetchMock(): jest.Mock {
  return (jest.requireMock('node-fetch') as { default: jest.Mock }).default;
}

const PAGES = [
  'NewTycoon/TycoonBankAccount.asp',
  'NewTycoon/TycoonProfitAndLoses.asp',
  'NewLogon/chooseCompany.asp',
  'NewTycoon/TycoonAutoConnections.asp',
  'NewTycoon/TycoonPolicy.asp',
];

const profilePages: HttpScenario = {
  name: 'profile-pages',
  exchanges: PAGES.map((page, i) => ({
    id: `profile-http-${i + 1}`,
    method: 'GET',
    urlPattern: `/Five/0/Visual/Voyager/${page}`,
    status: 200,
    contentType: 'text/html',
    body: '<html></html>',
  })),
  variables: {},
};

describe('Protocol Validation: Profile Tabs', () => {
  describe('the tabs are HTTP only', () => {
    let harness: ProtocolTestHarness;

    beforeEach(() => {
      fetchMock().mockClear();
      harness = createProtocolTestHarness({
        socketConfigs: [],
        httpScenarios: [profilePages],
      });
      harness.session.setCurrentWorldInfo({ name: 'Shamba', url: 'http://158.69.153.134/Five/', ip: '158.69.153.134', port: 8000 });
      harness.session.setCachedUsername('SPO_test3');
      harness.session.setCachedPassword('test3');
      harness.session.setDaAddr('158.69.153.134');
      harness.session.setDaPort(7001);
      harness.session.setCurrentCompany({ id: '28', name: 'Yellow Inc.', ownerRole: 'SPO_test3' });
    });

    afterEach(() => {
      harness.session.destroy();
      harness.cleanup();
    });

    function fetchedUrls(): string[] {
      return fetchMock().mock.calls.map(call => String(call[0]));
    }

    function expectNoRdo(): void {
      expect(harness.getSockets()).toHaveLength(0);
      expect(harness.getAllCapturedCommands()).toEqual([]);
      harness.assertNoViolations();
    }

    it('fetchBankAccount reads TycoonBankAccount.asp', async () => {
      await harness.session.fetchBankAccount();
      expect(fetchedUrls()).toEqual([
        'http://158.69.153.134/Five/0/Visual/Voyager/NewTycoon/TycoonBankAccount.asp?Tycoon=SPO_test3&Password=test3&Company=Yellow%20Inc.&WorldName=Shamba&DAAddr=158.69.153.134&DAPort=7001&ISAddr=158.69.153.134&ISPort=8000&ClientViewId=0&RIWS=&LangId=0',
      ]);
      expectNoRdo();
    });

    it('fetchProfitLoss reads TycoonProfitAndLoses.asp', async () => {
      await harness.session.fetchProfitLoss();
      expect(fetchedUrls()).toEqual([
        'http://158.69.153.134/Five/0/Visual/Voyager/NewTycoon/TycoonProfitAndLoses.asp?Tycoon=SPO_test3&Password=test3&Company=Yellow%20Inc.&WorldName=Shamba&DAAddr=158.69.153.134&DAPort=7001&ISAddr=158.69.153.134&ISPort=8000&ClientViewId=0&RIWS=&LangId=0',
      ]);
      expectNoRdo();
    });

    it('fetchCompanies reads chooseCompany.asp', async () => {
      await harness.session.fetchCompanies();
      expect(fetchedUrls()).toEqual([
        'http://158.69.153.134/Five/0/Visual/Voyager/NewLogon/chooseCompany.asp?Tycoon=SPO_test3&Password=test3&Company=Yellow%20Inc.&WorldName=Shamba&DAAddr=158.69.153.134&DAPort=7001&ISAddr=158.69.153.134&ISPort=8000&ClientViewId=0&Logon=FALSE&UserName=SPO_test3&RIWS=&LangId=0',
      ]);
      expectNoRdo();
    });

    it('fetchAutoConnections reads TycoonAutoConnections.asp', async () => {
      await harness.session.fetchAutoConnections();
      expect(fetchedUrls()).toEqual([
        'http://158.69.153.134/Five/0/Visual/Voyager/NewTycoon/TycoonAutoConnections.asp?Tycoon=SPO_test3&Password=test3&Company=Yellow%20Inc.&WorldName=Shamba&DAAddr=158.69.153.134&DAPort=7001&ISAddr=158.69.153.134&ISPort=8000&ClientViewId=0&RIWS=&LangId=0',
      ]);
      expectNoRdo();
    });

    it('fetchPolicy reads TycoonPolicy.asp', async () => {
      await harness.session.fetchPolicy();
      expect(fetchedUrls()).toEqual([
        'http://158.69.153.134/Five/0/Visual/Voyager/NewTycoon/TycoonPolicy.asp?Tycoon=SPO_test3&Password=test3&Company=Yellow%20Inc.&WorldName=Shamba&DAAddr=158.69.153.134&DAPort=7001&ISAddr=158.69.153.134&ISPort=8000&ClientViewId=0&RIWS=&LangId=0',
      ]);
      expectNoRdo();
    });
  });

  describe('Profile message type completeness', () => {
    it('should have matching REQ/RESP pairs for all profile tabs', () => {
      const { WsMessageType } = require('../../../shared/types');

      const profileTabs = ['CURRICULUM', 'BANK', 'PROFITLOSS', 'COMPANIES', 'AUTOCONNECTIONS', 'POLICY'];

      for (const tab of profileTabs) {
        expect(WsMessageType[`REQ_PROFILE_${tab}`]).toBeDefined();
        expect(WsMessageType[`RESP_PROFILE_${tab}`]).toBeDefined();
      }
    });

    it('should have action message types for bank and auto-connections', () => {
      const { WsMessageType } = require('../../../shared/types');

      expect(WsMessageType.REQ_PROFILE_BANK_ACTION).toBeDefined();
      expect(WsMessageType.RESP_PROFILE_BANK_ACTION).toBeDefined();
      expect(WsMessageType.REQ_PROFILE_AUTOCONNECTION_ACTION).toBeDefined();
      expect(WsMessageType.RESP_PROFILE_AUTOCONNECTION_ACTION).toBeDefined();
    });

    it('should have policy set message types', () => {
      const { WsMessageType } = require('../../../shared/types');

      expect(WsMessageType.REQ_PROFILE_POLICY_SET).toBeDefined();
      expect(WsMessageType.RESP_PROFILE_POLICY_SET).toBeDefined();
    });

    it('should have string values for all profile message types', () => {
      const { WsMessageType } = require('../../../shared/types');

      const profileTypes = [
        'REQ_PROFILE_CURRICULUM', 'RESP_PROFILE_CURRICULUM',
        'REQ_PROFILE_BANK', 'RESP_PROFILE_BANK',
        'REQ_PROFILE_BANK_ACTION', 'RESP_PROFILE_BANK_ACTION',
        'REQ_PROFILE_PROFITLOSS', 'RESP_PROFILE_PROFITLOSS',
        'REQ_PROFILE_COMPANIES', 'RESP_PROFILE_COMPANIES',
        'REQ_PROFILE_COMPANY_PROFITLOSS', 'RESP_PROFILE_COMPANY_PROFITLOSS',
        'REQ_PROFILE_AUTOCONNECTIONS', 'RESP_PROFILE_AUTOCONNECTIONS',
        'REQ_PROFILE_AUTOCONNECTION_ACTION', 'RESP_PROFILE_AUTOCONNECTION_ACTION',
        'REQ_PROFILE_POLICY', 'RESP_PROFILE_POLICY',
        'REQ_PROFILE_POLICY_SET', 'RESP_PROFILE_POLICY_SET',
      ];

      for (const type of profileTypes) {
        expect(typeof WsMessageType[type]).toBe('string');
        expect(WsMessageType[type]).toBeTruthy();
      }
    });
  });
});
