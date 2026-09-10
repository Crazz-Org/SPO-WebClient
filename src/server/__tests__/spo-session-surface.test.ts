/**
 * StarpeaceSession — the facade surface.
 *
 * Most of the 3 000 lines of `spo_session.ts` are not behaviour: they are the
 * seam between the WebSocket layer and the extracted handlers. Roughly 60
 * methods are one-line delegations, and another 60 are the getters and setters
 * that make the class satisfy `SessionContext`, `LoginContext` and `PushContext`.
 *
 * That seam is exactly where a silent defect hides — a handler called with the
 * wrong argument order, a delegation that drops its return value, a getter wired
 * to the neighbouring field. So it is tested as a TABLE, derived by reading the
 * facade block by block, and every row asserts three things: the handler is
 * called, it receives `(session, …the caller's arguments)`, and whatever it
 * answers comes back untouched.
 *
 * What is NOT here: the transport (`sendRdoRequest` and its buffering, timeouts
 * and pool), the timers, and teardown. Those need a live socket and live at
 * `spo-session-lifecycle.test.ts`.
 */

jest.mock('node-fetch', () => ({ __esModule: true, default: jest.fn() }));

import { EventEmitter } from 'events';
import type { Socket } from 'net';
import fetch from 'node-fetch';
import { StarpeaceSession } from '../spo_session';
import type { AspActionUrl } from '../asp-url-extractor';
import * as chatHandler from '../session/chat-handler';
import * as mailHandler from '../session/mail-handler';
import * as profileFinanceHandler from '../session/profile-finance-handler';
import * as autoConnectionHandler from '../session/auto-connection-handler';
import * as politicsHandler from '../session/politics-handler';
import * as favoritesHandler from '../session/favorites-handler';
import * as buildingManagementHandler from '../session/building-management-handler';
import * as roadHandler from '../session/road-handler';
import * as zoneSurfaceHandler from '../session/zone-surface-handler';
import * as buildingTemplatesHandler from '../session/building-templates-handler';
import * as buildingDetailsHandler from '../session/building-details-handler';
import * as buildingPropertyHandler from '../session/building-property-handler';
import * as researchHandler from '../session/research-handler';
import * as loginHandler from '../session/login-handler';
import { RdoParser } from '../../shared/rdo-types';
import { PROXY_IMAGE_ENDPOINT } from '../../shared/proxy-utils';
import { SessionPhase, SurfaceType } from '../../shared/types';
import type { ChatUser, CompanyInfo, RdoPacket, WorldInfo } from '../../shared/types';

const fetchMock = fetch as unknown as jest.Mock;

afterEach(() => jest.restoreAllMocks());

const WORLD: WorldInfo = {
  name: 'planitia', url: 'http://1.2.3.4', ip: '1.2.3.4', port: 8000,
  population: 0, investors: 0, online: 0, players: 0, mapSizeX: 0, mapSizeY: 0,
};
const COMPANY: CompanyInfo = { id: '55', name: 'SPO_test3 - Green', ownerRole: 'SPO_test3' };

/**
 * The smallest thing `createSocket()` accepts. The lifecycle suite drives real
 * frames through `MockTcpSocket`; here a socket only has to be identifiable, so
 * that the socket-map accessors can be told apart.
 */
class FakeSocket extends EventEmitter {
  destroyed = false;
  setNoDelay(): this { return this; }
  connect(_port: number, _host: string, callback?: () => void): this {
    if (callback) setImmediate(callback);
    return this;
  }
  write(): boolean { return true; }
  end(): void { this.destroyed = true; }
  destroy(): this { this.destroyed = true; return this; }
}

function newSession(): StarpeaceSession {
  const session = new StarpeaceSession();
  session.setSocketFactory(() => new FakeSocket() as unknown as Socket);
  return session;
}

// ═══════════════════════════════════════════════════════════════════════════
// The delegation table
// ═══════════════════════════════════════════════════════════════════════════

type Spy = ReturnType<typeof jest.spyOn>;

interface Delegation {
  /** The session method, as the WebSocket layer calls it. */
  readonly method: string;
  /** Replace the handler export with a recorder. */
  readonly install: () => Spy;
  /** Drive the session method with concrete arguments. */
  readonly call: (session: StarpeaceSession) => unknown;
  /** What the handler must receive AFTER the session itself. */
  readonly forwarded: readonly unknown[];
  /** What the handler answers — the session must hand it back untouched. */
  readonly result: unknown;
  /**
   * `false` for the one handler that is NOT given the session.
   * `getRoadCostEstimate` is a pure computation over geometry and the caller's tile facts,
   * with no session state at all, and the facade reflects that by not passing `this`.
   */
  readonly passesSession?: boolean;
}

/**
 * The per-tile facts a road drag carries (#99) — the fifth argument both road delegations
 * now forward. One entry is enough here: the table proves forwarding, not pricing.
 */
const ROAD_FACTS = [{ hasRoad: false, isBridge: true, isVoid: false }];

const DELEGATIONS: readonly Delegation[] = [
  // ── login-handler ────────────────────────────────────────────────────────
  {
    method: 'checkAuth',
    install: () => jest.spyOn(loginHandler, 'checkAuth'),
    call: s => s.checkAuth('SPO_test3', 'test3'),
    forwarded: ['SPO_test3', 'test3'],
    result: undefined,
  },
  {
    method: 'connectDirectory',
    install: () => jest.spyOn(loginHandler, 'connectDirectory'),
    call: s => s.connectDirectory('SPO_test3', 'test3', 'Root/Areas/Free Space/Worlds'),
    forwarded: ['SPO_test3', 'test3', 'Root/Areas/Free Space/Worlds'],
    result: [WORLD],
  },
  {
    method: 'searchPeople',
    install: () => jest.spyOn(loginHandler, 'searchPeople'),
    call: s => s.searchPeople('mayor'),
    forwarded: ['mayor'],
    result: ['Mayor of Kalisz'],
  },
  {
    method: 'loginWorld',
    install: () => jest.spyOn(loginHandler, 'loginWorld'),
    call: s => s.loginWorld('SPO_test3', 'test3', WORLD),
    forwarded: ['SPO_test3', 'test3', WORLD],
    result: { contextId: '8161308', tycoonId: '22', companies: [], worldXSize: null, worldYSize: null, worldSeason: null },
  },
  {
    method: 'selectCompany',
    install: () => jest.spyOn(loginHandler, 'selectCompany'),
    call: s => s.selectCompany('55'),
    forwarded: ['55'],
    result: undefined,
  },
  {
    method: 'createCompany',
    install: () => jest.spyOn(loginHandler, 'createCompany'),
    call: s => s.createCompany('Green Inc', 'Industry'),
    forwarded: ['Green Inc', 'Industry'],
    result: { success: true, companyName: 'Green Inc', companyId: '55' },
  },
  {
    method: 'switchCompany',
    install: () => jest.spyOn(loginHandler, 'switchCompany'),
    call: s => s.switchCompany(COMPANY),
    forwarded: [COMPANY],
    result: undefined,
  },

  // ── mail-handler ─────────────────────────────────────────────────────────
  {
    method: 'composeMail',
    install: () => jest.spyOn(mailHandler, 'composeMail'),
    call: s => s.composeMail('bob@planitia', 'Subject', ['line 1', 'line 2'], 'X-Reply: 7', '30430748'),
    forwarded: ['bob@planitia', 'Subject', ['line 1', 'line 2'], 'X-Reply: 7', '30430748'],
    result: true,
  },
  {
    method: 'saveDraft',
    install: () => jest.spyOn(mailHandler, 'saveDraft'),
    call: s => s.saveDraft('bob@planitia', 'Subject', ['line 1'], 'X-Reply: 7', '30430748'),
    forwarded: ['bob@planitia', 'Subject', ['line 1'], 'X-Reply: 7', '30430748'],
    result: true,
  },
  {
    method: 'readMailMessage',
    install: () => jest.spyOn(mailHandler, 'readMailMessage'),
    call: s => s.readMailMessage('Inbox', '30430748'),
    forwarded: ['Inbox', '30430748'],
    result: { id: '30430748', subject: 'Subject' },
  },
  {
    method: 'deleteMailMessage',
    install: () => jest.spyOn(mailHandler, 'deleteMailMessage'),
    call: s => s.deleteMailMessage('Inbox', '30430748'),
    forwarded: ['Inbox', '30430748'],
    result: undefined,
  },
  {
    method: 'getMailUnreadCount',
    install: () => jest.spyOn(mailHandler, 'getMailUnreadCount'),
    call: s => s.getMailUnreadCount(),
    forwarded: [],
    result: 3,
  },
  {
    method: 'getMailFolder',
    install: () => jest.spyOn(mailHandler, 'getMailFolder'),
    call: s => s.getMailFolder('Draft'),
    forwarded: ['Draft'],
    result: [],
  },

  // ── profile-finance-handler ──────────────────────────────────────────────
  {
    method: 'fetchTycoonProfile',
    install: () => jest.spyOn(profileFinanceHandler, 'fetchTycoonProfile'),
    call: s => s.fetchTycoonProfile(),
    forwarded: [],
    result: { name: 'SPO_test3' },
  },
  {
    method: 'fetchCurriculumData',
    install: () => jest.spyOn(profileFinanceHandler, 'fetchCurriculumData'),
    call: s => s.fetchCurriculumData(),
    forwarded: [],
    result: { sections: [] },
  },
  {
    method: 'fetchBankAccount',
    install: () => jest.spyOn(profileFinanceHandler, 'fetchBankAccount'),
    call: s => s.fetchBankAccount(),
    forwarded: [],
    result: { balance: '1000' },
  },
  {
    method: 'executeBankAction',
    install: () => jest.spyOn(profileFinanceHandler, 'executeBankAction'),
    // Real money: argument ORDER is the whole risk here.
    call: s => s.executeBankAction('send', '5000', 'Mayor of Kalisz', 'thanks', 2),
    forwarded: ['send', '5000', 'Mayor of Kalisz', 'thanks', 2],
    result: { success: true },
  },
  {
    method: 'fetchProfitLoss',
    install: () => jest.spyOn(profileFinanceHandler, 'fetchProfitLoss'),
    call: s => s.fetchProfitLoss(),
    forwarded: [],
    result: { nodes: [] },
  },
  {
    method: 'fetchCompanies',
    install: () => jest.spyOn(profileFinanceHandler, 'fetchCompanies'),
    call: s => s.fetchCompanies(),
    forwarded: [],
    result: { companies: [] },
  },
  {
    method: 'fetchCompanyProfitLoss',
    install: () => jest.spyOn(profileFinanceHandler, 'fetchCompanyProfitLoss'),
    call: s => s.fetchCompanyProfitLoss('Yellow Inc.', 'PGI'),
    forwarded: ['Yellow Inc.', 'PGI'],
    result: { root: { label: 'Net', level: 0, amount: '1' } },
  },

  // ── auto-connection-handler ──────────────────────────────────────────────
  {
    method: 'fetchAutoConnections',
    install: () => jest.spyOn(autoConnectionHandler, 'fetchAutoConnections'),
    call: s => s.fetchAutoConnections(),
    forwarded: [],
    result: { fluids: [] },
  },
  {
    method: 'executeAutoConnectionAction',
    install: () => jest.spyOn(autoConnectionHandler, 'executeAutoConnectionAction'),
    call: s => s.executeAutoConnectionAction('connect', 'Plastics', 'SPO_test3 - Green'),
    forwarded: ['connect', 'Plastics', 'SPO_test3 - Green'],
    result: { success: true },
  },
  {
    method: 'fetchPolicy',
    install: () => jest.spyOn(autoConnectionHandler, 'fetchPolicy'),
    call: s => s.fetchPolicy(),
    forwarded: [],
    result: { entries: [] },
  },
  {
    method: 'setPolicyStatus',
    install: () => jest.spyOn(autoConnectionHandler, 'setPolicyStatus'),
    call: s => s.setPolicyStatus('Mayor of Kalisz', 2),
    forwarded: ['Mayor of Kalisz', 2],
    result: { success: true },
  },
  {
    method: 'executeCurriculumAction',
    install: () => jest.spyOn(autoConnectionHandler, 'executeCurriculumAction'),
    call: s => s.executeCurriculumAction('publish', true),
    forwarded: ['publish', true],
    result: { success: true },
  },

  // ── favorites-handler ────────────────────────────────────────────────────
  {
    method: 'fetchOwnedFacilities',
    install: () => jest.spyOn(favoritesHandler, 'fetchOwnedFacilities'),
    call: s => s.fetchOwnedFacilities(),
    forwarded: [],
    result: [],
  },
  {
    method: 'addFavorite',
    install: () => jest.spyOn(favoritesHandler, 'addFavorite'),
    call: s => s.addFavorite('Farm 1', 118, 226),
    forwarded: ['Farm 1', 118, 226],
    result: { success: true, id: 7 },
  },
  {
    method: 'deleteFavorite',
    install: () => jest.spyOn(favoritesHandler, 'deleteFavorite'),
    call: s => s.deleteFavorite('4210'),
    forwarded: ['4210'],
    result: { success: true },
  },
  {
    method: 'renameFavorite',
    install: () => jest.spyOn(favoritesHandler, 'renameFavorite'),
    call: s => s.renameFavorite('4210', 'Ferme du Nord'),
    forwarded: ['4210', 'Ferme du Nord'],
    result: { success: true },
  },
  {
    method: 'createFavoriteFolder',
    install: () => jest.spyOn(favoritesHandler, 'createFavoriteFolder'),
    call: s => s.createFavoriteFolder('', 'Farms'),
    forwarded: ['', 'Farms'],
    result: { success: true, id: 12 },
  },
  {
    method: 'moveFavorite',
    install: () => jest.spyOn(favoritesHandler, 'moveFavorite'),
    call: s => s.moveFavorite('4210', '12'),
    forwarded: ['4210', '12'],
    result: { success: true },
  },

  // ── politics-handler ─────────────────────────────────────────────────────
  {
    method: 'getPoliticsData',
    install: () => jest.spyOn(politicsHandler, 'getPoliticsData'),
    call: s => s.getPoliticsData('Kalisz', 706, 436),
    // The 4th argument is the Capitol flag, defaulted at the facade — the
    // delegation forwards the resolved value, not the caller's omission.
    forwarded: ['Kalisz', 706, 436, false],
    result: { ratings: [] },
  },
  {
    method: 'politicsSetRating',
    install: () => jest.spyOn(politicsHandler, 'politicsSetRating'),
    call: s => s.politicsSetRating(706, 436, '4711', 70),
    forwarded: [706, 436, '4711', 70],
    result: { success: true, message: '' },
  },
  {
    method: 'politicsSetPublicity',
    install: () => jest.spyOn(politicsHandler, 'politicsSetPublicity'),
    call: s => s.politicsSetPublicity(706, 436, '4711', 25),
    forwarded: [706, 436, '4711', 25],
    result: { success: true, message: '' },
  },
  {
    method: 'politicsSetProjectData',
    install: () => jest.spyOn(politicsHandler, 'politicsSetProjectData'),
    call: s => s.politicsSetProjectData(706, 436, '88', 'Bob'),
    forwarded: [706, 436, '88', 'Bob'],
    result: { success: true, message: '' },
  },
  {
    method: 'politicsVote',
    install: () => jest.spyOn(politicsHandler, 'politicsVote'),
    call: s => s.politicsVote(706, 436, 'Mayor of Kalisz'),
    forwarded: [706, 436, 'Mayor of Kalisz'],
    result: { success: true, message: 'voted' },
  },
  {
    method: 'politicsLaunchCampaign',
    install: () => jest.spyOn(politicsHandler, 'politicsLaunchCampaign'),
    call: s => s.politicsLaunchCampaign(706, 436, 'Kalisz'),
    forwarded: [706, 436, 'Kalisz'],
    result: { success: true, message: 'launched' },
  },
  {
    method: 'politicsCancelCampaign',
    install: () => jest.spyOn(politicsHandler, 'politicsCancelCampaign'),
    call: s => s.politicsCancelCampaign(706, 436, 'Kalisz'),
    forwarded: [706, 436, 'Kalisz'],
    result: { success: true, message: 'cancelled' },
  },
  {
    method: 'searchConnections',
    install: () => jest.spyOn(politicsHandler, 'searchConnections'),
    call: s => s.searchConnections(706, 436, 'Plastics', 'input', { town: 'Kalisz', maxResults: 20 }),
    forwarded: [706, 436, 'Plastics', 'input', { town: 'Kalisz', maxResults: 20 }],
    result: [],
  },

  // ── building-management-handler ──────────────────────────────────────────
  {
    method: 'queryTycoonPoliticalRole',
    install: () => jest.spyOn(buildingManagementHandler, 'queryTycoonPoliticalRole'),
    call: s => s.queryTycoonPoliticalRole('Mayor of Kalisz'),
    forwarded: ['Mayor of Kalisz'],
    result: { isMayor: true },
  },
  {
    method: 'manageConstruction',
    install: () => jest.spyOn(buildingManagementHandler, 'manageConstruction'),
    call: s => s.manageConstruction(706, 436, 'START', 3),
    forwarded: [706, 436, 'START', 3],
    result: { status: 'ok' },
  },
  {
    method: 'upgradeBuildingAction',
    install: () => jest.spyOn(buildingManagementHandler, 'upgradeBuildingAction'),
    call: s => s.upgradeBuildingAction(706, 436, 'START_UPGRADE', 2),
    forwarded: [706, 436, 'START_UPGRADE', 2],
    result: { success: true },
  },
  {
    method: 'renameFacility',
    install: () => jest.spyOn(buildingManagementHandler, 'renameFacility'),
    call: s => s.renameFacility(706, 436, 'Café du Coin'),
    forwarded: [706, 436, 'Café du Coin'],
    result: { success: true },
  },
  {
    method: 'deleteFacility',
    install: () => jest.spyOn(buildingManagementHandler, 'deleteFacility'),
    call: s => s.deleteFacility(706, 436),
    forwarded: [706, 436],
    result: { success: true },
  },

  // ── road-handler ─────────────────────────────────────────────────────────
  {
    method: 'buildRoad',
    install: () => jest.spyOn(roadHandler, 'buildRoad'),
    call: s => s.buildRoad(700, 430, 706, 436, ROAD_FACTS),
    forwarded: [700, 430, 706, 436, ROAD_FACTS],
    result: { success: true, cost: 1200, tileCount: 12 },
  },
  {
    method: 'getRoadCostEstimate',
    install: () => jest.spyOn(roadHandler, 'getRoadCostEstimate'),
    call: s => s.getRoadCostEstimate(700, 430, 706, 436, ROAD_FACTS),
    forwarded: [700, 430, 706, 436, ROAD_FACTS],
    result: { cost: 1200, tileCount: 12, costPerTile: 100, valid: true },
    passesSession: false,
  },
  {
    method: 'demolishRoad',
    install: () => jest.spyOn(roadHandler, 'demolishRoad'),
    call: s => s.demolishRoad(706, 436),
    forwarded: [706, 436],
    result: { success: true },
  },
  {
    method: 'wipeCircuit',
    install: () => jest.spyOn(roadHandler, 'wipeCircuit'),
    call: s => s.wipeCircuit(700, 430, 706, 436),
    forwarded: [700, 430, 706, 436],
    result: { success: true },
  },

  // ── chat-handler ─────────────────────────────────────────────────────────
  {
    method: 'getChatUserList',
    install: () => jest.spyOn(chatHandler, 'getChatUserList'),
    call: s => s.getChatUserList(),
    forwarded: [],
    result: [],
  },
  {
    method: 'getChatChannelList',
    install: () => jest.spyOn(chatHandler, 'getChatChannelList'),
    call: s => s.getChatChannelList(),
    forwarded: [],
    result: ['Lobby'],
  },
  {
    method: 'getChatChannelInfo',
    install: () => jest.spyOn(chatHandler, 'getChatChannelInfo'),
    call: s => s.getChatChannelInfo('Kalisz'),
    forwarded: ['Kalisz'],
    result: 'a town channel',
  },
  {
    method: 'joinChatChannel',
    install: () => jest.spyOn(chatHandler, 'joinChatChannel'),
    call: s => s.joinChatChannel('Kalisz'),
    forwarded: ['Kalisz'],
    result: undefined,
  },
  {
    method: 'sendChatMessage',
    install: () => jest.spyOn(chatHandler, 'sendChatMessage'),
    call: s => s.sendChatMessage('Bonjour à tous'),
    forwarded: ['Bonjour à tous'],
    result: undefined,
  },
  {
    method: 'setChatTypingStatus',
    install: () => jest.spyOn(chatHandler, 'setChatTypingStatus'),
    call: s => s.setChatTypingStatus(true),
    forwarded: [true],
    result: undefined,
  },
  {
    method: 'getCurrentChannel',
    install: () => jest.spyOn(chatHandler, 'getCurrentChannel'),
    call: s => s.getCurrentChannel(),
    forwarded: [],
    result: 'Kalisz',
  },

  // ── zone-surface-handler ─────────────────────────────────────────────────
  {
    method: 'defineZone',
    install: () => jest.spyOn(zoneSurfaceHandler, 'defineZone'),
    call: s => s.defineZone(2, 700, 430, 706, 436),
    forwarded: [2, 700, 430, 706, 436],
    result: { success: true },
  },
  {
    method: 'getSurfaceData',
    install: () => jest.spyOn(zoneSurfaceHandler, 'getSurfaceData'),
    call: s => s.getSurfaceData(SurfaceType.POLLUTION, 700, 430, 706, 436),
    forwarded: [SurfaceType.POLLUTION, 700, 430, 706, 436],
    result: { width: 6, height: 6, values: [] },
  },

  // ── building-templates-handler ───────────────────────────────────────────
  {
    method: 'fetchClusterInfo',
    install: () => jest.spyOn(buildingTemplatesHandler, 'fetchClusterInfo'),
    call: s => s.fetchClusterInfo('Industry'),
    forwarded: ['Industry'],
    result: { name: 'Industry' },
  },
  {
    method: 'fetchClusterFacilities',
    install: () => jest.spyOn(buildingTemplatesHandler, 'fetchClusterFacilities'),
    call: s => s.fetchClusterFacilities('Industry', 'Factories'),
    forwarded: ['Industry', 'Factories'],
    result: [],
  },
  {
    method: 'fetchBuildingCategories',
    install: () => jest.spyOn(buildingTemplatesHandler, 'fetchBuildingCategories'),
    call: s => s.fetchBuildingCategories('SPO_test3 - Green'),
    forwarded: ['SPO_test3 - Green'],
    result: [],
  },
  {
    method: 'fetchBuildingFacilities',
    install: () => jest.spyOn(buildingTemplatesHandler, 'fetchBuildingFacilities'),
    // Six positional arguments — the row exists to pin their order.
    call: s => s.fetchBuildingFacilities('SPO_test3 - Green', 'Industry', 'kind', 'Factories', 'folder', 4),
    forwarded: ['SPO_test3 - Green', 'Industry', 'kind', 'Factories', 'folder', 4],
    result: [],
  },
  {
    method: 'placeBuilding',
    install: () => jest.spyOn(buildingTemplatesHandler, 'placeBuilding'),
    call: s => s.placeBuilding('CarFactoryA', 706, 436),
    forwarded: ['CarFactoryA', 706, 436],
    result: { success: true, buildingId: '202334236' },
  },
  {
    method: 'placeCapitol',
    install: () => jest.spyOn(buildingTemplatesHandler, 'placeCapitol'),
    call: s => s.placeCapitol(706, 436),
    forwarded: [706, 436],
    result: { success: true, buildingId: '202334237' },
  },

  // ── building-details-handler ─────────────────────────────────────────────
  {
    method: 'getBuildingBasicDetails',
    install: () => jest.spyOn(buildingDetailsHandler, 'getBuildingBasicDetails'),
    call: s => s.getBuildingBasicDetails(706, 436, 'CarFactoryA'),
    forwarded: [706, 436, 'CarFactoryA'],
    result: { properties: [] },
  },
  {
    method: 'getBuildingTabData',
    install: () => jest.spyOn(buildingDetailsHandler, 'getBuildingTabData'),
    call: s => s.getBuildingTabData(706, 436, 'facManagement', 'CarFactoryA', ['facManagement']),
    forwarded: [706, 436, 'facManagement', 'CarFactoryA', ['facManagement']],
    result: { groups: {} },
  },
  {
    method: 'refreshBuildingProperties',
    install: () => jest.spyOn(buildingDetailsHandler, 'refreshBuildingProperties'),
    call: s => s.refreshBuildingProperties(706, 436, 'CarFactoryA', 'supplies'),
    forwarded: [706, 436, 'CarFactoryA', 'supplies'],
    result: { properties: [] },
  },
  {
    method: 'releaseInspector',
    install: () => jest.spyOn(buildingDetailsHandler, 'releaseInspector'),
    call: s => s.releaseInspector(),
    forwarded: [],
    result: undefined,
  },

  // ── building-property-handler ────────────────────────────────────────────
  {
    method: 'setBuildingProperty',
    install: () => jest.spyOn(buildingPropertyHandler, 'setBuildingProperty'),
    call: s => s.setBuildingProperty(706, 436, 'RDOSetSalaries', '110', { index: '0' }),
    forwarded: [706, 436, 'RDOSetSalaries', '110', { index: '0' }],
    result: { success: true, newValue: '110', confirmed: true },
  },

  // ── research-handler ─────────────────────────────────────────────────────
  {
    method: 'getResearchInventory',
    install: () => jest.spyOn(researchHandler, 'getResearchInventory'),
    call: s => s.getResearchInventory(706, 436, 2),
    forwarded: [706, 436, 2],
    result: { items: [] },
  },
  {
    method: 'getResearchDetails',
    install: () => jest.spyOn(researchHandler, 'getResearchDetails'),
    call: s => s.getResearchDetails(706, 436, 'Invention7'),
    forwarded: [706, 436, 'Invention7'],
    result: { name: 'Invention7' },
  },
];

describe('StarpeaceSession — handler delegation', () => {
  it.each(DELEGATIONS)(
    '$method forwards the caller arguments and returns the handler answer',
    async ({ install, call, forwarded, result, passesSession }: Delegation) => {
      const session = newSession();
      const spy = install();
      spy.mockReturnValue(result as never);

      const returned = await Promise.resolve(call(session));

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(
        ...(passesSession === false ? forwarded : [session, ...forwarded]),
      );
      expect(returned).toBe(result);
    },
  );

  it('covers every one-line handler delegation the facade declares', () => {
    // A guard on the table itself: if a delegation is added to the facade and
    // not to the table, the count stops matching and this row says so.
    expect(DELEGATIONS).toHaveLength(70);
    expect(new Set(DELEGATIONS.map(d => d.method)).size).toBe(DELEGATIONS.length);
  });

  it('does not hand the session to the pure road cost estimate', () => {
    // The single deliberate exception, restated positively: the estimate is geometry and
    // the tile facts the caller attests, so passing session state would be noise.
    const session = newSession();
    const spy = jest.spyOn(roadHandler, 'getRoadCostEstimate');
    spy.mockReturnValue({ cost: 0, tileCount: 0, costPerTile: 100, valid: false });

    session.getRoadCostEstimate(1, 2, 3, 4, ROAD_FACTS);

    expect(spy.mock.calls[0]).toEqual([1, 2, 3, 4, ROAD_FACTS]);
  });

  it('reads back the channel setCurrentChannel wrote, and calls the lobby by name', () => {
    const session = newSession();

    // getCurrentChannel is the one delegation with an observable round trip:
    // the real handler reads the private field that setCurrentChannel writes.
    expect(session.getCurrentChannel()).toBe('Lobby');

    session.setCurrentChannel('Kalisz');
    expect(session.getCurrentChannel()).toBe('Kalisz');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Proxying and ASP URLs
// ═══════════════════════════════════════════════════════════════════════════

describe('convertToProxyUrl', () => {
  it('leaves an empty URL and an already-proxied URL alone', () => {
    const session = newSession();

    expect(session.convertToProxyUrl('')).toBe('');
    const proxied = `${PROXY_IMAGE_ENDPOINT}?url=http%3A%2F%2F1.2.3.4%2Flogo.gif`;
    expect(session.convertToProxyUrl(proxied)).toBe(proxied);
  });

  it('resolves a relative URL against the world the session is playing', () => {
    const session = newSession();
    session.setCurrentWorldInfo(WORLD);

    const proxied = session.convertToProxyUrl('/five/0/visual/logo.gif');

    expect(proxied).toContain(PROXY_IMAGE_ENDPOINT);
    expect(decodeURIComponent(proxied)).toContain('1.2.3.4');
  });

  it('proxies the Capitol icon through the same path', () => {
    const session = newSession();
    session.setCurrentWorldInfo(WORLD);

    expect(session.getCapitolIconUrl()).toContain(PROXY_IMAGE_ENDPOINT);
    expect(decodeURIComponent(session.getCapitolIconUrl())).toContain('capitol.jpg');
  });
});

describe('ASP request building', () => {
  it('identifies the session with the ACTIVE username, not the account it logged in with', () => {
    const session = newSession();
    session.setCachedUsername('SPO_test3');
    session.setCachedPassword('test3');
    session.setActiveUsername('Mayor of Kalisz');
    session.setCurrentCompany(COMPANY);
    session.setCurrentWorldInfo(WORLD);
    session.setDaAddr('1.2.3.4');
    session.setDaPort(7001);
    session.setInterfaceServerId('6892548');

    const params = session.buildAspBaseParams();

    // After a role-based company switch the ASP pages must be fetched as the
    // ROLE — the tycoon account no longer owns what is being displayed.
    expect(params.get('Tycoon')).toBe('Mayor of Kalisz');
    expect(params.get('Password')).toBe('test3');
    expect(params.get('Company')).toBe('SPO_test3 - Green');
    expect(params.get('WorldName')).toBe('planitia');
    expect(params.get('DAAddr')).toBe('1.2.3.4');
    expect(params.get('DAPort')).toBe('7001');
    expect(params.get('ISAddr')).toBe('1.2.3.4');
    expect(params.get('ClientViewId')).toBe('6892548');
  });

  it('refuses to build the base params before the DA lock channel is announced', () => {
    const session = newSession();
    session.setCachedUsername('SPO_test3');

    // No DA address/port yet — there is no usable fallback, so the call refuses
    // instead of substituting the Directory Server, which cannot serve these pages.
    expect(() => session.buildAspBaseParams()).toThrow(
      'ASP call refused: DA lock channel not announced yet (daAddr/daPort unset)',
    );
  });

  it('reports no tycoon at all when nothing is cached', () => {
    const session = newSession();
    session.setDaAddr('1.2.3.4');
    session.setDaPort(7001);
    expect(session.buildAspBaseParams().get('Tycoon')).toBe('');
  });

  it('refuses to build a URL before the world IP is known', () => {
    expect(() => newSession().buildAspUrl('NewTycoon/TycoonBankAccount.asp'))
      .toThrow('World IP not available');
  });

  it('encodes spaces as %20 and lets extra parameters override the base ones', () => {
    const session = newSession();
    session.setCurrentWorldInfo(WORLD);
    session.setActiveUsername('Mayor of Kalisz');
    session.setDaAddr('1.2.3.4');
    session.setDaPort(7001);

    const url = session.buildAspUrl('NewTycoon/TycoonBankAccount.asp', { Company: 'Other Co' });

    expect(url.startsWith('http://1.2.3.4/Five/0/Visual/Voyager/NewTycoon/TycoonBankAccount.asp?')).toBe(true);
    // Legacy IIS does not decode "+" as a space in a query string.
    expect(url).not.toContain('+');
    expect(url).toContain('Tycoon=Mayor%20of%20Kalisz');
    expect(url).toContain('Company=Other%20Co');
  });
});

describe('fetchAspPage — the HTTP guard rail', () => {
  beforeEach(() => fetchMock.mockReset());

  it('returns the page body on a 2xx', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, statusText: 'OK', text: async () => '<html>ok</html>' });
    const session = newSession();
    session.setCurrentWorldInfo(WORLD);
    session.setDaAddr('1.2.3.4');
    session.setDaPort(7001);

    await expect(session.fetchAspPage('NewTycoon/TycoonBankAccount.asp')).resolves.toBe('<html>ok</html>');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('TycoonBankAccount.asp'),
      expect.objectContaining({ redirect: 'follow', signal: expect.any(AbortSignal) }),
    );
  });

  it('throws on a non-2xx instead of parsing the error page as data', async () => {
    // This is the assertion that must not be relaxed. Five call sites reach for
    // `fetch` directly and skip this check, and they report success on a 500
    // (defect A-9). Weakening `fetchAspPage` to "harmonise" with them would
    // remove the only place the status is read.
    fetchMock.mockResolvedValue({ ok: false, status: 500, statusText: 'Internal Server Error', text: async () => 'boom' });
    const session = newSession();
    session.setCurrentWorldInfo(WORLD);
    session.setDaAddr('1.2.3.4');
    session.setDaPort(7001);

    await expect(session.fetchAspPage('NewTycoon/TycoonBankAccount.asp'))
      .rejects.toThrow('ASP request failed: 500 Internal Server Error');
  });

  it('passes the caller extra parameters through to the query string', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, statusText: 'OK', text: async () => '' });
    const session = newSession();
    session.setCurrentWorldInfo(WORLD);
    session.setDaAddr('1.2.3.4');
    session.setDaPort(7001);

    await session.fetchAspPage('NewTycoon/TycoonReport.asp', { Selection: 'Curriculum' });

    expect(String(fetchMock.mock.calls[0][0])).toContain('Selection=Curriculum');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// State accessors
// ═══════════════════════════════════════════════════════════════════════════

describe('session state accessors', () => {
  it('round-trips every world identity the login sequence collects', () => {
    const session = newSession();

    session.setWorldContextId('8161308');
    session.setInterfaceServerId('6892548');
    session.setTycoonId('4666201923');
    session.setRdoCnntId('40530807');
    session.setCacherId('40133496');
    session.setWorldId('30430748');
    session.setDaAddr('1.2.3.4');
    session.setDaPort(7001);
    session.setMailAccount('SPO_test3@planitia.net');
    session.setMailAddr('1.2.3.5');
    session.setMailPort(1234);
    session.setWorldXSize(1000);
    session.setWorldYSize(1200);
    session.setWorldSeason(3);
    session.setCurrentWorldInfo(WORLD);
    session.setCachedUsername('SPO_test3');
    session.setCachedPassword('test3');
    session.setActiveUsername('Mayor of Kalisz');
    session.setCurrentCompany(COMPANY);

    expect(session.worldContextId).toBe('8161308');
    expect(session.interfaceServerId).toBe('6892548');
    expect(session.tycoonId).toBe('4666201923');
    // rdoCnntId and cachedPassword are read-only getters over private fields.
    expect(session.rdoCnntId).toBe('40530807');
    expect(session.cachedPassword).toBe('test3');
    expect(session.cacherId).toBe('40133496');
    expect(session.worldId).toBe('30430748');
    expect(session.getDAAddr()).toBe('1.2.3.4');
    expect(session.getDAPort()).toBe(7001);
    expect(session.mailAccount).toBe('SPO_test3@planitia.net');
    expect(session.getWorldXSize()).toBe(1000);
    expect(session.getWorldYSize()).toBe(1200);
    expect(session.getWorldSeason()).toBe(3);
    expect(session.currentWorldInfo).toBe(WORLD);
    expect(session.activeUsername).toBe('Mayor of Kalisz');
    expect(session.currentCompany).toBe(COMPANY);
  });

  it('clears an identity without tagging the log with a null', () => {
    const session = newSession();
    session.setTycoonId('4666201923');
    session.setCachedUsername('SPO_test3');

    // switchCompany() nulls both before re-logging in; the logger must not then
    // carry `tycoonId=null` into the next session's lines.
    session.setTycoonId(null);
    session.setCachedUsername(null);

    expect(session.tycoonId).toBeNull();
    expect(session.cachedUsername).toBeNull();
  });

  it('reports no DA port until the world announces one', () => {
    const session = newSession();

    expect(session.getDAAddr()).toBeNull();
    expect(session.getDAPort()).toBeNull();
  });

  it('moves through the session phases the gateway watches', () => {
    const session = newSession();

    expect(session.getPhase()).toBe(SessionPhase.DISCONNECTED);
    expect(session.isWorldConnected()).toBe(false);

    session.setPhase(SessionPhase.WORLD_CONNECTING);
    expect(session.isWorldConnected()).toBe(true);

    session.setPhase(SessionPhase.WORLD_CONNECTED);
    expect(session.getPhase()).toBe(SessionPhase.WORLD_CONNECTED);
    expect(session.isWorldConnected()).toBe(true);

    session.setPhase(SessionPhase.RECONNECTING);
    expect(session.isWorldConnected()).toBe(false);
  });

  it('keeps the world list addressable by name', () => {
    const session = newSession();
    const worlds = new Map<string, WorldInfo>([['planitia', WORLD]]);

    session.setAvailableWorlds(worlds);

    expect(session.getAvailableWorlds()).toBe(worlds);
    expect(session.getWorldInfo('planitia')).toBe(WORLD);
    expect(session.getWorldInfo('shamba')).toBeUndefined();
  });

  it('adds a company once, so a re-injection after a switch cannot duplicate it', () => {
    const session = newSession();
    session.setAvailableCompanies([COMPANY]);

    session.pushAvailableCompany({ id: '55', name: 'Renamed', ownerRole: 'SPO_test3' });
    session.pushAvailableCompany({ id: '56', name: 'Mayor of Kalisz' });

    expect(session.getAvailableCompanies().map(c => c.id)).toEqual(['55', '56']);
    expect(session.getAvailableCompanies()[0].name).toBe('SPO_test3 - Green');
  });

  it('remembers the capitol coordinates the directory page announced', () => {
    const session = newSession();

    expect(session.getCapitolCoords()).toBeNull();
    session.setCapitolCoords({ x: 512, y: 512 });
    expect(session.getCapitolCoords()).toEqual({ x: 512, y: 512 });
    session.setCapitolCoords(null);
    expect(session.getCapitolCoords()).toBeNull();
  });

  it('stamps the correlation id on the session log', () => {
    const session = newSession();
    const setField = jest.spyOn(session.log, 'setField');

    session.setCorrelationId('req-42');

    expect(setField).toHaveBeenCalledWith('corrId', 'req-42');
  });

  it('keeps the last known camera position, and forwards it to the server on demand', () => {
    const session = newSession();

    expect(session.getPlayerPosition()).toEqual({ x: 0, y: 0 });
    session.setLastPlayerX(706);
    session.setLastPlayerY(436);
    expect(session.getPlayerPosition()).toEqual({ x: 706, y: 436 });

    // Without viewport bounds the camera move is local only.
    session.updateCameraPosition(700, 430);
    expect(session.getPlayerPosition()).toEqual({ x: 700, y: 430 });
  });

  it('caches ASP action URLs per page and forgets them all at once', () => {
    const session = newSession();
    const actions = new Map<string, AspActionUrl>([
      ['borrow', { key: 'TycoonBankAccount.asp', url: 'http://1.2.3.4/borrow.asp', method: 'GET' }],
    ]);

    expect(session.getAspActionCache('TycoonBankAccount.asp')).toBeUndefined();
    session.setAspActionCache('TycoonBankAccount.asp', actions);
    expect(session.getAspActionCache('TycoonBankAccount.asp')).toBe(actions);

    session.clearAspActionCache();
    expect(session.getAspActionCache('TycoonBankAccount.asp')).toBeUndefined();
  });

  it('clears every field of the building focus together', () => {
    const session = newSession();
    session.currentFocusedBuildingId = '202334236';
    session.currentFocusedCoords = { x: 706, y: 436 };
    session.currentFocusedBuildingName = 'Car Factory';
    session.currentFocusedOwnerName = 'SPO_test3';

    session.clearBuildingFocus();

    expect(session.currentFocusedBuildingId).toBeNull();
    expect(session.currentFocusedCoords).toBeNull();
    expect(session.currentFocusedBuildingName).toBeNull();
    expect(session.currentFocusedOwnerName).toBeNull();
  });

  it('replaces the chat user list wholesale', () => {
    const session = newSession();
    const users = new Map<string, ChatUser>([['SPO_test3', { name: 'SPO_test3' } as ChatUser]]);

    session.setChatUsers(users);

    // The only observable is that the handler receives it back.
    const spy = jest.spyOn(chatHandler, 'getChatUserList');
    spy.mockImplementation(async ctx =>
      Array.from((ctx as unknown as { chatUsers: Map<string, ChatUser> }).chatUsers.values()));
    return expect(session.getChatUserList()).resolves.toEqual([{ name: 'SPO_test3' }]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PushContext surface
// ═══════════════════════════════════════════════════════════════════════════

describe('PushContext surface', () => {
  it('round-trips the InitClient handshake state the login sequence installs', () => {
    const session = newSession();
    const resolver = (): void => undefined;
    const received = Promise.resolve();

    expect(session.getWaitingForInitClient()).toBe(false);
    expect(session.getInitClientResolver()).toBeNull();
    expect(session.getInitClientReceived()).toBeNull();

    session.setWaitingForInitClient(true);
    session.setInitClientResolver(resolver);
    session.setInitClientReceived(received);

    expect(session.getWaitingForInitClient()).toBe(true);
    expect(session.getInitClientResolver()).toBe(resolver);
    expect(session.getInitClientReceived()).toBe(received);
  });

  it('round-trips the values the InitClient push carries', () => {
    const session = newSession();

    expect(session.getVirtualDate()).toBeNull();
    expect(session.getAccountMoney()).toBeNull();
    expect(session.getFailureLevel()).toBeNull();
    expect(session.getFTycoonProxyId()).toBeNull();

    session.setVirtualDate(78006);
    session.setAccountMoney('419278163478');
    session.setFailureLevel(0);
    session.setFTycoonProxyId(223892356);

    expect(session.getVirtualDate()).toBe(78006);
    expect(session.getAccountMoney()).toBe('419278163478');
    expect(session.getFailureLevel()).toBe(0);
    expect(session.getFTycoonProxyId()).toBe(223892356);
  });

  it('round-trips the RefreshTycoon counters', () => {
    const session = newSession();

    expect(session.getLastRanking()).toBe(0);
    expect(session.getLastBuildingCount()).toBe(0);
    expect(session.getLastMaxBuildings()).toBe(0);

    session.setLastRanking(12);
    session.setLastBuildingCount(34);
    session.setLastMaxBuildings(56);

    expect(session.getLastRanking()).toBe(12);
    expect(session.getLastBuildingCount()).toBe(34);
    expect(session.getLastMaxBuildings()).toBe(56);
  });

  it('registers a virtual object the server can resolve back to us', () => {
    const session = newSession();

    session.setKnownObject('InterfaceEvents', '38123456');

    // The only observable is the answer to a server-side `idof` — asserted in
    // the lifecycle suite. Here the write must simply not throw or overwrite.
    session.setKnownObject('WSObjectCacher', '40133496');
    expect(() => session.setKnownObject('InterfaceEvents', '38123457')).not.toThrow();
  });
});

describe('setServerBusyFromPush', () => {
  it('reports the transition into busy exactly once', () => {
    const session = newSession();
    const debug = jest.spyOn(session.log, 'debug');

    session.setServerBusyFromPush(true);
    session.setServerBusyFromPush(true);

    expect(session.getQueueStatus().serverBusy).toBe(true);
    const busyLines = debug.mock.calls.filter(c => String(c[0]).includes('now busy (from push)'));
    expect(busyLines).toHaveLength(1);
  });

  it('reports the transition back to available exactly once', () => {
    const session = newSession();
    session.setServerBusyFromPush(true);
    const debug = jest.spyOn(session.log, 'debug');

    session.setServerBusyFromPush(false);
    session.setServerBusyFromPush(false);

    expect(session.getQueueStatus().serverBusy).toBe(false);
    const freeLines = debug.mock.calls.filter(c => String(c[0]).includes('now available (from push)'));
    expect(freeLines).toHaveLength(1);
  });

  it('says nothing when the state does not change', () => {
    const session = newSession();
    const debug = jest.spyOn(session.log, 'debug');

    session.setServerBusyFromPush(false);

    expect(debug.mock.calls.filter(c => String(c[0]).includes('[ServerBusy]'))).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Push classification and parsing
// ═══════════════════════════════════════════════════════════════════════════

describe('push classification', () => {
  const push = (member: string, args: string[] = [], separator = '"*"'): RdoPacket => ({
    raw: '', type: 'PUSH', member, args, separator,
  });

  it('recognises RefreshArea and RefreshObject only as void pushes', () => {
    const session = newSession();

    expect(session.isRefreshAreaPush(push('RefreshArea'))).toBe(true);
    expect(session.isRefreshObjectPush(push('RefreshObject'))).toBe(true);
    // A "^" frame is a call awaiting a result — never a push.
    expect(session.isRefreshAreaPush(push('RefreshArea', [], '"^"'))).toBe(false);
    expect(session.isRefreshObjectPush(push('RefreshObject', [], '"^"'))).toBe(false);
    expect(session.isRefreshAreaPush(push('RefreshObject'))).toBe(false);
    expect(session.isRefreshObjectPush(push('RefreshArea'))).toBe(false);
    expect(session.isRefreshAreaPush({ raw: '', type: 'RESPONSE', member: 'RefreshArea', separator: '"*"' })).toBe(false);
  });

  it('parses the rectangle a RefreshArea announces', () => {
    const session = newSession();

    expect(session.parseRefreshAreaPush(push('RefreshArea', ['"#700"', '"#430"', '"#64"', '"#64"', '"%data"'])))
      .toEqual({ x: 700, y: 430, width: 64, height: 64 });
  });

  it('refuses a RefreshArea that is missing coordinates', () => {
    const session = newSession();

    expect(session.parseRefreshAreaPush(push('RefreshArea', ['"#700"', '"#430"']))).toBeNull();
    expect(session.parseRefreshAreaPush(push('RefreshArea'))).toBeNull();
    // A push with no argument list at all — counted as zero, not as a crash.
    expect(session.parseRefreshAreaPush({ raw: '', type: 'PUSH', member: 'RefreshArea', separator: '"*"' }))
      .toBeNull();
  });

  it('refuses a RefreshArea whose coordinates are not numbers', () => {
    const session = newSession();

    expect(session.parseRefreshAreaPush(push('RefreshArea', ['"%x"', '"%y"', '"%w"', '"%h"']))).toBeNull();
  });

  it('reports a RefreshArea it could not read at all instead of throwing', () => {
    const session = newSession();
    jest.spyOn(RdoParser, 'asInt').mockImplementation(() => { throw new Error('bad token'); });

    expect(session.parseRefreshAreaPush(push('RefreshArea', ['"#1"', '"#2"', '"#3"', '"#4"']))).toBeNull();

    jest.restoreAllMocks();
  });

  it('parses the building id and the kind of change a RefreshObject carries', () => {
    const session = newSession();

    expect(session.parseRefreshObjectPush(push('RefreshObject', ['"#202334236"', '"#1"'])))
      .toEqual({ buildingId: '202334236', kindOfChange: 1, buildingInfo: null });
  });

  it('refuses a RefreshObject that carries fewer than two arguments', () => {
    const session = newSession();

    expect(session.parseRefreshObjectPush(push('RefreshObject', ['"#202334236"']))).toBeNull();
    expect(session.parseRefreshObjectPush(push('RefreshObject'))).toBeNull();
  });

  it('parses the ExtraInfo block only while a building is focused', () => {
    const session = newSession();
    const packet = push('RefreshObject', ['"#202334236"', '"#0"', '"%Car Factory\nSPO_test3"']);

    // No focus → no coordinates to attach the detail to.
    expect(session.parseRefreshObjectPush(packet)?.buildingInfo).toBeNull();

    session.currentFocusedCoords = { x: 706, y: 436 };
    const parsed = session.parseRefreshObjectPush(packet);
    expect(parsed?.buildingInfo).toMatchObject({ x: 706, y: 436 });
  });

  it('strips the OLEString prefix the payload cleaner left behind', () => {
    const session = newSession();
    session.currentFocusedCoords = { x: 706, y: 436 };

    // The cleaner removes ONE type prefix; a doubled one is a real wire shape
    // (a widestring whose content itself begins with "%").
    const parsed = session.parseRefreshObjectPush(
      push('RefreshObject', ['"#202334236"', '"#0"', '"%%Car Factory"']));

    expect(parsed?.buildingInfo).toMatchObject({ buildingName: 'Car Factory' });
  });

  it('keeps the id and the change when the ExtraInfo block cannot be parsed', () => {
    const session = newSession();
    session.currentFocusedCoords = { x: 706, y: 436 };
    const debug = jest.spyOn(session.log, 'debug');

    // Neither the id nor the detail survives the parse — the push still yields
    // the change so the client can re-read the building itself.
    const parsed = session.parseRefreshObjectPush(push('RefreshObject', ['"%"', '"#2"', '"%"']));

    expect(parsed).toMatchObject({ buildingId: '', kindOfChange: 2, buildingInfo: null });
    expect(debug).toHaveBeenCalledWith(expect.stringContaining('Could not parse RefreshObject ExtraInfo'));
  });

  it('reports a RefreshObject it could not read at all instead of throwing', () => {
    const session = newSession();
    jest.spyOn(RdoParser, 'getValue').mockImplementation(() => { throw new Error('bad token'); });

    expect(session.parseRefreshObjectPush(push('RefreshObject', ['"#1"', '"#0"']))).toBeNull();

    jest.restoreAllMocks();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Socket registry
// ═══════════════════════════════════════════════════════════════════════════

describe('socket registry', () => {
  it('exposes each connected socket by name and forgets it on request', async () => {
    const session = newSession();

    await session.createSocket('world', '1.2.3.4', 8000);
    await session.createSocket('map', '1.2.3.4', 7000);

    expect(session.getSocketNames()).toEqual(['world', 'map']);
    expect(session.getSocket('world')).toBeDefined();
    expect(session.getSocket('mail')).toBeUndefined();

    session.deleteSocket('map');
    expect(session.getSocketNames()).toEqual(['world']);

    session.destroy();
  });

  it('destroys and unhooks a named socket, and ignores a name it does not know', async () => {
    const session = newSession();
    await session.createSocket('world', '1.2.3.4', 8000);
    const socket = session.getSocket('world') as unknown as FakeSocket;
    const removeAll = jest.spyOn(socket, 'removeAllListeners');

    session.removeAllSocketListeners('world');
    session.destroySocket('world');
    session.deleteFramer('world');

    expect(removeAll).toHaveBeenCalledTimes(1);
    expect(socket.destroyed).toBe(true);

    // Unknown names are a no-op, not a crash: switchCompany sweeps a list that
    // may already have been drained by a socket close.
    expect(() => {
      session.removeAllSocketListeners('nothing');
      session.destroySocket('nothing');
      session.deleteFramer('nothing');
    }).not.toThrow();

    session.destroy();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// Queue status and maintenance mode
// ═══════════════════════════════════════════════════════════════════════════

describe('getQueueStatus', () => {
  it('reports an idle session with the real buffer and pool limits', () => {
    const session = newSession();

    const status = session.getQueueStatus();

    expect(status).toMatchObject({
      buffered: 0,
      maxBuffer: 20,
      serverBusy: false,
      pendingMaps: 0,
      activeMapRequests: 0,
      pendingRdoRequests: 0,
      timedOutAwaitingLate: 0,
      consecutivePollFailures: 0,
      maintenanceMode: false,
      worldPoolSize: 0,
      worldPoolMax: 6,
    });
    expect(status.rdoMetrics.totalSent).toBe(0);
  });

  it('hands back a copy of the metrics, not the live counter block', () => {
    const session = newSession();

    const first = session.getQueueStatus().rdoMetrics;
    first.totalSent = 999;

    expect(session.getQueueStatus().rdoMetrics.totalSent).toBe(0);
  });
});
