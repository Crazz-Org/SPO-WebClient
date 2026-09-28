import {
  login,
  handleCreateCompany,
  performAuthCheck,
  performDirectoryLogin,
  visitWorld,
  VISITOR_COMPANY_ID,
  selectCompanyAndStart,
  resumeSession,
  profileSwitchCompany,
  applyLocalCompanySwitch,
  abandonRole,
  enterFromResumeSnapshot,
  applyResumeStats,
  logout,
} from './auth-handler';
import { ClientBridge } from '../bridge/client-bridge';
import { WsMessageType } from '../../shared/types';
import type { ClientHandlerContext } from './client-context';
import type { RememberedSession } from '../store/remembered-session';
import type { WsRespResumeSession, WsMessage } from '../../shared/types';

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
    loadAccountSettings: jest.fn(),
    setPublicOfficeRole: jest.fn(),
    setMapLoadingProgress: jest.fn(),
    setAuthError: jest.fn(),
    updateTycoonStats: jest.fn(),
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
  setActiveUsername: jest.fn(),
  setGameDate: jest.fn(),
};

/** The remembered record the store holds for the current test — `enterFromResumeSnapshot` reads it. */
let mockRememberedSession: RememberedSession | null = null;

const gameStoreState = mockGameStoreMethods;

jest.mock('../store/game-store', () => ({
  useGameStore: {
    getState: () => ({ ...mockGameStoreMethods, settings: mockStoreSettings, rememberedSession: mockRememberedSession }),
  },
  delphiTDateTimeToJsDate: (jest.requireActual('../store/game-store') as typeof import('../store/game-store')).delphiTDateTimeToJsDate,
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

    it('loads the account settings with the language it just sent', async () => {
      const sendRequest = jest.fn().mockResolvedValue({
        type: WsMessageType.RESP_LOGIN_SUCCESS, tycoonId: '42', companies: [],
      });

      await login(makeCtx({ sendRequest }), 'Shamba');

      expect(ClientBridge.loadAccountSettings).toHaveBeenCalledWith('testUser', '0');
    });

    it('records the normalised language when the store holds one the catalogue does not name', async () => {
      mockStoreSettings.languageId = '99';
      const sendRequest = jest.fn().mockResolvedValue({
        type: WsMessageType.RESP_LOGIN_SUCCESS, tycoonId: '42', companies: [],
      });

      await login(makeCtx({ sendRequest }), 'Shamba');

      expect(ClientBridge.loadAccountSettings).toHaveBeenCalledWith('testUser', '0');
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

    it('shows the visa page and never shows companies when loginPage is a visa', async () => {
      const ctx = makeCtx({
        sendRequest: jest.fn().mockResolvedValue({
          type: WsMessageType.RESP_LOGIN_SUCCESS,
          tycoonId: '42',
          companies: [],
          loginPage: { kind: 'visa', firstVisit: true },
        }),
      });

      await login(ctx, 'Shamba');

      expect(ClientBridge.showLoginPage).toHaveBeenCalledWith({ kind: 'visa', firstVisit: true });
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
        'Could not sign in to this world — something went wrong. Try again.',
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
      expect(ClientBridge.loadAccountSettings).not.toHaveBeenCalled();
    });
  });

  describe('selectCompanyAndStart()', () => {
    it('waits for the terrain chunks at the renderer\'s current zoom, not a fixed 2 (#1072)', async () => {
      const awaitChunksReady = jest.fn().mockResolvedValue(undefined);
      const getVisibleChunkCoords = jest.fn(() => [{ i: 0, j: 0 }]);
      const rendererStub = {
        getZoom: () => 0,
        getVisibleChunkCoords,
        getChunkCache: () => ({ awaitChunksReady }),
        setSeason: jest.fn(),
        centerOn: jest.fn(),
      };
      const ctx = makeCtx({
        availableCompanies: [],
        sendRequest: jest.fn().mockResolvedValue({ type: 'RESP_SELECT_COMPANY' }),
        switchToGameView: jest.fn().mockResolvedValue(undefined),
        preloadFacilityDimensions: jest.fn().mockResolvedValue(undefined),
        connectMailService: jest.fn().mockResolvedValue(undefined),
        getProfile: jest.fn().mockResolvedValue(undefined),
        initChatChannels: jest.fn().mockResolvedValue(undefined),
        sendMessage: jest.fn(),
        getRenderer: () => rendererStub as unknown as ReturnType<ClientHandlerContext['getRenderer']>,
      });

      await selectCompanyAndStart(ctx, '0');

      expect(getVisibleChunkCoords).toHaveBeenCalledWith(0);
      expect(awaitChunksReady).toHaveBeenCalledWith(expect.anything(), 0, 15_000, expect.any(Function));
    });

    it('enters as the visitor for company id "0" with an empty company list', async () => {
      const ctx = makeCtx({
        availableCompanies: [],
        sendRequest: jest.fn().mockResolvedValue({ type: 'RESP_SELECT_COMPANY' }),
        switchToGameView: jest.fn().mockResolvedValue(undefined),
        preloadFacilityDimensions: jest.fn().mockResolvedValue(undefined),
        connectMailService: jest.fn().mockResolvedValue(undefined),
        getProfile: jest.fn().mockResolvedValue(undefined),
        initChatChannels: jest.fn().mockResolvedValue(undefined),
        sendMessage: jest.fn(),
      });

      await selectCompanyAndStart(ctx, '0');

      expect(ctx.sendRequest).toHaveBeenCalledWith(
        expect.objectContaining({ type: WsMessageType.REQ_SELECT_COMPANY, companyId: '0' }),
      );
      expect(ClientBridge.setCompany).toHaveBeenCalledWith('[VISITOR VISA]', '0');
      expect(ClientBridge.setPublicOfficeRole).toHaveBeenCalledWith(false, '');
      expect(ctx.showNotification).not.toHaveBeenCalled();
    });

    it('entering a role company makes the role the active username', async () => {
      const ctx = makeCtx({
        availableCompanies: [{ id: '56', name: 'Mayor of Kalisz', ownerRole: 'Mayor of Kalisz' }],
        sendRequest: jest.fn().mockResolvedValue({ type: 'RESP_SWITCH_COMPANY' }),
        switchToGameView: jest.fn().mockResolvedValue(undefined),
        preloadFacilityDimensions: jest.fn().mockResolvedValue(undefined),
        connectMailService: jest.fn().mockResolvedValue(undefined),
        getProfile: jest.fn().mockResolvedValue(undefined),
        initChatChannels: jest.fn().mockResolvedValue(undefined),
        sendMessage: jest.fn(),
      });

      await selectCompanyAndStart(ctx, '56');

      expect(ctx.sendRequest).toHaveBeenCalledWith(
        expect.objectContaining({ type: WsMessageType.REQ_SWITCH_COMPANY }),
      );
      expect(mockGameStoreMethods.setActiveUsername).toHaveBeenCalledWith('Mayor of Kalisz');
    });

    it('a rejected selection shows the player sentence, the raw text only in the log', async () => {
      const ctx = makeCtx({
        availableCompanies: [],
        sendRequest: jest.fn().mockRejectedValue(new Error('Request Timeout')),
      });

      await expect(selectCompanyAndStart(ctx, '0')).resolves.toBe(false);

      expect(ctx.showNotification).toHaveBeenCalledWith(
        'Could not start with this company — the server did not answer in time. Try again.',
        'error',
      );
      expect(ClientBridge.log).toHaveBeenCalledWith('Error', 'Company selection failed: Request Timeout');
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

      expect(ClientBridge.setAuthError).toHaveBeenCalledWith({
        code: 7,
        message: 'Could not sign in — the server did not answer in time. Try again.',
      });
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

  describe('performDirectoryLogin() — the world limit', () => {
    it('a rejected directory login shows the player sentence, the raw text only in the log', async () => {
      const ctx = makeCtx({ sendRequest: jest.fn().mockRejectedValue(new Error('WebSocket not connected')) });

      await expect(performDirectoryLogin(ctx, 'testUser', 'testPass')).resolves.toBeNull();

      expect(ClientBridge.showError).toHaveBeenCalledWith(
        'Could not sign in — you are not connected to the game right now. Try again.',
      );
      expect(ClientBridge.log).toHaveBeenCalledWith('Error', 'Directory Auth Failed: WebSocket not connected');
      expect(ClientBridge.setLoginLoading).toHaveBeenCalledWith(false);
    });

    it('forwards the flag and says so in the log when the directory refused', async () => {
      const ctx = makeCtx({
        sendRequest: jest.fn().mockResolvedValue({
          type: WsMessageType.RESP_CONNECT_SUCCESS,
          worlds: [{ name: 'Shamba' }],
          atWorldLimit: true,
        }),
      });

      await performDirectoryLogin(ctx, 'testUser', 'testPass', 'Root/Areas/Asia/Worlds');

      expect(ClientBridge.showWorlds).toHaveBeenCalledWith([{ name: 'Shamba' }], true);
      expect(ClientBridge.log).toHaveBeenCalledWith(
        'Directory',
        'World limit reached — a new world can only be visited',
      );
    });

    it('says nothing and forwards nothing when the answer carried no flag', async () => {
      const ctx = makeCtx({
        sendRequest: jest.fn().mockResolvedValue({
          type: WsMessageType.RESP_CONNECT_SUCCESS,
          worlds: [{ name: 'Shamba' }],
        }),
      });

      await performDirectoryLogin(ctx, 'testUser', 'testPass', 'Root/Areas/Asia/Worlds');

      expect(ClientBridge.showWorlds).toHaveBeenCalledWith([{ name: 'Shamba' }], undefined);
      expect(ClientBridge.log).not.toHaveBeenCalledWith(
        'Directory',
        'World limit reached — a new world can only be visited',
      );
    });
  });

  describe('visitWorld()', () => {
    function makeVisitorCtx(): ClientHandlerContext {
      return makeCtx({
        sendRequest: jest.fn().mockResolvedValue({ type: 'RESP_SELECT_COMPANY' }),
        switchToGameView: jest.fn().mockResolvedValue(undefined),
        preloadFacilityDimensions: jest.fn().mockResolvedValue(undefined),
        connectMailService: jest.fn().mockResolvedValue(undefined),
        getProfile: jest.fn().mockResolvedValue(undefined),
        initChatChannels: jest.fn().mockResolvedValue(undefined),
        sendMessage: jest.fn(),
      } as unknown as Partial<ClientHandlerContext>);
    }

    it('selects the synthetic id 0 company and enters the world', async () => {
      const ctx = makeVisitorCtx();

      await visitWorld(ctx);

      expect(ctx.availableCompanies).toEqual([
        { id: VISITOR_COMPANY_ID, name: 'Visitor', ownerRole: 'testUser' },
      ]);
      // Own username: the plain REQ_SELECT_COMPANY path, not a role switch.
      expect(ctx.sendRequest).toHaveBeenCalledWith({
        type: WsMessageType.REQ_SELECT_COMPANY,
        companyId: VISITOR_COMPANY_ID,
      });
      expect(ClientBridge.log).toHaveBeenCalledWith('Company', 'Entering as a visitor');
      expect(ClientBridge.setCompany).toHaveBeenCalledWith('Visitor', VISITOR_COMPANY_ID);
    });

    it('does not add a second visitor entry when called twice', async () => {
      const ctx = makeVisitorCtx();

      await visitWorld(ctx);
      await visitWorld(ctx);

      expect(ctx.availableCompanies).toHaveLength(1);
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

    it('stops after three requests when the world login itself returns a denial page, leaving the record and the page standing', async () => {
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
      expect(gameStoreState.forgetRememberedSession).not.toHaveBeenCalled();
      expect(ClientBridge.showError).not.toHaveBeenCalled();
      expect(ClientBridge.showLoginPage).toHaveBeenCalledWith({ kind: 'denied', expiresOn: '01/01/2020' });
      expect(gameStoreState.setResumeTarget).toHaveBeenLastCalledWith(null);
    });

    it('stops after three requests when the world login returns a visa choice, leaving the record and the page standing', async () => {
      const sendRequest = jest.fn()
        .mockResolvedValueOnce({ type: WsMessageType.RESP_AUTH_SUCCESS })
        .mockResolvedValueOnce({ type: WsMessageType.RESP_CONNECT_SUCCESS, worlds: [{ name: RECORD.worldName }] })
        .mockResolvedValueOnce({
          type: WsMessageType.RESP_LOGIN_SUCCESS,
          tycoonId: '1',
          companies: [],
          loginPage: { kind: 'visa', firstVisit: true },
        });
      const ctx = makeResumeCtx(sendRequest);

      await resumeSession(ctx, RECORD, 'pw');

      expect(sendRequest).toHaveBeenCalledTimes(3);
      expect(gameStoreState.forgetRememberedSession).not.toHaveBeenCalled();
      expect(ClientBridge.showError).not.toHaveBeenCalled();
      expect(ClientBridge.showLoginPage).toHaveBeenCalledWith({ kind: 'visa', firstVisit: true });
      expect(gameStoreState.setResumeTarget).toHaveBeenLastCalledWith(null);
    });

    it('stops after two requests and forgets the record when the session no longer holds credentials for the world login', async () => {
      const sendRequest = jest.fn()
        .mockResolvedValueOnce({ type: WsMessageType.RESP_AUTH_SUCCESS })
        .mockResolvedValueOnce({ type: WsMessageType.RESP_CONNECT_SUCCESS, worlds: [{ name: RECORD.worldName }] });
      const ctx = makeResumeCtx(sendRequest);

      // An empty password: performAuthCheck/performDirectoryLogin store it verbatim on ctx, so
      // login()'s own `!ctx.storedPassword` guard fires — the "nothing was sent" branch.
      await resumeSession(ctx, RECORD, '');

      expect(sendRequest).toHaveBeenCalledTimes(2);
      expect(gameStoreState.forgetRememberedSession).toHaveBeenCalled();
      expect(ClientBridge.showError).toHaveBeenCalledWith(
        expect.stringContaining('no longer held the saved sign-in'),
      );
    });

    it('stops after three requests and forgets the record when the world login is refused, without stacking a second toast', async () => {
      const sendRequest = jest.fn()
        .mockResolvedValueOnce({ type: WsMessageType.RESP_AUTH_SUCCESS })
        .mockResolvedValueOnce({ type: WsMessageType.RESP_CONNECT_SUCCESS, worlds: [{ name: RECORD.worldName }] })
        .mockRejectedValueOnce(Object.assign(new Error('nope'), { serverMessage: 'You supplied an invalid password.' }));
      const ctx = makeResumeCtx(sendRequest);

      await resumeSession(ctx, RECORD, 'pw');

      expect(sendRequest).toHaveBeenCalledTimes(3);
      expect(ctx.showNotification).toHaveBeenCalledWith('World login failed: You supplied an invalid password.', 'error');
      expect(ClientBridge.showError).not.toHaveBeenCalled();
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

    it('a role company makes the role the active username', () => {
      const ctx = makeCtx();
      applyLocalCompanySwitch(ctx, { id: '56', name: 'Mayor of Kalisz', ownerRole: 'Mayor of Kalisz' });

      expect(mockGameStoreMethods.setActiveUsername).toHaveBeenCalledWith('Mayor of Kalisz');
    });

    it('a company with no ownerRole falls back to the plain username', () => {
      const ctx = makeCtx();
      applyLocalCompanySwitch(ctx, { id: '55', name: 'SPO_test3 - Green', ownerRole: '' });

      expect(mockGameStoreMethods.setActiveUsername).toHaveBeenCalledWith('testUser');
    });

    it('a request failure shows an error and applies no local switch', async () => {
      const ctx = makeCtx({ sendRequest: jest.fn().mockRejectedValue(new Error('ECONNRESET')) });

      await profileSwitchCompany(ctx, '55', 'SPO_test3 - Green', 'SPO_test3');

      expect(ClientBridge.showError).toHaveBeenCalledWith('Could not switch company — something went wrong. Try again.');
      expect(ClientBridge.log).toHaveBeenCalledWith('Error', 'Failed to switch company: ECONNRESET');
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

      expect(ClientBridge.showError).toHaveBeenCalledWith('Could not abandon this role — something went wrong. Try again.');
      expect(ClientBridge.log).toHaveBeenCalledWith('Error', 'Abandon role failed: ECONNRESET');
      expect(mockGameStoreMethods.setSwitchingCompany).toHaveBeenLastCalledWith(false);
    });
  });
});

describe('session resume from a snapshot (issue 1046)', () => {
  const SNAPSHOT: WsRespResumeSession = {
    type: WsMessageType.RESP_RESUME_SESSION,
    username: 'testUser',
    tycoonId: 'T7',
    worldName: 'Shamba',
    worldXSize: 1000,
    worldYSize: 2000,
    worldSeason: 3,
    company: { id: '12', name: 'TestCorp' },
    accountMoney: '5000',
    virtualDate: 45000,
    failureLevel: 1,
    playerX: 0,
    playerY: 0,
    chatChannel: 'Lobby',
  };

  function makeEnterCtx(renderer: unknown = null, overrides: Partial<ClientHandlerContext> = {}): ClientHandlerContext {
    return makeCtx({
      storedUsername: '',
      storedPassword: '',
      switchToGameView: jest.fn().mockResolvedValue(undefined),
      preloadFacilityDimensions: jest.fn().mockResolvedValue(undefined),
      connectMailService: jest.fn().mockResolvedValue(undefined),
      getProfile: jest.fn().mockResolvedValue(undefined),
      initChatChannels: jest.fn().mockResolvedValue(undefined),
      sendMessage: jest.fn(),
      getRenderer: () => renderer as ReturnType<ClientHandlerContext['getRenderer']>,
      ...overrides,
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockRememberedSession = null;
  });

  it('sets the credentials with the tycoon id, the world and the company, and sends no request', async () => {
    const ctx = makeEnterCtx();

    await expect(enterFromResumeSnapshot(ctx, SNAPSHOT)).resolves.toBe(true);

    expect(ctx.storedUsername).toBe('testUser');
    expect(ctx.storedPassword).toBe('');
    expect(ClientBridge.setCredentials).toHaveBeenCalledWith('testUser', 'T7');
    expect(ClientBridge.loadAccountSettings).toHaveBeenCalledWith('testUser', '0');
    expect(ClientBridge.setWorld).toHaveBeenCalledWith('Shamba');
    expect(ClientBridge.setCompany).toHaveBeenCalledWith('TestCorp', '12');
    expect(ctx.worldXSize).toBe(1000);
    expect(ctx.worldYSize).toBe(2000);
    expect(ctx.worldSeason).toBe(3);
    expect(ctx.availableCompanies).toEqual([{ id: '12', name: 'TestCorp' }]);
    expect(ClientBridge.setPublicOfficeRole).toHaveBeenCalledWith(false, '');
    expect(ctx.switchToGameView).toHaveBeenCalledTimes(1);
    expect(ctx.sendRequest).not.toHaveBeenCalled();
    expect(ClientBridge.updateTycoonStats).toHaveBeenCalledWith(expect.objectContaining({ cash: '5000', failureLevel: 1 }));
    expect(gameStoreState.setGameDate).toHaveBeenCalledWith(expect.any(Date));
  });

  it('a null tycoon id sets the credentials without one', async () => {
    const ctx = makeEnterCtx();
    await enterFromResumeSnapshot(ctx, { ...SNAPSHOT, tycoonId: null });
    expect(ClientBridge.setCredentials).toHaveBeenCalledWith('testUser', undefined);
  });

  it('a mayor ownerRole sets the public-office role', async () => {
    const ctx = makeEnterCtx();
    await enterFromResumeSnapshot(ctx, {
      ...SNAPSHOT, company: { id: '56', name: 'Mayor of Kalisz', ownerRole: 'Mayor of Kalisz' },
    });
    expect(ClientBridge.setPublicOfficeRole).toHaveBeenCalledWith(true, 'Mayor of Kalisz');
    expect(ctx.availableCompanies).toEqual([{ id: '56', name: 'Mayor of Kalisz', ownerRole: 'Mayor of Kalisz' }]);
  });

  it('takes the zonePath from a matching remembered record, and \'\' otherwise', async () => {
    mockRememberedSession = {
      username: 'TESTUSER', zonePath: 'Root/Areas/Free', worldName: 'Shamba', companyId: '12', companyName: 'TestCorp',
    };
    const matching = makeEnterCtx();
    await enterFromResumeSnapshot(matching, SNAPSHOT);
    expect(matching.currentZonePath).toBe('Root/Areas/Free');

    mockRememberedSession = { ...mockRememberedSession, worldName: 'Other' };
    const otherWorld = makeEnterCtx(null, { currentZonePath: 'stale' });
    await enterFromResumeSnapshot(otherWorld, SNAPSHOT);
    expect(otherWorld.currentZonePath).toBe('');

    mockRememberedSession = null;
    const none = makeEnterCtx(null, { currentZonePath: 'stale' });
    await enterFromResumeSnapshot(none, SNAPSHOT);
    expect(none.currentZonePath).toBe('');
  });

  it('a zero position leaves the saved camera unset; a real one centres the renderer on it', async () => {
    const centerOn = jest.fn();
    const renderer = {
      setSeason: jest.fn(), centerOn, getZoom: () => 2, getVisibleChunkCoords: () => [], getChunkCache: () => null,
    };
    const zero = makeEnterCtx(renderer);
    await enterFromResumeSnapshot(zero, SNAPSHOT);
    expect(zero.savedPlayerX).toBeUndefined();
    expect(centerOn).not.toHaveBeenCalled();

    const placed = makeEnterCtx(renderer);
    await enterFromResumeSnapshot(placed, { ...SNAPSHOT, playerX: 400, playerY: 500 });
    expect(placed.savedPlayerX).toBe(400);
    expect(placed.savedPlayerY).toBe(500);
    expect(centerOn).toHaveBeenCalledWith(400, 500);
    expect(renderer.setSeason).toHaveBeenCalledWith(3);
  });

  it('a null company or world returns false and sends nothing', async () => {
    const noCompany = makeEnterCtx();
    await expect(enterFromResumeSnapshot(noCompany, { ...SNAPSHOT, company: null })).resolves.toBe(false);
    const noWorld = makeEnterCtx();
    await expect(enterFromResumeSnapshot(noWorld, { ...SNAPSHOT, worldName: null })).resolves.toBe(false);

    for (const ctx of [noCompany, noWorld]) {
      expect(ctx.sendMessage).not.toHaveBeenCalled();
      expect(ctx.switchToGameView).not.toHaveBeenCalled();
    }
    expect(ClientBridge.setCredentials).not.toHaveBeenCalled();
  });

  it('a throwing switchToGameView returns false and shows the player sentence', async () => {
    const ctx = makeEnterCtx(null, { switchToGameView: jest.fn().mockRejectedValue(new Error('boom')) });

    await expect(enterFromResumeSnapshot(ctx, SNAPSHOT)).resolves.toBe(false);

    expect(ctx.showNotification).toHaveBeenCalledWith(expect.stringMatching(/^Could not return to your session/), 'error');
    expect(ctx.showNotification).not.toHaveBeenCalledWith(expect.stringContaining('boom'), 'error');
    expect(ClientBridge.log).toHaveBeenCalledWith('Error', 'Session re-attach failed: boom');
  });

  describe('applyResumeStats()', () => {
    it('keeps the known stats, replaces the cash, and skips the unknown fields', () => {
      const ctx = makeCtx({
        currentTycoonData: { cash: '1', incomePerHour: '2', ranking: 3, buildingCount: 4, maxBuildings: 5 },
      });

      applyResumeStats(ctx, { ...SNAPSHOT, accountMoney: null, failureLevel: null, virtualDate: null });

      expect(ctx.currentTycoonData).toEqual({ cash: '1', incomePerHour: '2', ranking: 3, buildingCount: 4, maxBuildings: 5 });
      const stats = (ClientBridge.updateTycoonStats as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
      expect(stats).toEqual({ username: 'testUser', cash: '1', incomePerHour: '2', ranking: 3, buildingCount: 4, maxBuildings: 5 });
      expect(gameStoreState.setGameDate).not.toHaveBeenCalled();
    });

    it('starts from zeroes when nothing is known yet', () => {
      const ctx = makeCtx({ currentTycoonData: null });
      applyResumeStats(ctx, SNAPSHOT);
      expect(ctx.currentTycoonData).toEqual({ cash: '5000', incomePerHour: '0', ranking: 0, buildingCount: 0, maxBuildings: 0 });
    });
  });

  it('logout deletes the held resume token before REQ_LOGOUT is sent', async () => {
    const mem = new Map<string, string>([['spo_resume_token', '{"username":"u","token":"t"}']]);
    Object.defineProperty(globalThis, 'sessionStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => mem.get(k) ?? null,
        setItem: (k: string, v: string) => { mem.set(k, v); },
        removeItem: (k: string) => { mem.delete(k); },
      },
    });
    try {
      let heldAtSend: boolean | null = null;
      const ctx = makeCtx({
        sendRequest: jest.fn(async () => { heldAtSend = mem.has('spo_resume_token'); return { type: WsMessageType.RESP_LOGOUT, success: true } as WsMessage; }),
        closeAfterLogout: jest.fn(),
      });

      await logout(ctx);

      expect(heldAtSend).toBe(false);
      expect(ctx.closeAfterLogout).toHaveBeenCalledTimes(1);
    } finally {
      // @ts-expect-error — removing the stub we installed
      delete globalThis.sessionStorage;
    }
  });
});
