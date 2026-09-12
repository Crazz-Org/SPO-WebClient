import { login, handleCreateCompany, performAuthCheck } from './auth-handler';
import { ClientBridge } from '../bridge/client-bridge';
import { WsMessageType } from '../../shared/types';
import type { ClientHandlerContext } from './client-context';

jest.mock('../bridge/client-bridge', () => ({
  ClientBridge: {
    log: jest.fn(),
    showCompanies: jest.fn(),
    showLoginPage: jest.fn(),
    showError: jest.fn(),
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

jest.mock('../store/game-store', () => ({
  useGameStore: { getState: () => ({ setLoginStage: jest.fn(), settings: mockStoreSettings }) },
}));

jest.mock('../store/profile-store', () => ({
  useProfileStore: { getState: () => ({ reset: jest.fn() }) },
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
});
