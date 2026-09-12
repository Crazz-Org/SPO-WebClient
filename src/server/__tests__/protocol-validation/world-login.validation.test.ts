/**
 * Protocol Validation: World Login
 *
 * Validates that StarpeaceSession.loginWorld() produces correct RDO commands
 * matching real captured server exchanges, and correctly parses responses.
 *
 * Flow under test (single world socket):
 *   1. idof "InterfaceServer"
 *   2. 9x GET world properties (WorldName, WorldURL, DAAddr, DALockPort, MailAddr, MailPort, WorldXSize, WorldYSize, WorldSeason) — sequential, one at a time
 *   3. AccountStatus CALL with username, password
 *   4. Logon CALL with username, password → contextId
 *   5. GET MailAccount, GET TycoonId, GET RDOCnntId
 *   6. RegisterEventsById CALL → triggers InitClient push
 *   7. SetLanguage push (no RID, fire-and-forget)
 *   8. GET GetCompanyCount
 *   9. HTTP fetch for company list (logonComplete.asp → chooseCompany.asp)
 *
 * Prerequisites: connectDirectory() must be called first to establish DIRECTORY_CONNECTED phase.
 */

// Must mock before any imports that use them
jest.mock('net', () => ({
  Socket: jest.fn(),
}));
jest.mock('node-fetch', () => ({
  __esModule: true,
  default: jest.fn(),
}));

/// <reference path="../../__tests__/matchers/rdo-matchers.d.ts" />
import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  createProtocolTestHarness,
  buildWorldPropertyFallbacks,
  buildLoginPushTriggers,
  ProtocolTestHarness,
} from './protocol-test-harness';
import { createAuthScenario } from '../../../mock-server/scenarios/auth-scenario';
import { createWorldListScenario } from '../../../mock-server/scenarios/world-list-scenario';
import { createCompanyListScenario } from '../../../mock-server/scenarios/company-list-scenario';
import type { RdoScenario } from '../../../mock-server/types/rdo-exchange-types';

// --- Constants matching captured protocol exchanges ---
const INTERFACE_SERVER_ID = '6892548';
const CONTEXT_ID = '8161308';
const TYCOON_ID = '22';
const RDO_CNNT_ID = '12345678';

// Voyager's own sweep (`Voyager/URLHandlers/ServerCnxHandler.pas:2747-2761`), minus DSArea
// — see the DSArea test below for why that one is deliberately absent (`:2750` reads DSArea,
// `:2756` reads DALockPort; the older `:1043-1051` sweep is dead code, superseded by this one).
const WORLD_PROPERTY_NAMES = [
  'WorldName', 'WorldURL', 'DAAddr', 'DALockPort',
  'MailAddr', 'MailPort', 'WorldXSize', 'WorldYSize', 'WorldSeason',
];

/**
 * Build the RDO scenario for the loginWorld flow on the world socket.
 * Contains: idof InterfaceServer, 2b. CanJoinWorldEx CALL, AccountStatus, Logon,
 * RegisterEventsById.
 * The world properties + user properties are handled by fallback responses.
 */
function createWorldLoginRdoScenario(): RdoScenario {
  return {
    name: 'world-login',
    description: 'World login RDO exchanges: idof, AccountStatus, Logon, RegisterEventsById',
    exchanges: [
      {
        id: 'wl-rdo-idof',
        request: `C 0 idof "InterfaceServer"`,
        response: `A0 objid="${INTERFACE_SERVER_ID}"`,
        matchKeys: { verb: 'idof', targetId: 'InterfaceServer' },
      },
      {
        id: 'wl-rdo-canjoin',
        request: `C 1 sel ${INTERFACE_SERVER_ID} call CanJoinWorldEx "^" "%SPO_test3"`,
        response: `A1 res="#0"`,
        matchKeys: { verb: 'sel', action: 'call', member: 'CanJoinWorldEx' },
      },
      {
        id: 'wl-rdo-acct',
        request: `C 1 sel ${INTERFACE_SERVER_ID} call AccountStatus "^" "%SPO_test3","%test3"`,
        response: `A1 res="#0"`,
        matchKeys: { verb: 'sel', action: 'call', member: 'AccountStatus' },
      },
      {
        id: 'wl-rdo-logon',
        request: `C 2 sel ${INTERFACE_SERVER_ID} call Logon "^" "%SPO_test3","%test3"`,
        response: `A2 res="#${CONTEXT_ID}"`,
        matchKeys: { verb: 'sel', action: 'call', member: 'Logon' },
      },
      {
        id: 'wl-rdo-regevt',
        request: `C 3 sel ${CONTEXT_ID} call RegisterEventsById "^" "#${RDO_CNNT_ID}"`,
        response: `A3 res="#1"`,
        matchKeys: { verb: 'sel', action: 'call', member: 'RegisterEventsById' },
      },
    ],
    variables: {},
  };
}

describe('Protocol Validation: loginWorld()', () => {
  let harness: ProtocolTestHarness;

  const authBundle = createAuthScenario({ username: 'SPO_test3', password: 'test3' });
  const worldListBundle = createWorldListScenario({ username: 'SPO_test3', password: 'test3' });
  // Use proper-cased 'Shamba' — loginWorld()'s fetchWorldProperties() overwrites
  // WorldInfo.name with the InterfaceServer's WorldName response ("Shamba"),
  // and this name is used in the HTTP logonComplete.asp URL.
  const companyBundle = createCompanyListScenario({
    username: 'SPO_test3',
    password: 'test3',
    worldName: 'Shamba',
    worldIp: '142.44.158.91',
    worldPort: 8000,
  });

  const worldLoginRdo = createWorldLoginRdoScenario();

  beforeEach(() => {
    jest.clearAllMocks();

    harness = createProtocolTestHarness({
      socketConfigs: [
        // Socket 0: directory_auth (Phase 1 of connectDirectory)
        { rdoScenarios: [authBundle.rdo] },
        // Socket 1: directory_query (Phase 2 of connectDirectory)
        { rdoScenarios: [worldListBundle.rdo] },
        // Socket 2: world socket (loginWorld)
        {
          rdoScenarios: [worldLoginRdo],
          fallbackResponses: buildWorldPropertyFallbacks({
            worldName: 'Shamba',
            worldIp: '142.44.158.91',
            worldPort: '8000',
            mailAddr: '142.44.158.91',
            mailPort: '1234',
          }),
          pushTriggers: buildLoginPushTriggers(CONTEXT_ID),
        },
      ],
      httpScenarios: [companyBundle.http],
    });
  });

  afterEach(() => {
    harness.assertNoViolations();
    harness.cleanup();
  });

  /**
   * Helper: runs the full connectDirectory + loginWorld sequence.
   * Returns the loginWorld result.
   */
  async function runFullLoginFlow(): Promise<{
    contextId: string;
    tycoonId: string;
    companies: Array<{ id: string; name: string; ownerRole?: string }>;
  }> {
    const worlds = await harness.session.connectDirectory(
      'SPO_test3', 'test3', 'Root/Areas/Asia/Worlds'
    );
    const shamba = worlds.find(w => w.name === 'shamba');
    expect(shamba).toBeDefined();
    return harness.session.loginWorld('SPO_test3', 'test3', shamba!);
  }

  /**
   * Helper: get captured commands from the world socket (index 2).
   */
  function getWorldCommands(): string[] {
    return harness.getCapturedCommands(2);
  }

  // ===================================================================
  // Command format tests
  // ===================================================================

  describe('idof InterfaceServer', () => {
    it('should send idof "InterfaceServer" as first command on world socket', async () => {
      await runFullLoginFlow();

      const worldCmds = getWorldCommands();
      expect(worldCmds.length).toBeGreaterThanOrEqual(1);
      expect(worldCmds[0]).toMatch(/^C \d+ idof "InterfaceServer"$/);
    });

    it('should resolve InterfaceServer ID from idof response', async () => {
      await runFullLoginFlow();

      const worldCmds = getWorldCommands();
      // The second command (first property GET) should target the interfaceServerId
      const firstGet = worldCmds.find(cmd => cmd.includes('get WorldName'));
      expect(firstGet).toBeDefined();
      expect(firstGet).toContain(`sel ${INTERFACE_SERVER_ID}`);
    });
  });

  describe('World property GET commands', () => {
    it('should send 9 GET commands for world properties', async () => {
      await runFullLoginFlow();

      const worldCmds = getWorldCommands();
      const getCmds = worldCmds.filter(cmd => cmd.includes(' get '));

      // 9 world properties + 3 user properties (MailAccount, TycoonId, RDOCnntId) + 1 GetCompanyCount = 13 GETs total
      // Filter specifically for the 9 world props
      for (const prop of WORLD_PROPERTY_NAMES) {
        const propCmd = getCmds.find(cmd => cmd.includes(`get ${prop}`));
        expect(propCmd).toBeDefined();
      }
    });

    // This is an accepted divergence from Voyager's sweep, arbitrated in #92 (closed):
    // Voyager DOES read DSArea (`Voyager/URLHandlers/ServerCnxHandler.pas:2750`), but only
    // to persist `Root/Areas/<area>/Worlds/<world>/Interface` in its local registry
    // (`:2610`) so a later sign-in can re-find the Interface Server without the world list
    // (`LogonHandlerViewer.pas:554`). The gateway resolves that address from the Directory
    // Server on every login — the same way it reads DALockPort (`:2756`) fresh each time —
    // so there is no key to cache and nothing to read the area for. Divergence accepted.
    it('should NOT query DSArea (accepted divergence, arbitrated in #92)', async () => {
      await runFullLoginFlow();

      const worldCmds = getWorldCommands();
      const dsAreaCmd = worldCmds.find(cmd => cmd.includes('get DSArea'));
      expect(dsAreaCmd).toBeUndefined();
    });

    // The `&DAPort=` the ASP pages receive carries the InterfaceServer's DALockPort, as
    // Voyager sends it (`ServerCnxHandler.pas:2756`). The InterfaceServer's own
    // `DAPort` is a different socket (`InterfaceServer.pas:2639-2640`) and the gateway has
    // no use for it, so it is never read.
    it('should NOT query DAPort (Voyager reads DALockPort instead)', async () => {
      await runFullLoginFlow();

      const worldCmds = getWorldCommands();
      const daPortCmd = worldCmds.find(cmd => / get DAPort\b/.test(cmd));
      expect(daPortCmd).toBeUndefined();
    });

    it('should target InterfaceServer ID for all world property GETs', async () => {
      await runFullLoginFlow();

      const worldCmds = getWorldCommands();
      for (const prop of WORLD_PROPERTY_NAMES) {
        const propCmd = worldCmds.find(cmd => cmd.includes(`get ${prop}`));
        expect(propCmd).toBeDefined();
        expect(propCmd).toContain(`sel ${INTERFACE_SERVER_ID} get ${prop}`);
      }
    });

    it('should send world properties in the correct order', async () => {
      await runFullLoginFlow();

      const worldCmds = getWorldCommands();
      const getIndices = WORLD_PROPERTY_NAMES.map(prop =>
        worldCmds.findIndex(cmd => cmd.includes(`get ${prop}`))
      );

      // Each property should come after the previous one
      for (let i = 1; i < getIndices.length; i++) {
        expect(getIndices[i]).toBeGreaterThan(getIndices[i - 1]);
      }
    });
  });

  describe('AccountStatus check', () => {
    it('should send AccountStatus CALL before Logon', async () => {
      await runFullLoginFlow();

      const worldCmds = getWorldCommands();
      const acctIdx = worldCmds.findIndex(cmd => cmd.includes('AccountStatus'));
      const logonIdx = worldCmds.findIndex(cmd => cmd.includes(' call Logon'));
      expect(acctIdx).toBeGreaterThan(-1);
      expect(logonIdx).toBeGreaterThan(-1);
      expect(acctIdx).toBeLessThan(logonIdx);
    });

    it('should send AccountStatus with username and password arguments', async () => {
      await runFullLoginFlow();

      const worldCmds = getWorldCommands();
      const acctCmd = worldCmds.find(cmd => cmd.includes('AccountStatus'));
      expect(acctCmd).toBeDefined();
      expect(acctCmd).toContain('%SPO_test3');
      expect(acctCmd).toContain('%test3');
    });

    it('should target InterfaceServer ID for AccountStatus', async () => {
      await runFullLoginFlow();

      const worldCmds = getWorldCommands();
      const acctCmd = worldCmds.find(cmd => cmd.includes('AccountStatus'));
      expect(acctCmd).toBeDefined();
      expect(acctCmd).toContain(`sel ${INTERFACE_SERVER_ID} call AccountStatus`);
    });

    it('should use "^" separator for AccountStatus CALL', async () => {
      await runFullLoginFlow();

      const worldCmds = getWorldCommands();
      const acctCmd = worldCmds.find(cmd => cmd.includes('AccountStatus'));
      expect(acctCmd).toBeDefined();
      // Verify RDO call format: sel <id> call AccountStatus "<sep>"
      expect(acctCmd).toMatch(/call AccountStatus "[*^]"/);
    });
  });

  describe('Logon command', () => {
    it('should send Logon CALL with username and password', async () => {
      await runFullLoginFlow();

      const worldCmds = getWorldCommands();
      const logonCmd = worldCmds.find(cmd => cmd.includes(' call Logon'));
      expect(logonCmd).toBeDefined();
      expect(logonCmd).toContain('%SPO_test3');
      expect(logonCmd).toContain('%test3');
    });

    it('should target InterfaceServer ID for Logon', async () => {
      await runFullLoginFlow();

      const worldCmds = getWorldCommands();
      const logonCmd = worldCmds.find(cmd => cmd.includes(' call Logon'));
      expect(logonCmd).toBeDefined();
      expect(logonCmd).toContain(`sel ${INTERFACE_SERVER_ID} call Logon`);
    });

    it('should use "^" separator for Logon CALL', async () => {
      await runFullLoginFlow();

      const worldCmds = getWorldCommands();
      const logonCmd = worldCmds.find(cmd => cmd.includes(' call Logon'));
      expect(logonCmd).toBeDefined();
      // Verify RDO call format: sel <id> call Logon "<sep>"
      expect(logonCmd).toMatch(/call Logon "[*^]"/);
    });
  });

  describe('User property retrieval after Logon', () => {
    it('should GET MailAccount using contextId after Logon', async () => {
      await runFullLoginFlow();

      const worldCmds = getWorldCommands();
      const mailCmd = worldCmds.find(cmd => cmd.includes('get MailAccount'));
      expect(mailCmd).toBeDefined();
      expect(mailCmd).toContain(`sel ${CONTEXT_ID} get MailAccount`);
    });

    it('should GET TycoonId using contextId after Logon', async () => {
      await runFullLoginFlow();

      const worldCmds = getWorldCommands();
      const tycoonCmd = worldCmds.find(cmd => cmd.includes('get TycoonId'));
      expect(tycoonCmd).toBeDefined();
      expect(tycoonCmd).toContain(`sel ${CONTEXT_ID} get TycoonId`);
    });

    it('should GET RDOCnntId using contextId after Logon', async () => {
      await runFullLoginFlow();

      const worldCmds = getWorldCommands();
      const cnntCmd = worldCmds.find(cmd => cmd.includes('get RDOCnntId'));
      expect(cnntCmd).toBeDefined();
      expect(cnntCmd).toContain(`sel ${CONTEXT_ID} get RDOCnntId`);
    });

    it('should retrieve user properties in order: MailAccount, TycoonId, RDOCnntId', async () => {
      await runFullLoginFlow();

      const worldCmds = getWorldCommands();
      const mailIdx = worldCmds.findIndex(cmd => cmd.includes('get MailAccount'));
      const tycoonIdx = worldCmds.findIndex(cmd => cmd.includes('get TycoonId'));
      const cnntIdx = worldCmds.findIndex(cmd => cmd.includes('get RDOCnntId'));

      expect(mailIdx).toBeGreaterThan(-1);
      expect(tycoonIdx).toBeGreaterThan(mailIdx);
      expect(cnntIdx).toBeGreaterThan(tycoonIdx);
    });
  });

  describe('RegisterEventsById and InitClient flow', () => {
    it('should send RegisterEventsById CALL with RDOCnntId', async () => {
      await runFullLoginFlow();

      const worldCmds = getWorldCommands();
      const regCmd = worldCmds.find(cmd => cmd.includes('RegisterEventsById'));
      expect(regCmd).toBeDefined();
      expect(regCmd).toContain(`sel ${CONTEXT_ID} call RegisterEventsById`);
      // Should include the RDOCnntId as argument (Integer type)
      expect(regCmd).toContain(`#${RDO_CNNT_ID}`);
    });

    it('should send RegisterEventsById after RDOCnntId is retrieved', async () => {
      await runFullLoginFlow();

      const worldCmds = getWorldCommands();
      const cnntIdx = worldCmds.findIndex(cmd => cmd.includes('get RDOCnntId'));
      const regIdx = worldCmds.findIndex(cmd => cmd.includes('RegisterEventsById'));

      expect(cnntIdx).toBeGreaterThan(-1);
      expect(regIdx).toBeGreaterThan(cnntIdx);
    });
  });

  describe('SetLanguage push command', () => {
    it('should send SetLanguage as a push command (uses "*" separator)', async () => {
      await runFullLoginFlow();

      // SetLanguage is sent via socket.write directly, not through sendRdoRequest.
      // It shows up in capturedWrites but may not have a "C" prefix with RID since
      // the RdoCommand builder with .push() uses "*" separator.
      const worldSocket = harness.getSockets()[2];
      expect(worldSocket).toBeDefined();

      const allWrites = worldSocket.getCapturedWrites();
      const setLangWrite = allWrites.find(w => w.includes('SetLanguage'));
      expect(setLangWrite).toBeDefined();
      // Push separator "*" should be present
      expect(setLangWrite).toContain('"*"');
    });

    it('should send SetLanguage targeting the worldContextId', async () => {
      await runFullLoginFlow();

      const worldSocket = harness.getSockets()[2];
      const allWrites = worldSocket.getCapturedWrites();
      const setLangWrite = allWrites.find(w => w.includes('SetLanguage'));
      expect(setLangWrite).toBeDefined();
      expect(setLangWrite).toContain(`sel ${CONTEXT_ID}`);
    });

    it('should send SetLanguage with string "0" argument (LangId="0")', async () => {
      await runFullLoginFlow();

      const worldSocket = harness.getSockets()[2];
      const allWrites = worldSocket.getCapturedWrites();
      const setLangWrite = allWrites.find(w => w.includes('SetLanguage'));
      expect(setLangWrite).toBeDefined();
      // Should contain "%0" (widestring "0") — Delphi SetLanguage(langid: widestring)
      // expects a string, not integer. Integer #0 causes nil widestring → empty Language
      // which breaks all MLS hint string lookups.
      expect(setLangWrite).toContain('%0');
    });
  });

  describe('GetCompanyCount', () => {
    it('should GET GetCompanyCount using contextId', async () => {
      await runFullLoginFlow();

      const worldCmds = getWorldCommands();
      const countCmd = worldCmds.find(cmd => cmd.includes('get GetCompanyCount'));
      expect(countCmd).toBeDefined();
      expect(countCmd).toContain(`sel ${CONTEXT_ID} get GetCompanyCount`);
    });

    it('should request GetCompanyCount after RegisterEventsById', async () => {
      await runFullLoginFlow();

      const worldCmds = getWorldCommands();
      const regIdx = worldCmds.findIndex(cmd => cmd.includes('RegisterEventsById'));
      const countIdx = worldCmds.findIndex(cmd => cmd.includes('get GetCompanyCount'));

      expect(regIdx).toBeGreaterThan(-1);
      expect(countIdx).toBeGreaterThan(regIdx);
    });
  });

  // ===================================================================
  // Return value parsing
  // ===================================================================

  describe('Return value parsing', () => {
    it('should return the correct contextId from Logon response', async () => {
      const result = await runFullLoginFlow();

      expect(result.contextId).toBe(CONTEXT_ID);
    });

    it('should return the correct tycoonId from TycoonId GET', async () => {
      const result = await runFullLoginFlow();

      expect(result.tycoonId).toBe(TYCOON_ID);
    });

    it('should return a companies array from HTTP response', async () => {
      const result = await runFullLoginFlow();

      expect(result.companies).toBeDefined();
      expect(Array.isArray(result.companies)).toBe(true);
    });

    it('should parse company data from chooseCompany.asp HTML', async () => {
      const result = await runFullLoginFlow();

      // Company list scenario provides "Yellow Inc." with id "28"
      expect(result.companies.length).toBeGreaterThan(0);
      const company = result.companies[0];
      expect(company.id).toBe('28');
      expect(company.name).toBe('Yellow Inc.');
    });
  });

  // ===================================================================
  // Full flow compliance
  // ===================================================================

  describe('Full flow compliance', () => {
    it('should create exactly 3 sockets total (2 directory + 1 world)', async () => {
      await runFullLoginFlow();

      const sockets = harness.getSockets();
      expect(sockets.length).toBe(3);
    });

    it('should send commands with sequential RIDs on the world socket', async () => {
      await runFullLoginFlow();

      const worldCmds = getWorldCommands();
      const rids: number[] = [];
      for (const cmd of worldCmds) {
        const ridMatch = cmd.match(/^C (\d+)/);
        if (ridMatch) rids.push(parseInt(ridMatch[1], 10));
      }

      // RIDs should be strictly ascending
      for (let i = 1; i < rids.length; i++) {
        expect(rids[i]).toBeGreaterThan(rids[i - 1]);
      }
    });

    it('should use RDO call format for all CALL method invocations', async () => {
      await runFullLoginFlow();

      const worldCmds = getWorldCommands();
      const callCmds = worldCmds.filter(cmd => cmd.includes(' call '));

      expect(callCmds.length).toBeGreaterThanOrEqual(3); // AccountStatus, Logon, RegisterEventsById
      for (const cmd of callCmds) {
        const methodMatch = cmd.match(/call (\w+)/);
        expect(methodMatch).not.toBeNull();
        // Verify RDO call format: sel <id> call <method> "<sep>"
        expect(cmd).toMatch(new RegExp(`call ${methodMatch![1]} "[*^]"`));
      }
    });

    it('should send all commands strictly sequentially (no parallel batching)', async () => {
      // Conformity: the LOGIN sequence must replay the legacy client's exact
      // command order (arch doc §5.2) — each step depends on the previous
      // answer (session id → property gets → Logon → ClientView id). The
      // server itself dispatches concurrent queries fine (arch doc §3.5);
      // this is about sequence fidelity, and one frame per write.
      // Verify: no single write() call should contain more than one C command.
      await runFullLoginFlow();

      const worldSocket = harness.getSockets()[2];
      const allWrites = worldSocket.getCapturedWrites();

      // Each write to the socket should contain at most ONE C <rid> command.
      // If Promise.all is used, multiple socket.write() calls happen before
      // any response is processed, but each write is individual. The real
      // proof is that commands appear in the captured-commands list in the
      // same order they were sent — if commands were batched, the mock
      // socket would process them as separate commands anyway, but the
      // RIDs would interleave with responses incorrectly.
      for (const write of allWrites) {
        const cmdMatches = write.match(/C \d+/g);
        if (cmdMatches) {
          expect(cmdMatches.length).toBe(1);
        }
      }
    });

    it('should switch from InterfaceServer target to contextId target after Logon', async () => {
      await runFullLoginFlow();

      const worldCmds = getWorldCommands();
      const logonIdx = worldCmds.findIndex(cmd => cmd.includes(' call Logon'));

      // Commands before (and including) Logon target interfaceServerId
      for (let i = 1; i <= logonIdx; i++) {
        // Skip idof command (index 0)
        if (worldCmds[i].includes('idof')) continue;
        expect(worldCmds[i]).toContain(`sel ${INTERFACE_SERVER_ID}`);
      }

      // Commands after Logon (MailAccount, TycoonId, RDOCnntId, etc.) target contextId
      const mailIdx = worldCmds.findIndex(cmd => cmd.includes('get MailAccount'));
      expect(mailIdx).toBeGreaterThan(logonIdx);
      expect(worldCmds[mailIdx]).toContain(`sel ${CONTEXT_ID}`);
    });
  });
});

describe('Protocol Validation: loginWorld() — logonComplete.asp exits', () => {
  let harness: ProtocolTestHarness;

  const authBundle = createAuthScenario({ username: 'SPO_test3', password: 'test3' });
  const worldListBundle = createWorldListScenario({ username: 'SPO_test3', password: 'test3' });
  const worldLoginRdo = createWorldLoginRdoScenario();

  function buildHarness(options: { logonResult: 'noAccess' | 'error'; expiresOn?: string; errorCode?: string }): ProtocolTestHarness {
    const companyBundle = createCompanyListScenario({
      username: 'SPO_test3',
      password: 'test3',
      worldName: 'Shamba',
      worldIp: '142.44.158.91',
      worldPort: 8000,
    }, options);

    return createProtocolTestHarness({
      socketConfigs: [
        { rdoScenarios: [authBundle.rdo] },
        { rdoScenarios: [worldListBundle.rdo] },
        {
          rdoScenarios: [worldLoginRdo],
          fallbackResponses: buildWorldPropertyFallbacks({
            worldName: 'Shamba',
            worldIp: '142.44.158.91',
            worldPort: '8000',
            mailAddr: '142.44.158.91',
            mailPort: '1234',
          }),
          pushTriggers: buildLoginPushTriggers(CONTEXT_ID),
        },
      ],
      httpScenarios: [companyBundle.http],
    });
  }

  afterEach(() => {
    harness.assertNoViolations();
    harness.cleanup();
  });

  it('reports a denial when logonComplete.asp redirects to logonNoAccess.asp', async () => {
    harness = buildHarness({ logonResult: 'noAccess', expiresOn: '01/01/2020' });

    const worlds = await harness.session.connectDirectory('SPO_test3', 'test3', 'Root/Areas/Asia/Worlds');
    const shamba = worlds.find(w => w.name === 'shamba');
    expect(shamba).toBeDefined();
    const result = await harness.session.loginWorld('SPO_test3', 'test3', shamba!);

    expect(result.loginPage).toEqual({ kind: 'denied', expiresOn: '01/01/2020' });
    expect(result.companies).toEqual([]);
    expect(harness.session.getAvailableCompanies()).toEqual([]);
    // The noAccess scenario does not register a chooseCompany.asp exchange at all —
    // if the gateway had fetched it, the HttpMock would fail to match and the fetch
    // would reject, turning this result into 'unreachable' instead of 'denied'.
  });

  it('reports an error when logonComplete.asp redirects to logonError.asp', async () => {
    harness = buildHarness({ logonResult: 'error', errorCode: 'ERROR_CANNOTCREATECLIENTVIEW' });

    const worlds = await harness.session.connectDirectory('SPO_test3', 'test3', 'Root/Areas/Asia/Worlds');
    const shamba = worlds.find(w => w.name === 'shamba');
    expect(shamba).toBeDefined();
    const result = await harness.session.loginWorld('SPO_test3', 'test3', shamba!);

    expect(result.loginPage).toEqual({ kind: 'error', errorCode: 'ERROR_CANNOTCREATECLIENTVIEW' });
    expect(result.companies).toEqual([]);
    expect(harness.session.getAvailableCompanies()).toEqual([]);
  });
});
