import { login, handleCreateCompany } from './auth-handler';
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
  },
}));

jest.mock('../store/game-store', () => ({
  useGameStore: { getState: () => ({ setLoginStage: jest.fn() }) },
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
  });

  describe('login()', () => {
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
      expect(ClientBridge.showCompanies).toHaveBeenCalledWith(companies);
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
      expect(ClientBridge.showCompanies).toHaveBeenCalledWith([]);
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
      expect(ClientBridge.showCompanies).toHaveBeenCalledWith([]);
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

      expect(ClientBridge.showCompanies).toHaveBeenCalledWith(companies);
      expect(ClientBridge.showLoginPage).not.toHaveBeenCalled();
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

    it('aborts if credentials are missing', async () => {
      const ctx = makeCtx({ storedUsername: '', storedPassword: '' });

      await login(ctx, 'Shamba');

      expect(ClientBridge.showError).toHaveBeenCalledWith('Session lost, please reconnect');
      expect(ClientBridge.showCompanies).not.toHaveBeenCalled();
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
