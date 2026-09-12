import { login, handleCreateCompany, performAuthCheck, performDirectoryLogin, resumeSession, profileSwitchCompany, applyLocalCompanySwitch, abandonRole } from './auth-handler';
import { ClientBridge } from '../bridge/client-bridge';
import { WsMessageType } from '../../shared/types';
import type { ClientHandlerContext } from './client-context';
import type { RememberedSession } from '../store/remembered-session';

jest.mock('../bridge/client-bridge', () => ({
  ClientBridge: {
    log: jest.fn(),
    showCompanies: jest.fn(),
    showLoginPage: jest.fn(),
    showWorlds: jest.fn(),
    showError: jest.fn(),
    showSuccess: jest.fn(),
    setLoginLoading: jest.fn(),
    setConnected: jest.fn(),
    setWorld: jest.fn(),
    setCompany: jest.fn(),
    setCredentials: jest.fn(),
    setPublicOfficeRole: jest.fn(),
    setMapLoadingProgress: jest.fn(),
    setAuthError: jest.fn(),
  },
}));

/** The language the store holds for the current test — `login()` reads it on every send. */
const mockStoreSettings = { languageId: '0' };

/**
 * Shared so a test can assert against the same spies `getState()` hands back every time.
 * `gameStoreState` is the same object under its older name — the resume tests read it.
 */
const mockGameStoreMethods = {
  setLoginStage: jest.fn(),
  setSwitchingCompany: jest.fn(),
  enterServerSwitch: jest.fn(),
  setLoginCompanies: jest.fn(),
  setLoginLoading: jest.fn(),
  rememberSession: jest.fn(),
  forgetRememberedSession: jest.fn(),
  setResumeTarget: jest.fn(),
  serverSwitchMode: false,
  completeServerSwitch: jest.fn(),
};

const gameStoreState = mockGameStoreMethods;

jest.mock('../store/game-store', () => ({
  useGameStore: { getState: () => ({ ...mockGameStoreMethods, settings: mockStoreSettings }) },
}));

const mockProfileStoreMethods = {
  reset: jest.fn(),
  incrementRefresh: jest.fn(),
};

jest.mock('../store/profile-store', () => ({
  useProfileStore: { getState: () => mockProfileStoreMethods },
}));

jest.mock('../store/building-store', () => ({
  useBuildingStore: { getState: () => ({ clearFocus: jest.fn() }) },
}));

jest.mock('../store/ui-store', () => ({
  useUiStore: { getState: () => ({ clearBuildMenuData: jest.fn() }) },
}));

function makeCtx(overrides: Partial<ClientHandlerContext> = {}): ClientHandlerContext {
  return {
    storedUsername: 'testUser',
    storedPassword: 'testPass',
    currentWorldName: '',
    currentZonePath: '',
    availableCompanies: [],
    worldXSize: null,
    worldYSize: null,
    worldSeason: null,
    sendRequest: jest.fn(),
    showNotification: jest.fn(),
    soundManager: { play: jest.fn() } as unknown as ClientHandlerContext['soundManager'],
    getMapNavigationUI: () => null,
    getRenderer: () => null,
    isSelectingCompany: false,
    ...overrides,
  } as unknown as ClientHandlerContext;
}

describe('auth-handler', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStoreSettings.languageId = '0';
  });

  describe('login()', () => {
    it('sends the language the store holds, so the gateway can carry it', async () => {
      mockStoreSettings.languageId = '4';
      const sendRequest = jest.fn().mockResolvedValue({
        type: WsMessageType.RESP_LOGIN_SUCCESS, tycoonId: '42', companies: [],
      });

      await login(makeCtx({ sendRequest }), 'Shamba');

      expect(sendRequest).toHaveBeenCalledWith(expect.objectContaining({ languageId: '4' }));
    });

    it('sends the default when the store holds a language the catalogue does not name', async () => {
      mockStoreSettings.languageId = '9';
      const sendRequest = jest.fn().mockResolvedValue({
        type: WsMessageType.RESP_LOGIN_SUCCESS, tycoonId: '42', companies: [],
      });

      await login(makeCtx({ sendRequest }), 'Shamba');

      expect(sendRequest).toHaveBeenCalledWith(expect.objectContaining({ languageId: '0' }));
    });

    it('shows companies when server returns a non-empty list', async () => {
      const companies = [{ id: '1', name: 'TestCorp', ownerRole: 'testUser' }];
      const ctx = makeCtx({
        sendRequest: jest.fn().mockResolvedValue({
          type: WsMessageType.RESP_LOGIN_SUCCESS,
          tycoonId: '42',
          companies,
        }),
      });

      await login(ctx, 'Shamba');

      expect(ctx.availableCompanies).toEqual(companies);
      expect(ClientBridge.showCompanies).toHaveBeenCalledWith(companies, undefined);
      expect(ctx.showNotification).not.toHaveBeenCalled();
    });

    it('shows company creation stage when server returns empty companies', async () => {
      const ctx = makeCtx({
        sendRequest: jest.fn().mockResolvedValue({
          type: WsMessageType.RESP_LOGIN_SUCCESS,
          tycoonId: '42',
          companies: [],
        }),
      });

      await login(ctx, 'Shamba');

      expect(ctx.availableCompanies).toEqual([]);
      expect(ClientBridge.showCompanies).toHaveBeenCalledWith([], undefined);
      expect(ClientBridge.log).toHaveBeenCalledWith('Login', 'No companies found — showing company creation');
      expect(ctx.showNotification).not.toHaveBeenCalled();
    });

    it('falls back to empty array when companies is null/undefined', async () => {
      const ctx = makeCtx({
        sendRequest: jest.fn().mockResolvedValue({
          type: WsMessageType.RESP_LOGIN_SUCCESS,
          tycoonId: '42',
          companies: undefined,
        }),
      });

      await login(ctx, 'Shamba');

      expect(ctx.availableCompanies).toEqual([]);
      expect(ClientBridge.showCompanies).toHaveBeenCalledWith([], undefined);
    });

    it('stores world dimensions from response', async () => {
      const ctx = makeCtx({
        sendRequest: jest.fn().mockResolvedValue({
          type: WsMessageType.RESP_LOGIN_SUCCESS,
          tycoonId: '42',
          companies: [],
          worldXSize: 500,
          worldYSize: 600,
          worldSeason: 2,
        }),
      });

      await login(ctx, 'Shamba');

      expect(ctx.worldXSize).toBe(500);
      expect(ctx.worldYSize).toBe(600);
      expect(ctx.worldSeason).toBe(2);
    });

    it('shows the denial page and never shows companies when loginPage is a denial', async () => {
      const ctx = makeCtx({
        sendRequest: jest.fn().mockResolvedValue({
          type: WsMessageType.RESP_LOGIN_SUCCESS,
          tycoonId: '42',
          companies: [],
          loginPage: { kind: 'denied', expiresOn: '01/01/2020' },
        }),
      });

      await login(ctx, 'Shamba');

      expect(ClientBridge.showLoginPage).toHaveBeenCalledWith({ kind: 'denied', expiresOn: '01/01/2020' });
      expect(ClientBridge.showCompanies).not.toHaveBeenCalled();
      expect(ctx.availableCompanies).toEqual([]);
    });

    it('shows companies as before when loginPage is absent', async () => {
      const companies = [{ id: '1', name: 'TestCorp', ownerRole: 'testUser' }];
      const ctx = makeCtx({
        sendRequest: jest.fn().mockResolvedValue({
          type: WsMessageType.RESP_LOGIN_SUCCESS,
          tycoonId: '42',
          companies,
        }),
      });

      await login(ctx, 'Shamba');

      expect(ClientBridge.showCompanies).toHaveBeenCalledWith(companies, undefined);
      expect(ClientBridge.showLoginPage).not.toHaveBeenCalled();
    });

    // #538 — CanJoinWorldEx told the gateway the world would refuse a new company.
    it('forwards the admission answer to the company stage and names it in the log', async () => {
      const ctx = makeCtx({
        sendRequest: jest.fn().mockResolvedValue({
          type: WsMessageType.RESP_LOGIN_SUCCESS,
          tycoonId: '42',
          companies: [],
          admission: { kind: 'full' },
        }),
      });

      await login(ctx, 'Shamba');

      expect(ClientBridge.showCompanies).toHaveBeenCalledWith([], { kind: 'full' });
      expect(ClientBridge.log).toHaveBeenCalledWith('Login', 'World full — company creation is closed');
    });

    it('names the nobility shortfall in the log', async () => {
      const ctx = makeCtx({
        sendRequest: jest.fn().mockResolvedValue({
          type: WsMessageType.RESP_LOGIN_SUCCESS,
          tycoonId: '42',
          companies: [],
          admission: { kind: 'nobility', shortfall: 3 },
        }),
      });

      await login(ctx, 'Shamba');

      expect(ClientBridge.showCompanies).toHaveBeenCalledWith([], { kind: 'nobility', shortfall: 3 });
      expect(ClientBridge.log).toHaveBeenCalledWith('Login', 'Nobility 3 below the world minimum');
    });

    it('shows error notification on request failure', async () => {
      const ctx = makeCtx({
        sendRequest: jest.fn().mockRejectedValue(new Error('Connection lost')),
      });

      await login(ctx, 'Shamba');

      expect(ctx.showNotification).toHaveBeenCalledWith(
        'World login failed: Connection lost',
        'error',
      );
      expect(ClientBridge.setLoginLoading).toHaveBeenCalledWith(false);
    });

    it('shows the gateway sentence when the world refused the credentials', async () => {
      // AccountStatus refusals are worded by the gateway; the code's own generic
      // sentence would hide which credential was wrong.
      const err = Object.assign(new Error('Invalid password'), {
        code: 13,
        serverMessage: 'You supplied an invalid password.',
      });
      const ctx = makeCtx({ sendRequest: jest.fn().mockRejectedValue(err) });

      await login(ctx, 'Shamba');

      expect(ctx.showNotification).toHaveBeenCalledWith(
        'World login failed: You supplied an invalid password.',
        'error',
      );
    });

    it('aborts if credentials are missing', async () => {
      const ctx = makeCtx({ storedUsername: '', storedPassword: '' });

      await login(ctx, 'Shamba');

      expect(ClientBridge.showError).toHaveBeenCalledWith('Session lost, please reconnect');
      expect(ClientBridge.showCompanies).not.toHaveBeenCalled();
    });
  });

  // #532 — the refusal the modal shows is the gateway's sentence, not the one
  // the client's general ERROR_* table would build from the same number.
  describe('performAuthCheck()', () => {
    it('shows the gateway sentence carried on the rejection', async () => {
      const err = Object.assign(new Error('Unknown tycoon'), {
        code: 7,
        serverMessage: 'There are two possible causes for this error',
      });
      const ctx = makeCtx({ sendRequest: jest.fn().mockRejectedValue(err) });

      await performAuthCheck(ctx, 'testUser', 'badPass');

      expect(ClientBridge.setAuthError).toHaveBeenCalledWith({
        code: 7,
        message: 'There are two possible causes for this error',
      });
      expect(ClientBridge.setLoginLoading).toHaveBeenLastCalledWith(false);
    });

    it('falls back to the error message when the rejection carries no server sentence', async () => {
      const err = Object.assign(new Error('Request Timeout'), { code: 7 });
      const ctx = makeCtx({ sendRequest: jest.fn().mockRejectedValue(err) });

      await performAuthCheck(ctx, 'testUser', 'badPass');

      expect(ClientBridge.setAuthError).toHaveBeenCalledWith({ code: 7, message: 'Request Timeout' });
    });

    it('stores the credentials and raises no error on a valid logon', async () => {
      const ctx = makeCtx({ sendRequest: jest.fn().mockResolvedValue({ type: WsMessageType.RESP_AUTH_SUCCESS }) });

      await performAuthCheck(ctx, 'testUser', 'testPass');

      expect(ClientBridge.setCredentials).toHaveBeenCalledWith('testUser');
      expect(ClientBridge.setAuthError).not.toHaveBeenCalled();
    });
  });

  describe('handleCreateCompany()', () => {
    it('creates company and auto-selects when called from login (no map UI)', async () => {
      const ctx = makeCtx({
        sendRequest: jest.fn().mockResolvedValue({
          type: WsMessageType.RESP_CREATE_COMPANY,
          success: true,
          companyName: 'NewCo',
          companyId: '99',
        }),
        getMapNavigationUI: () => null,
      });

      // handleCreateCompany calls selectCompanyAndStart internally,
      // which calls sendRequest again — provide a second resolved value
      (ctx.sendRequest as jest.Mock)
        .mockResolvedValueOnce({
          type: WsMessageType.RESP_CREATE_COMPANY,
          success: true,
          companyName: 'NewCo',
          companyId: '99',
        })
        .mockResolvedValueOnce({
          type: 'RESP_SELECT_COMPANY',
        });

      // Mock the game-view methods that selectCompanyAndStart calls
      const fullCtx = makeCtx({
        ...ctx,
        switchToGameView: jest.fn().mockResolvedValue(undefined),
        preloadFacilityDimensions: jest.fn().mockResolvedValue(undefined),
        connectMailService: jest.fn().mockResolvedValue(undefined),
        getProfile: jest.fn().mockResolvedValue(undefined),
        initChatChannels: jest.fn().mockResolvedValue(undefined),
        sendMessage: jest.fn(),
        getMapNavigationUI: () => null,
        sendRequest: (ctx.sendRequest as jest.Mock),
      });

      await handleCreateCompany(fullCtx, 'NewCo', 'Moab');

      expect(fullCtx.availableCompanies).toContainEqual(
        expect.objectContaining({ id: '99', name: 'NewCo' }),
      );
      expect(ClientBridge.log).toHaveBeenCalledWith(
        'Company',
        'Company created: "NewCo" (ID: 99)',
      );
      expect(fullCtx.showNotification).toHaveBeenCalledWith(
        'Company "NewCo" created!',
        'success',
      );
    });
  });

  describe('resumeSession()', () => {
    const RECORD: RememberedSession = {
      username: 'testUser',
      zonePath: '',
      worldName: 'Shamba',
      companyId: '1',
      companyName: 'TestCorp',
      ownerRole: 'testUser',
    };

    function makeResumeCtx(sendRequest: jest.Mock): ClientHandlerContext {
      return makeCtx({
        sendRequest,
        switchToGameView: jest.fn().mockResolvedValue(undefined),
        preloadFacilityDimensions: jest.fn().mockResolvedValue(undefined),
        connectMailService: jest.fn().mockResolvedValue(undefined),
        getProfile: jest.fn().mockResolvedValue(undefined),
        initChatChannels: jest.fn().mockResolvedValue(undefined),
        sendMessage: jest.fn(),
        getMapNavigationUI: () => null,
        getRenderer: () => null,
      });
    }

    function typesOf(sendRequest: jest.Mock): string[] {
      return sendRequest.mock.calls.map(([req]) => (req as { type: string }).type);
    }

    it('replays the four requests in order and records the session on a happy path', async () => {
      const sendRequest = jest.fn()
        .mockResolvedValueOnce({ type: WsMessageType.RESP_AUTH_SUCCESS })
        .mockResolvedValueOnce({ type: WsMessageType.RESP_CONNECT_SUCCESS, worlds: [{ name: RECORD.worldName }] })
        .mockResolvedValueOnce({
          type: WsMessageType.RESP_LOGIN_SUCCESS,
          tycoonId: '1',
          companies: [{ id: RECORD.companyId, name: RECORD.companyName, ownerRole: RECORD.ownerRole }],
        })
        .mockResolvedValueOnce({ type: WsMessageType.RESP_RDO_RESULT });
      const ctx = makeResumeCtx(sendRequest);

      await resumeSession(ctx, RECORD, 'pw');

      expect(typesOf(sendRequest)).toEqual([
        WsMessageType.REQ_AUTH_CHECK,
        WsMessageType.REQ_CONNECT_DIRECTORY,
        WsMessageType.REQ_LOGIN_WORLD,
        WsMessageType.REQ_SELECT_COMPANY,
      ]);
      expect(ctx.currentZonePath).toBe('');
      expect(gameStoreState.rememberSession).toHaveBeenCalledWith(
        expect.objectContaining({
          username: RECORD.username,
          zonePath: '',
          worldName: RECORD.worldName,
          companyId: RECORD.companyId,
          companyName: RECORD.companyName,
        }),
      );
      expect(gameStoreState.forgetRememberedSession).not.toHaveBeenCalled();
      expect(gameStoreState.setResumeTarget).toHaveBeenLastCalledWith(null);
    });

    it('stops after the first request and forgets the record when the sign-in is refused', async () => {
      const sendRequest = jest.fn().mockRejectedValueOnce(new Error('bad credentials'));
      const ctx = makeResumeCtx(sendRequest);

      await resumeSession(ctx, RECORD, 'pw');

      expect(sendRequest).toHaveBeenCalledTimes(1);
      expect(gameStoreState.forgetRememberedSession).toHaveBeenCalled();
      expect(ClientBridge.showError).toHaveBeenCalledWith(
        expect.stringContaining(RECORD.worldName),
      );
    });

    it('stops after two requests when the world is no longer listed in its region', async () => {
      const sendRequest = jest.fn()
        .mockResolvedValueOnce({ type: WsMessageType.RESP_AUTH_SUCCESS })
        .mockResolvedValueOnce({ type: WsMessageType.RESP_CONNECT_SUCCESS, worlds: [{ name: 'SomeOtherWorld' }] });
      const ctx = makeResumeCtx(sendRequest);

      await resumeSession(ctx, RECORD, 'pw');

      expect(sendRequest).toHaveBeenCalledTimes(2);
      expect(gameStoreState.forgetRememberedSession).toHaveBeenCalled();
    });

    it('stops after three requests when the company is no longer there', async () => {
      const sendRequest = jest.fn()
        .mockResolvedValueOnce({ type: WsMessageType.RESP_AUTH_SUCCESS })
        .mockResolvedValueOnce({ type: WsMessageType.RESP_CONNECT_SUCCESS, worlds: [{ name: RECORD.worldName }] })
        .mockResolvedValueOnce({ type: WsMessageType.RESP_LOGIN_SUCCESS, tycoonId: '1', companies: [] });
      const ctx = makeResumeCtx(sendRequest);

      await resumeSession(ctx, RECORD, 'pw');

      expect(sendRequest).toHaveBeenCalledTimes(3);
      expect(gameStoreState.forgetRememberedSession).toHaveBeenCalled();
      expect(ClientBridge.showError).toHaveBeenCalledWith(
        expect.stringContaining(RECORD.companyName),
      );
    });

    it('stops after three requests when the world login itself returns a denial page', async () => {
      const sendRequest = jest.fn()
        .mockResolvedValueOnce({ type: WsMessageType.RESP_AUTH_SUCCESS })
        .mockResolvedValueOnce({ type: WsMessageType.RESP_CONNECT_SUCCESS, worlds: [{ name: RECORD.worldName }] })
        .mockResolvedValueOnce({
          type: WsMessageType.RESP_LOGIN_SUCCESS,
          tycoonId: '1',
          companies: [],
          loginPage: { kind: 'denied', expiresOn: '01/01/2020' },
        });
      const ctx = makeResumeCtx(sendRequest);

      await resumeSession(ctx, RECORD, 'pw');

      expect(sendRequest).toHaveBeenCalledTimes(3);
      expect(gameStoreState.forgetRememberedSession).toHaveBeenCalled();
    });

    it('sets ctx.currentZonePath from performDirectoryLogin regardless of the caller', async () => {
      const sendRequest = jest.fn().mockResolvedValue({ type: WsMessageType.RESP_CONNECT_SUCCESS, worlds: [] });
      const ctx = makeResumeCtx(sendRequest);
      ctx.storedUsername = 'testUser';
      ctx.storedPassword = 'pw';

      await performDirectoryLogin(ctx, 'testUser', 'pw', 'Root/Areas/Asia/Worlds');

      expect(ctx.currentZonePath).toBe('Root/Areas/Asia/Worlds');
    });
  });

  describe('profileSwitchCompany() / applyLocalCompanySwitch()', () => {
    it('applies the local switch after the request resolves', async () => {
      const ctx = makeCtx({ sendRequest: jest.fn().mockResolvedValue({}) });

      await profileSwitchCompany(ctx, '55', 'SPO_test3 - Green', 'SPO_test3');

      expect(ctx.currentCompanyName).toBe('SPO_test3 - Green');
      expect(ClientBridge.setCompany).toHaveBeenCalledWith('SPO_test3 - Green', '55');
      expect(ClientBridge.setPublicOfficeRole).toHaveBeenCalledWith(false, '');
      expect(mockProfileStoreMethods.reset).toHaveBeenCalled();
      expect(ClientBridge.showSuccess).toHaveBeenCalledWith('Switched to SPO_test3 - Green');
    });

    it('a public-office role is flagged and named', () => {
      const ctx = makeCtx();
      applyLocalCompanySwitch(ctx, { id: '56', name: 'Mayor of Kalisz', ownerRole: 'Mayor of Kalisz' });

      expect(ClientBridge.setPublicOfficeRole).toHaveBeenCalledWith(true, 'Mayor of Kalisz');
    });

    it('a request failure shows an error and applies no local switch', async () => {
      const ctx = makeCtx({ sendRequest: jest.fn().mockRejectedValue(new Error('ECONNRESET')) });

      await profileSwitchCompany(ctx, '55', 'SPO_test3 - Green', 'SPO_test3');

      expect(ClientBridge.showError).toHaveBeenCalledWith('Failed to switch company: ECONNRESET');
      expect(ClientBridge.setCompany).not.toHaveBeenCalled();
    });
  });

  describe('abandonRole()', () => {
    const HOME_COMPANY = { id: '55', name: 'SPO_test3 - Green', ownerRole: 'SPO_test3' };

    it('switched: applies the local switch to the personal company, no login request', async () => {
      const sendRequest = jest.fn().mockResolvedValue({ success: true, switchedTo: HOME_COMPANY });
      const ctx = makeCtx({ sendRequest });

      await abandonRole(ctx);

      expect(ClientBridge.setCompany).toHaveBeenCalledWith('SPO_test3 - Green', '55');
      expect(ClientBridge.setPublicOfficeRole).toHaveBeenCalledWith(false, '');
      expect(mockProfileStoreMethods.reset).toHaveBeenCalled();
      expect(sendRequest).toHaveBeenCalledTimes(1);
      expect(mockGameStoreMethods.enterServerSwitch).not.toHaveBeenCalled();
    });

    it('unchanged: only the toast and the profile refresh counter', async () => {
      const sendRequest = jest.fn().mockResolvedValue({ success: true, message: 'abandonRole completed successfully' });
      const ctx = makeCtx({ sendRequest });

      await abandonRole(ctx);

      expect(mockProfileStoreMethods.incrementRefresh).toHaveBeenCalled();
      expect(ClientBridge.showSuccess).toHaveBeenCalledWith('abandonRole completed successfully');
      expect(ClientBridge.setCompany).not.toHaveBeenCalled();
    });

    it('no-company: re-enters the world as the personal tycoon through a login request', async () => {
      const sendRequest = jest.fn()
        .mockResolvedValueOnce({ success: true, returnToCompanyStage: true })
        .mockResolvedValueOnce({ type: WsMessageType.RESP_LOGIN_SUCCESS, tycoonId: '42', companies: [] });
      const ctx = makeCtx({ sendRequest, currentWorldName: 'Shamba' });

      await abandonRole(ctx);

      expect(mockGameStoreMethods.enterServerSwitch).toHaveBeenCalled();
      expect(mockGameStoreMethods.setLoginCompanies).toHaveBeenCalledWith([]);
      expect(mockGameStoreMethods.setLoginLoading).toHaveBeenCalledWith(true);
      expect(sendRequest).toHaveBeenCalledTimes(2);
      expect(sendRequest.mock.calls[1][0]).toEqual(expect.objectContaining({
        type: WsMessageType.REQ_LOGIN_WORLD,
        worldName: 'Shamba',
      }));
    });

    it('failure: shows the server message, no store changes', async () => {
      const sendRequest = jest.fn().mockResolvedValue({ success: false, message: 'abandonRole was not applied: the role is still held' });
      const ctx = makeCtx({ sendRequest });

      await abandonRole(ctx);

      expect(ClientBridge.showError).toHaveBeenCalledWith('abandonRole was not applied: the role is still held');
      expect(ClientBridge.setCompany).not.toHaveBeenCalled();
      expect(mockGameStoreMethods.enterServerSwitch).not.toHaveBeenCalled();
    });

    it('a rejected request shows the failure without leaving the switching flag set', async () => {
      const sendRequest = jest.fn().mockRejectedValue(new Error('ECONNRESET'));
      const ctx = makeCtx({ sendRequest });

      await abandonRole(ctx);

      expect(ClientBridge.showError).toHaveBeenCalledWith('Abandon role failed: ECONNRESET');
      expect(mockGameStoreMethods.setSwitchingCompany).toHaveBeenLastCalledWith(false);
    });
  });
});
