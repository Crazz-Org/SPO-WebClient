/**
 * Message Types - WebSocket Protocol Messages
 * Contains all request/response types for Gateway <-> Browser communication
 */

import type { RoadTileFacts } from '../road-cost';
import type {
  WorldInfo,
  CompanyInfo,
  MapData,
  ChatUser,
  BuildingFocusInfo,
  BuildingCategory,
  BuildingInfo,
  SurfaceData,
  FacilityDimensions,
  BuildingDetailsResponse,
  BuildingSupplyData,
  BuildingProductData,
  BuildingPropertyValue,
  CompInputData,
  WarehouseWareData,
  SearchMenuCategory,
  TownInfo,
  NewspaperListing,
  TycoonProfile,
  TycoonProfileFull,
  RankingCategory,
  RankingEntry,
  SurfaceType,
  MailFolder,
  MailMessageHeader,
  MailMessageFull,
  CurriculumData,
  BankAccountData,
  BankActionType,
  BankActionResult,
  ProfitLossData,
  CompaniesData,
  AutoConnectionsData,
  AutoConnectionActionType,
  CurriculumActionType,
  PolicyData,
  PoliticsData,
  NewspaperBoard,
  NewspaperIssue,
  NewspaperIssueList,
  PoliticalRoleInfo,
  ClusterInfo,
  ClusterFacilityPreview,
} from './domain-types';


// =============================================================================
// MESSAGE TYPE ENUM
// =============================================================================

export enum WsMessageType {
  // Client -> Gateway (Requests)
  REQ_AUTH_CHECK = 'REQ_AUTH_CHECK',
  REQ_CONNECT_DIRECTORY = 'REQ_CONNECT_DIRECTORY',
  REQ_LOGIN_WORLD = 'REQ_LOGIN_WORLD',
  REQ_MAP_LOAD = 'REQ_MAP_LOAD',
  REQ_SELECT_COMPANY = 'REQ_SELECT_COMPANY',
  REQ_SWITCH_COMPANY = 'REQ_SWITCH_COMPANY',

  // Gateway -> Client (Responses)
  RESP_AUTH_SUCCESS = 'RESP_AUTH_SUCCESS',
  RESP_CONNECT_SUCCESS = 'RESP_CONNECT_SUCCESS',
  RESP_LOGIN_SUCCESS = 'RESP_LOGIN_SUCCESS',
  RESP_RDO_RESULT = 'RESP_RDO_RESULT',
  RESP_ERROR = 'RESP_ERROR',
  RESP_MAP_DATA = 'RESP_MAP_DATA',

  // Gateway -> Client (Async Events / Pushes)
  EVENT_CHAT_MSG = 'EVENT_CHAT_MSG',
  EVENT_MAP_DATA = 'EVENT_MAP_DATA',
  EVENT_TYCOON_UPDATE = 'EVENT_TYCOON_UPDATE',
  EVENT_RDO_PUSH = 'EVENT_RDO_PUSH',
  EVENT_END_OF_PERIOD = 'EVENT_END_OF_PERIOD',
  EVENT_REFRESH_DATE = 'EVENT_REFRESH_DATE',
  EVENT_TYCOON_RETIRED = 'EVENT_TYCOON_RETIRED',
  EVENT_MODEL_STATUS_CHANGED = 'EVENT_MODEL_STATUS_CHANGED',
  EVENT_REFRESH_SEASON = 'EVENT_REFRESH_SEASON',
  EVENT_MOVE_TO = 'EVENT_MOVE_TO',
  EVENT_CHANNEL_LIST_CHANGE = 'EVENT_CHANNEL_LIST_CHANGE',

  // Chat functionality
  REQ_CHAT_GET_USERS = 'REQ_CHAT_GET_USERS',
  REQ_CHAT_GET_CHANNELS = 'REQ_CHAT_GET_CHANNELS',
  REQ_CHAT_GET_CHANNEL_INFO = 'REQ_CHAT_GET_CHANNEL_INFO',
  REQ_CHAT_JOIN_CHANNEL = 'REQ_CHAT_JOIN_CHANNEL',
  REQ_CHAT_SEND_MESSAGE = 'REQ_CHAT_SEND_MESSAGE',
  REQ_CHAT_TYPING_STATUS = 'REQ_CHAT_TYPING_STATUS',

  RESP_CHAT_USER_LIST = 'RESP_CHAT_USER_LIST',
  RESP_CHAT_CHANNEL_LIST = 'RESP_CHAT_CHANNEL_LIST',
  RESP_CHAT_CHANNEL_INFO = 'RESP_CHAT_CHANNEL_INFO',
  RESP_CHAT_SUCCESS = 'RESP_CHAT_SUCCESS',

  EVENT_CHAT_USER_TYPING = 'EVENT_CHAT_USER_TYPING',
  EVENT_CHAT_CHANNEL_CHANGE = 'EVENT_CHAT_CHANNEL_CHANGE',
  EVENT_CHAT_USER_LIST_CHANGE = 'EVENT_CHAT_USER_LIST_CHANGE',

  // GM Chat (gateway-level broadcast)
  REQ_GM_CHAT_SEND = 'REQ_GM_CHAT_SEND',

  REQ_BUILDING_FOCUS = 'REQ_BUILDING_FOCUS',
  REQ_BUILDING_UNFOCUS = 'REQ_BUILDING_UNFOCUS',
  RESP_BUILDING_FOCUS = 'RESP_BUILDING_FOCUS',
  EVENT_BUILDING_REFRESH = 'EVENT_BUILDING_REFRESH',
  EVENT_AREA_REFRESH = 'EVENT_AREA_REFRESH',
  EVENT_SHOW_NOTIFICATION = 'EVENT_SHOW_NOTIFICATION',
  EVENT_CACHE_REFRESH = 'EVENT_CACHE_REFRESH',

  // World socket reconnection events
  EVENT_WORLD_RECONNECTED = 'EVENT_WORLD_RECONNECTED',
  EVENT_WORLD_DISCONNECTED = 'EVENT_WORLD_DISCONNECTED',

  // Server maintenance (mirrors Delphi fMaintDue + fMSDownCount pattern)
  EVENT_MAINTENANCE = 'EVENT_MAINTENANCE',

  // Building Construction
  REQ_GET_BUILDING_CATEGORIES = 'REQ_GET_BUILDING_CATEGORIES',
  REQ_GET_BUILDING_FACILITIES = 'REQ_GET_BUILDING_FACILITIES',
  REQ_PLACE_BUILDING = 'REQ_PLACE_BUILDING',
  REQ_GET_SURFACE = 'REQ_GET_SURFACE',
  REQ_GET_ALL_FACILITY_DIMENSIONS = 'REQ_GET_ALL_FACILITY_DIMENSIONS',

  RESP_BUILDING_CATEGORIES = 'RESP_BUILDING_CATEGORIES',
  RESP_BUILDING_FACILITIES = 'RESP_BUILDING_FACILITIES',
  RESP_BUILDING_PLACED = 'RESP_BUILDING_PLACED',
  RESP_SURFACE_DATA = 'RESP_SURFACE_DATA',
  RESP_ALL_FACILITY_DIMENSIONS = 'RESP_ALL_FACILITY_DIMENSIONS',

  // Building Details
  REQ_BUILDING_DETAILS = 'REQ_BUILDING_DETAILS',
  RESP_BUILDING_DETAILS = 'RESP_BUILDING_DETAILS',
  REQ_BUILDING_TAB_DATA = 'REQ_BUILDING_TAB_DATA',
  RESP_BUILDING_TAB_DATA = 'RESP_BUILDING_TAB_DATA',
  REQ_BUILDING_GATE_CONNECTIONS = 'REQ_BUILDING_GATE_CONNECTIONS',
  RESP_BUILDING_GATE_CONNECTIONS = 'RESP_BUILDING_GATE_CONNECTIONS',
  REQ_BUILDING_REFRESH_PROPERTIES = 'REQ_BUILDING_REFRESH_PROPERTIES',
  RESP_BUILDING_REFRESH_PROPERTIES = 'RESP_BUILDING_REFRESH_PROPERTIES',
  REQ_BUILDING_SET_PROPERTY = 'REQ_BUILDING_SET_PROPERTY',
  RESP_BUILDING_SET_PROPERTY = 'RESP_BUILDING_SET_PROPERTY',


  // Building Upgrades
  REQ_BUILDING_UPGRADE = 'REQ_BUILDING_UPGRADE',
  RESP_BUILDING_UPGRADE = 'RESP_BUILDING_UPGRADE',

  // Building Rename
  REQ_RENAME_FACILITY = 'REQ_RENAME_FACILITY',
  RESP_RENAME_FACILITY = 'RESP_RENAME_FACILITY',

  // Building Deletion
  REQ_DELETE_FACILITY = 'REQ_DELETE_FACILITY',
  RESP_DELETE_FACILITY = 'RESP_DELETE_FACILITY',

  // Building Connection (map-click connect two facilities)
  REQ_CONNECT_FACILITIES = 'REQ_CONNECT_FACILITIES',
  RESP_CONNECT_FACILITIES = 'RESP_CONNECT_FACILITIES',

  // Clone Facility (propagate settings to same-type buildings)
  REQ_CLONE_FACILITY = 'REQ_CLONE_FACILITY',
  RESP_CLONE_FACILITY = 'RESP_CLONE_FACILITY',

  // Road Building
  REQ_BUILD_ROAD = 'REQ_BUILD_ROAD',
  RESP_BUILD_ROAD = 'RESP_BUILD_ROAD',
  REQ_GET_ROAD_COST = 'REQ_GET_ROAD_COST',
  RESP_GET_ROAD_COST = 'RESP_GET_ROAD_COST',
  REQ_DEMOLISH_ROAD = 'REQ_DEMOLISH_ROAD',
  RESP_DEMOLISH_ROAD = 'RESP_DEMOLISH_ROAD',
  REQ_DEMOLISH_ROAD_AREA = 'REQ_DEMOLISH_ROAD_AREA',
  RESP_DEMOLISH_ROAD_AREA = 'RESP_DEMOLISH_ROAD_AREA',

  // Search Menu / Directory
  REQ_SEARCH_MENU_HOME = 'REQ_SEARCH_MENU_HOME',
  REQ_SEARCH_MENU_TOWNS = 'REQ_SEARCH_MENU_TOWNS',
  REQ_SEARCH_MENU_TYCOON_PROFILE = 'REQ_SEARCH_MENU_TYCOON_PROFILE',
  REQ_SEARCH_MENU_PEOPLE_SEARCH = 'REQ_SEARCH_MENU_PEOPLE_SEARCH',
  REQ_SEARCH_MENU_RANKINGS = 'REQ_SEARCH_MENU_RANKINGS',
  REQ_SEARCH_MENU_RANKING_DETAIL = 'REQ_SEARCH_MENU_RANKING_DETAIL',
  REQ_SEARCH_MENU_BANKS = 'REQ_SEARCH_MENU_BANKS',
  REQ_SEARCH_MENU_NEWSPAPERS = 'REQ_SEARCH_MENU_NEWSPAPERS',

  RESP_SEARCH_MENU_HOME = 'RESP_SEARCH_MENU_HOME',
  RESP_SEARCH_MENU_TOWNS = 'RESP_SEARCH_MENU_TOWNS',
  RESP_SEARCH_MENU_TYCOON_PROFILE = 'RESP_SEARCH_MENU_TYCOON_PROFILE',
  RESP_SEARCH_MENU_PEOPLE_SEARCH = 'RESP_SEARCH_MENU_PEOPLE_SEARCH',
  RESP_SEARCH_MENU_RANKINGS = 'RESP_SEARCH_MENU_RANKINGS',
  RESP_SEARCH_MENU_RANKING_DETAIL = 'RESP_SEARCH_MENU_RANKING_DETAIL',
  RESP_SEARCH_MENU_BANKS = 'RESP_SEARCH_MENU_BANKS',
  RESP_SEARCH_MENU_NEWSPAPERS = 'RESP_SEARCH_MENU_NEWSPAPERS',

  // Logout
  REQ_LOGOUT = 'REQ_LOGOUT',
  RESP_LOGOUT = 'RESP_LOGOUT',

  // Mail
  REQ_MAIL_CONNECT = 'REQ_MAIL_CONNECT',
  REQ_MAIL_GET_FOLDER = 'REQ_MAIL_GET_FOLDER',
  REQ_MAIL_READ_MESSAGE = 'REQ_MAIL_READ_MESSAGE',
  REQ_MAIL_COMPOSE = 'REQ_MAIL_COMPOSE',
  REQ_MAIL_DELETE = 'REQ_MAIL_DELETE',
  REQ_MAIL_GET_UNREAD_COUNT = 'REQ_MAIL_GET_UNREAD_COUNT',
  REQ_MAIL_SAVE_DRAFT = 'REQ_MAIL_SAVE_DRAFT',

  RESP_MAIL_CONNECTED = 'RESP_MAIL_CONNECTED',
  RESP_MAIL_FOLDER = 'RESP_MAIL_FOLDER',
  RESP_MAIL_MESSAGE = 'RESP_MAIL_MESSAGE',
  RESP_MAIL_SENT = 'RESP_MAIL_SENT',
  RESP_MAIL_DELETED = 'RESP_MAIL_DELETED',
  RESP_MAIL_UNREAD_COUNT = 'RESP_MAIL_UNREAD_COUNT',
  RESP_MAIL_DRAFT_SAVED = 'RESP_MAIL_DRAFT_SAVED',

  EVENT_NEW_MAIL = 'EVENT_NEW_MAIL',

  // Profile
  REQ_GET_PROFILE = 'REQ_GET_PROFILE',
  RESP_GET_PROFILE = 'RESP_GET_PROFILE',

  // Profile Tabs
  REQ_PROFILE_CURRICULUM = 'REQ_PROFILE_CURRICULUM',
  RESP_PROFILE_CURRICULUM = 'RESP_PROFILE_CURRICULUM',
  REQ_PROFILE_BANK = 'REQ_PROFILE_BANK',
  RESP_PROFILE_BANK = 'RESP_PROFILE_BANK',
  REQ_PROFILE_BANK_ACTION = 'REQ_PROFILE_BANK_ACTION',
  RESP_PROFILE_BANK_ACTION = 'RESP_PROFILE_BANK_ACTION',
  REQ_PROFILE_PROFITLOSS = 'REQ_PROFILE_PROFITLOSS',
  RESP_PROFILE_PROFITLOSS = 'RESP_PROFILE_PROFITLOSS',
  REQ_PROFILE_COMPANIES = 'REQ_PROFILE_COMPANIES',
  RESP_PROFILE_COMPANIES = 'RESP_PROFILE_COMPANIES',
  REQ_PROFILE_COMPANY_PROFITLOSS = 'REQ_PROFILE_COMPANY_PROFITLOSS',
  RESP_PROFILE_COMPANY_PROFITLOSS = 'RESP_PROFILE_COMPANY_PROFITLOSS',
  REQ_PROFILE_AUTOCONNECTIONS = 'REQ_PROFILE_AUTOCONNECTIONS',
  RESP_PROFILE_AUTOCONNECTIONS = 'RESP_PROFILE_AUTOCONNECTIONS',
  REQ_PROFILE_AUTOCONNECTION_ACTION = 'REQ_PROFILE_AUTOCONNECTION_ACTION',
  RESP_PROFILE_AUTOCONNECTION_ACTION = 'RESP_PROFILE_AUTOCONNECTION_ACTION',
  REQ_PROFILE_POLICY = 'REQ_PROFILE_POLICY',
  RESP_PROFILE_POLICY = 'RESP_PROFILE_POLICY',
  REQ_PROFILE_POLICY_SET = 'REQ_PROFILE_POLICY_SET',
  RESP_PROFILE_POLICY_SET = 'RESP_PROFILE_POLICY_SET',
  REQ_PROFILE_CURRICULUM_ACTION = 'REQ_PROFILE_CURRICULUM_ACTION',
  RESP_PROFILE_CURRICULUM_ACTION = 'RESP_PROFILE_CURRICULUM_ACTION',

  // Politics
  REQ_POLITICS_DATA = 'REQ_POLITICS_DATA',
  RESP_POLITICS_DATA = 'RESP_POLITICS_DATA',
  REQ_POLITICS_VOTE = 'REQ_POLITICS_VOTE',
  RESP_POLITICS_VOTE = 'RESP_POLITICS_VOTE',
  REQ_POLITICS_LAUNCH_CAMPAIGN = 'REQ_POLITICS_LAUNCH_CAMPAIGN',
  RESP_POLITICS_LAUNCH_CAMPAIGN = 'RESP_POLITICS_LAUNCH_CAMPAIGN',
  REQ_POLITICS_CANCEL_CAMPAIGN = 'REQ_POLITICS_CANCEL_CAMPAIGN',
  RESP_POLITICS_CANCEL_CAMPAIGN = 'RESP_POLITICS_CANCEL_CAMPAIGN',
  REQ_POLITICS_SET_RATING = 'REQ_POLITICS_SET_RATING',
  RESP_POLITICS_SET_RATING = 'RESP_POLITICS_SET_RATING',
  REQ_POLITICS_SET_PUBLICITY = 'REQ_POLITICS_SET_PUBLICITY',
  RESP_POLITICS_SET_PUBLICITY = 'RESP_POLITICS_SET_PUBLICITY',
  REQ_POLITICS_SET_PROJECT = 'REQ_POLITICS_SET_PROJECT',
  RESP_POLITICS_SET_PROJECT = 'RESP_POLITICS_SET_PROJECT',
  REQ_TYCOON_ROLE = 'REQ_TYCOON_ROLE',
  RESP_TYCOON_ROLE = 'RESP_TYCOON_ROLE',

  // Newspaper (the town paper's editorial board)
  REQ_NEWSPAPER_BOARD = 'REQ_NEWSPAPER_BOARD',
  RESP_NEWSPAPER_BOARD = 'RESP_NEWSPAPER_BOARD',
  REQ_NEWSPAPER_POST = 'REQ_NEWSPAPER_POST',
  RESP_NEWSPAPER_POST = 'RESP_NEWSPAPER_POST',
  REQ_NEWSPAPER_ISSUES = 'REQ_NEWSPAPER_ISSUES',
  RESP_NEWSPAPER_ISSUES = 'RESP_NEWSPAPER_ISSUES',
  REQ_NEWSPAPER_ISSUE = 'REQ_NEWSPAPER_ISSUE',
  RESP_NEWSPAPER_ISSUE = 'RESP_NEWSPAPER_ISSUE',

  // Connection Search
  REQ_SEARCH_CONNECTIONS = 'REQ_SEARCH_CONNECTIONS',
  RESP_SEARCH_CONNECTIONS = 'RESP_SEARCH_CONNECTIONS',

  // Company Creation
  REQ_CREATE_COMPANY = 'REQ_CREATE_COMPANY',
  RESP_CREATE_COMPANY = 'RESP_CREATE_COMPANY',

  // Cluster Browsing (company creation)
  REQ_CLUSTER_INFO = 'REQ_CLUSTER_INFO',
  RESP_CLUSTER_INFO = 'RESP_CLUSTER_INFO',
  REQ_CLUSTER_FACILITIES = 'REQ_CLUSTER_FACILITIES',
  RESP_CLUSTER_FACILITIES = 'RESP_CLUSTER_FACILITIES',

  // Empire (Owned Facilities via Favorites)
  REQ_EMPIRE_FACILITIES = 'REQ_EMPIRE_FACILITIES',
  RESP_EMPIRE_FACILITIES = 'RESP_EMPIRE_FACILITIES',
  REQ_FAVORITE_ADD = 'REQ_FAVORITE_ADD',
  RESP_FAVORITE_ADD = 'RESP_FAVORITE_ADD',
  REQ_FAVORITE_DELETE = 'REQ_FAVORITE_DELETE',
  RESP_FAVORITE_DELETE = 'RESP_FAVORITE_DELETE',
  REQ_FAVORITE_RENAME = 'REQ_FAVORITE_RENAME',
  RESP_FAVORITE_RENAME = 'RESP_FAVORITE_RENAME',
  REQ_FAVORITE_FOLDER_CREATE = 'REQ_FAVORITE_FOLDER_CREATE',
  RESP_FAVORITE_FOLDER_CREATE = 'RESP_FAVORITE_FOLDER_CREATE',
  REQ_FAVORITE_MOVE = 'REQ_FAVORITE_MOVE',
  RESP_FAVORITE_MOVE = 'RESP_FAVORITE_MOVE',

  // Research / Inventions
  REQ_RESEARCH_INVENTORY = 'REQ_RESEARCH_INVENTORY',
  RESP_RESEARCH_INVENTORY = 'RESP_RESEARCH_INVENTORY',
  REQ_RESEARCH_DETAILS = 'REQ_RESEARCH_DETAILS',
  RESP_RESEARCH_DETAILS = 'RESP_RESEARCH_DETAILS',

  // Zone Painting
  REQ_DEFINE_ZONE = 'REQ_DEFINE_ZONE',
  RESP_DEFINE_ZONE = 'RESP_DEFINE_ZONE',

  // Camera Position
  REQ_UPDATE_CAMERA = 'REQ_UPDATE_CAMERA',

  // Capitol
  REQ_BUILD_CAPITOL = 'REQ_BUILD_CAPITOL',
  RESP_CAPITOL_PLACED = 'RESP_CAPITOL_PLACED',
  RESP_CAPITOL_COORDS = 'RESP_CAPITOL_COORDS',
}

// =============================================================================
// BASE MESSAGE INTERFACE
// =============================================================================

export interface WsMessage {
  type: WsMessageType;
  wsRequestId?: string;
}

// =============================================================================
// REQUEST PAYLOADS
// =============================================================================

export interface WsReqAuthCheck extends WsMessage {
  type: WsMessageType.REQ_AUTH_CHECK;
  username: string;
  password: string;
}

export interface WsReqConnectDirectory extends WsMessage {
  type: WsMessageType.REQ_CONNECT_DIRECTORY;
  username: string;
  password: string;
  zonePath?: string;
}

export interface WsReqLoginWorld extends WsMessage {
  type: WsMessageType.REQ_LOGIN_WORLD;
  username: string;
  password: string;
  worldName: string;
}

export interface WsReqMapLoad extends WsMessage {
  type: WsMessageType.REQ_MAP_LOAD;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WsReqSelectCompany extends WsMessage {
  type: WsMessageType.REQ_SELECT_COMPANY;
  companyId: string;
}

export interface WsReqSwitchCompany extends WsMessage {
  type: WsMessageType.REQ_SWITCH_COMPANY;
  company: CompanyInfo;
}

// =============================================================================
// RESPONSE PAYLOADS
// =============================================================================

export interface WsRespError extends WsMessage {
  type: WsMessageType.RESP_ERROR;
  errorMessage: string;
  code: number;
}

export interface WsRespAuthSuccess extends WsMessage {
  type: WsMessageType.RESP_AUTH_SUCCESS;
}

export interface WsRespConnectSuccess extends WsMessage {
  type: WsMessageType.RESP_CONNECT_SUCCESS;
  worlds: WorldInfo[];
}

export interface WsRespLoginSuccess extends WsMessage {
  type: WsMessageType.RESP_LOGIN_SUCCESS;
  tycoonId: string;
  contextId: string;
  companyCount: number;
  companies?: CompanyInfo[];
  worldXSize?: number;
  worldYSize?: number;
  worldSeason?: number;  // 0=Winter, 1=Spring, 2=Summer, 3=Autumn
}

export interface WsRespRdoResult extends WsMessage {
  type: WsMessageType.RESP_RDO_RESULT;
  result: string | string[];
}

export interface WsRespMapData extends WsMessage {
  type: WsMessageType.RESP_MAP_DATA;
  data: MapData;
}

// =============================================================================
// EVENT PAYLOADS
// =============================================================================

export interface WsEventChatMsg extends WsMessage {
  type: WsMessageType.EVENT_CHAT_MSG;
  channel: string;
  from: string;
  message: string;
  isGM?: boolean;
}

export interface WsEventTycoonUpdate extends WsMessage {
  type: WsMessageType.EVENT_TYCOON_UPDATE;
  cash: string;
  incomePerHour: string;
  ranking: number;
  buildingCount: number;
  maxBuildings: number;
  /** 0 = nominal, 1 = warning (debt), 2 = alert (near bankruptcy) */
  failureLevel?: number;
}

export interface WsEventRdoPush extends WsMessage {
  type: WsMessageType.EVENT_RDO_PUSH;
  rawPacket: string;
}

export interface WsEventEndOfPeriod extends WsMessage {
  type: WsMessageType.EVENT_END_OF_PERIOD;
  /** 0=normal, 1=warning, 2=alert (bankruptcy imminent). Mirrors Delphi FailureLevel. */
  failureLevel: number;
}

/** Tycoon retired/bankrupt — game over for this player. Mirrors Delphi TycoonRetired push. */
export interface WsEventTycoonRetired extends WsMessage {
  type: WsMessageType.EVENT_TYCOON_RETIRED;
  failureLevel: number;
}

/** Server model status changed (busy/available/error). Mirrors Delphi ModelStatusChanged push. */
export interface WsEventModelStatusChanged extends WsMessage {
  type: WsMessageType.EVENT_MODEL_STATUS_CHANGED;
  /** 0=busy (mstBusy), 1=not busy (mstNotBusy), 2=error (mstError) */
  status: number;
}

/** Season changed — affects terrain textures. Mirrors Delphi RefreshSeason push. */
export interface WsEventRefreshSeason extends WsMessage {
  type: WsMessageType.EVENT_REFRESH_SEASON;
  season: number;
}

/** Server requests camera pan to coordinates. Mirrors Delphi MoveTo push. */
export interface WsEventMoveTo extends WsMessage {
  type: WsMessageType.EVENT_MOVE_TO;
  x: number;
  y: number;
}

/** Chat channel created/destroyed. Mirrors Delphi NotifyChannelListChange push. */
export interface WsEventChannelListChange extends WsMessage {
  type: WsMessageType.EVENT_CHANNEL_LIST_CHANGE;
  name: string;
  password: string;
  /** 0=inclusion (channel created), 1=exclusion (channel removed) */
  change: number;
}

export interface WsEventRefreshDate extends WsMessage {
  type: WsMessageType.EVENT_REFRESH_DATE;
  dateDouble: number;
}

// =============================================================================
// CHAT MESSAGES
// =============================================================================

export interface WsReqChatGetUsers extends WsMessage {
  type: WsMessageType.REQ_CHAT_GET_USERS;
}

export interface WsReqChatGetChannels extends WsMessage {
  type: WsMessageType.REQ_CHAT_GET_CHANNELS;
}

/** Requests the human-readable channel description (creator, member roster, password status). */
export interface WsReqChatGetChannelInfo extends WsMessage {
  type: WsMessageType.REQ_CHAT_GET_CHANNEL_INFO;
  channelName: string;
}

export interface WsReqChatJoinChannel extends WsMessage {
  type: WsMessageType.REQ_CHAT_JOIN_CHANNEL;
  channelName: string;
}

export interface WsReqChatSendMessage extends WsMessage {
  type: WsMessageType.REQ_CHAT_SEND_MESSAGE;
  message: string;
}

export interface WsReqChatTypingStatus extends WsMessage {
  type: WsMessageType.REQ_CHAT_TYPING_STATUS;
  isTyping: boolean;
}

export interface WsRespChatUserList extends WsMessage {
  type: WsMessageType.RESP_CHAT_USER_LIST;
  users: ChatUser[];
}

export interface WsRespChatChannelList extends WsMessage {
  type: WsMessageType.RESP_CHAT_CHANNEL_LIST;
  channels: string[];
}

export interface WsRespChatChannelInfo extends WsMessage {
  type: WsMessageType.RESP_CHAT_CHANNEL_INFO;
  info: string;
}

export interface WsRespChatSuccess extends WsMessage {
  type: WsMessageType.RESP_CHAT_SUCCESS;
}

export interface WsEventChatUserTyping extends WsMessage {
  type: WsMessageType.EVENT_CHAT_USER_TYPING;
  username: string;
  isTyping: boolean;
}

export interface WsEventChatChannelChange extends WsMessage {
  type: WsMessageType.EVENT_CHAT_CHANNEL_CHANGE;
  channelName: string;
}

export interface WsReqGmChatSend extends WsMessage {
  type: WsMessageType.REQ_GM_CHAT_SEND;
  message: string;
}

export interface WsEventChatUserListChange extends WsMessage {
  type: WsMessageType.EVENT_CHAT_USER_LIST_CHANGE;
  user: ChatUser;
  action: 'JOIN' | 'LEAVE';
}

// =============================================================================
// BUILDING FOCUS MESSAGES
// =============================================================================

export interface WsReqBuildingFocus extends WsMessage {
  type: WsMessageType.REQ_BUILDING_FOCUS;
  x: number;
  y: number;
}

export interface WsReqBuildingUnfocus extends WsMessage {
  type: WsMessageType.REQ_BUILDING_UNFOCUS;
}

export interface WsRespBuildingFocus extends WsMessage {
  type: WsMessageType.RESP_BUILDING_FOCUS;
  building: BuildingFocusInfo;
}

export interface WsEventBuildingRefresh extends WsMessage {
  type: WsMessageType.EVENT_BUILDING_REFRESH;
  building: BuildingFocusInfo;
  /** 0=fchStatus (text only), 1=fchStructure (visual changed), 2=fchDestruction */
  kindOfChange: number;
}

export interface WsEventAreaRefresh extends WsMessage {
  type: WsMessageType.EVENT_AREA_REFRESH;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WsEventShowNotification extends WsMessage {
  type: WsMessageType.EVENT_SHOW_NOTIFICATION;
  /** 0=MessageBox, 1=URLFrame, 2=ChatMessage, 3=Sound, 4=GenericEvent */
  kind: number;
  title: string;
  body: string;
  options: number;
}

export interface WsEventCacheRefresh extends WsMessage {
  type: WsMessageType.EVENT_CACHE_REFRESH;
}

export interface WsEventWorldReconnected extends WsMessage {
  type: WsMessageType.EVENT_WORLD_RECONNECTED;
}

export interface WsEventWorldDisconnected extends WsMessage {
  type: WsMessageType.EVENT_WORLD_DISCONNECTED;
}

/** Server maintenance event — mirrors Delphi fMaintDue / fServerError broadcast */
export interface WsEventMaintenance extends WsMessage {
  type: WsMessageType.EVENT_MAINTENANCE;
  /** true = maintenance starting, false = maintenance ended */
  active: boolean;
  /** Human-readable message (e.g., "Server restarting in 5 minutes") */
  message: string;
}

// =============================================================================
// BUILDING CONSTRUCTION MESSAGES
// =============================================================================

export interface WsReqGetBuildingCategories extends WsMessage {
  type: WsMessageType.REQ_GET_BUILDING_CATEGORIES;
  companyName: string;
}

export interface WsReqGetBuildingFacilities extends WsMessage {
  type: WsMessageType.REQ_GET_BUILDING_FACILITIES;
  companyName: string;
  cluster: string;
  kind: string;
  kindName: string;
  folder: string;
  tycoonLevel: number;
}

export interface WsReqPlaceBuilding extends WsMessage {
  type: WsMessageType.REQ_PLACE_BUILDING;
  facilityClass: string;
  x: number;
  y: number;
}

export interface WsReqGetSurface extends WsMessage {
  type: WsMessageType.REQ_GET_SURFACE;
  surfaceType: SurfaceType;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface WsReqGetAllFacilityDimensions extends WsMessage {
  type: WsMessageType.REQ_GET_ALL_FACILITY_DIMENSIONS;
}

export interface WsRespBuildingCategories extends WsMessage {
  type: WsMessageType.RESP_BUILDING_CATEGORIES;
  categories: BuildingCategory[];
  capitolIconUrl?: string;
}

export interface WsRespBuildingFacilities extends WsMessage {
  type: WsMessageType.RESP_BUILDING_FACILITIES;
  facilities: BuildingInfo[];
}

export interface WsRespBuildingPlaced extends WsMessage {
  type: WsMessageType.RESP_BUILDING_PLACED;
  x: number;
  y: number;
  /**
   * Absent in practice — the RDO protocol does not return the new building's id.
   *
   * `TWorld.RDONewFacility` produces the created object and discards it into a
   * variable the Delphi source names `Useless` (World.pas:3562,3566); the reply
   * carries only a result code (capture :3399-3400). The legacy client never
   * learns the id either — it repaints the area instead. Optional rather than
   * `''`, so "unknown" cannot be mistaken for an id (M-A).
   */
  buildingId?: string;
}

export interface WsRespSurfaceData extends WsMessage {
  type: WsMessageType.RESP_SURFACE_DATA;
  data: SurfaceData;
}

export interface WsRespAllFacilityDimensions extends WsMessage {
  type: WsMessageType.RESP_ALL_FACILITY_DIMENSIONS;
  dimensions: Record<string, FacilityDimensions>;
  civicVisualClassIds: string[];
}

// =============================================================================
// BUILDING DETAILS MESSAGES
// =============================================================================

export interface WsReqBuildingDetails extends WsMessage {
  type: WsMessageType.REQ_BUILDING_DETAILS;
  x: number;
  y: number;
  visualClass: string;
}

export interface WsRespBuildingDetails extends WsMessage {
  type: WsMessageType.RESP_BUILDING_DETAILS;
  details: BuildingDetailsResponse;
}

export interface WsReqBuildingTabData extends WsMessage {
  type: WsMessageType.REQ_BUILDING_TAB_DATA;
  x: number;
  y: number;
  tabId: string;
  visualClass: string;
  /**
   * Template group IDs whose properties this tab needs.
   *
   * The inspector opens with the header group alone (see
   * `collectHeaderPropertyNames`), so every other group is read here, when its
   * menu entry is opened. One civic tab consolidates several server groups —
   * Administration is `capitolTowns` + `ministeries` + `townTaxes` — hence a
   * list rather than a single id. Omitted for the gate-based tabs
   * (supplies/products/compInputs), which carry no template properties.
   */
  groupIds?: string[];
}

export interface WsRespBuildingTabData extends WsMessage {
  type: WsMessageType.RESP_BUILDING_TAB_DATA;
  x: number;
  y: number;
  tabId: string;
  supplies?: BuildingSupplyData[];
  products?: BuildingProductData[];
  compInputs?: CompInputData[];
  warehouseWares?: WarehouseWareData[];
  /** Property values for the requested `groupIds`, keyed by group ID. */
  groups?: { [groupId: string]: BuildingPropertyValue[] };
}

/**
 * One gate's connection rows, on demand.
 *
 * `REQ_BUILDING_TAB_DATA` returns the Supplies/Products gates with their
 * headers and an empty `connections` list; this request fills one gate in when
 * the user opens it. Splitting the two is what keeps opening the tab cheap: a
 * 30-gate warehouse costs one round-trip pair per gate instead of also paying
 * one `GetSubObjectProps` per connection of every gate.
 *
 * `name` travels with the request because the response replaces the whole gate
 * record client-side, and the gate name is only listed by GetInputNames /
 * GetOutputNames — which this path does not call.
 */
export interface WsReqBuildingGateConnections extends WsMessage {
  type: WsMessageType.REQ_BUILDING_GATE_CONNECTIONS;
  x: number;
  y: number;
  /** Which accordion the gate belongs to. */
  tabId: 'supplies' | 'products';
  /** Gate path, as listed in the tab data. */
  path: string;
  /** Gate display name, echoed back in the refreshed record. */
  name: string;
  visualClass: string;
}

/** Exactly one of `supply` / `product` is set, matching the request's tabId. */
export interface WsRespBuildingGateConnections extends WsMessage {
  type: WsMessageType.RESP_BUILDING_GATE_CONNECTIONS;
  x: number;
  y: number;
  tabId: 'supplies' | 'products';
  path: string;
  supply?: BuildingSupplyData;
  product?: BuildingProductData;
}

/** Lightweight property refresh — reuses existing Delphi temp object. */
export interface WsReqBuildingRefreshProperties extends WsMessage {
  type: WsMessageType.REQ_BUILDING_REFRESH_PROPERTIES;
  x: number;
  y: number;
  visualClass: string;
  /** Active tab ID — when provided, server only refreshes this tab + overview (R1 optimisation). */
  activeTabId?: string;
}

export interface WsRespBuildingRefreshProperties extends WsMessage {
  type: WsMessageType.RESP_BUILDING_REFRESH_PROPERTIES;
  details: BuildingDetailsResponse;
}

export interface WsReqBuildingSetProperty extends WsMessage {
  type: WsMessageType.REQ_BUILDING_SET_PROPERTY;
  x: number;
  y: number;
  propertyName: string;
  value: string;
  additionalParams?: Record<string, string>;
}

export interface WsRespBuildingSetProperty extends WsMessage {
  type: WsMessageType.RESP_BUILDING_SET_PROPERTY;
  /** The command was issued and the round-trip did not throw. */
  success: boolean;
  propertyName: string;
  /**
   * What the server actually holds after the write — empty when nothing could
   * be read back. Never an echo of the requested value (M-E).
   */
  newValue: string;
  /**
   * `true` only when the server was re-read and holds the value the write would
   * have produced.
   *
   * Distinct from `success` on purpose (M-E): several legitimate commands — the
   * disconnect family — have no read-back property at all, so they succeed
   * without ever being confirmable. `newValue` used to echo the requested value
   * when the read-back came back empty, which made a mutation the server threw
   * away indistinguishable from one it applied.
   *
   * `undefined` means "nothing contradicts the write", and it is what the
   * cache-backed confirmations answer whenever they cannot do better (OB-28):
   * either the witness property reads the same whether or not the write landed,
   * or it still holds the old value — which for a civic write is the expected
   * reading for the first 30-90 s, the cache being refreshed asynchronously
   * (OB-29). `false` is reserved for a re-read that positively disagrees with
   * the write with no cache in the loop.
   */
  confirmed?: boolean;
}

export interface WsReqBuildingUpgrade extends WsMessage {
  type: WsMessageType.REQ_BUILDING_UPGRADE;
  x: number;
  y: number;
  action: 'DOWNGRADE' | 'START_UPGRADE' | 'STOP_UPGRADE';
  count?: number;
}

export interface WsRespBuildingUpgrade extends WsMessage {
  type: WsMessageType.RESP_BUILDING_UPGRADE;
  success: boolean;
  action: 'DOWNGRADE' | 'START_UPGRADE' | 'STOP_UPGRADE';
  message?: string;
}

export interface WsReqRenameFacility extends WsMessage {
  type: WsMessageType.REQ_RENAME_FACILITY;
  x: number;
  y: number;
  newName: string;
}

export interface WsRespRenameFacility extends WsMessage {
  type: WsMessageType.RESP_RENAME_FACILITY;
  success: boolean;
  newName: string;
  message?: string;
}

export interface WsReqDeleteFacility extends WsMessage {
  type: WsMessageType.REQ_DELETE_FACILITY;
  x: number;
  y: number;
}

export interface WsRespDeleteFacility extends WsMessage {
  type: WsMessageType.RESP_DELETE_FACILITY;
  success: boolean;
  message?: string;
}

// =============================================================================
// BUILDING CONNECTION (map-click connect two facilities)
// =============================================================================

export interface WsReqConnectFacilities extends WsMessage {
  type: WsMessageType.REQ_CONNECT_FACILITIES;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
}

export interface WsRespConnectFacilities extends WsMessage {
  type: WsMessageType.RESP_CONNECT_FACILITIES;
  success: boolean;
  resultMessage: string;
}

// =============================================================================
// CLONE FACILITY MESSAGES
// =============================================================================

export interface WsReqCloneFacility extends WsMessage {
  type: WsMessageType.REQ_CLONE_FACILITY;
  x: number;       // Source building X coordinate
  y: number;       // Source building Y coordinate
  options: number;  // Bitmask of clone option flags (OR'd together)
}

export interface WsRespCloneFacility extends WsMessage {
  type: WsMessageType.RESP_CLONE_FACILITY;
  success: boolean;
}

// =============================================================================
// SEARCH MENU MESSAGES
// =============================================================================

export interface WsReqSearchMenuHome extends WsMessage {
  type: WsMessageType.REQ_SEARCH_MENU_HOME;
}

export interface WsRespSearchMenuHome extends WsMessage {
  type: WsMessageType.RESP_SEARCH_MENU_HOME;
  categories: SearchMenuCategory[];
}

export interface WsReqSearchMenuTowns extends WsMessage {
  type: WsMessageType.REQ_SEARCH_MENU_TOWNS;
}

export interface WsRespSearchMenuTowns extends WsMessage {
  type: WsMessageType.RESP_SEARCH_MENU_TOWNS;
  towns: TownInfo[];
}

export interface WsReqSearchMenuTycoonProfile extends WsMessage {
  type: WsMessageType.REQ_SEARCH_MENU_TYCOON_PROFILE;
  tycoonName: string;
}

export interface WsRespSearchMenuTycoonProfile extends WsMessage {
  type: WsMessageType.RESP_SEARCH_MENU_TYCOON_PROFILE;
  profile: TycoonProfile;
}

export interface WsReqSearchMenuPeopleSearch extends WsMessage {
  type: WsMessageType.REQ_SEARCH_MENU_PEOPLE_SEARCH;
  searchStr: string;
}

export interface WsRespSearchMenuPeopleSearch extends WsMessage {
  type: WsMessageType.RESP_SEARCH_MENU_PEOPLE_SEARCH;
  results: string[];
}

export interface WsReqSearchMenuRankings extends WsMessage {
  type: WsMessageType.REQ_SEARCH_MENU_RANKINGS;
}

export interface WsRespSearchMenuRankings extends WsMessage {
  type: WsMessageType.RESP_SEARCH_MENU_RANKINGS;
  categories: RankingCategory[];
}

export interface WsReqSearchMenuRankingDetail extends WsMessage {
  type: WsMessageType.REQ_SEARCH_MENU_RANKING_DETAIL;
  rankingPath: string;
}

export interface WsRespSearchMenuRankingDetail extends WsMessage {
  type: WsMessageType.RESP_SEARCH_MENU_RANKING_DETAIL;
  title: string;
  entries: RankingEntry[];
}

export interface WsReqSearchMenuBanks extends WsMessage {
  type: WsMessageType.REQ_SEARCH_MENU_BANKS;
}

export interface WsRespSearchMenuBanks extends WsMessage {
  type: WsMessageType.RESP_SEARCH_MENU_BANKS;
  banks: unknown[];
}

export interface WsReqSearchMenuNewspapers extends WsMessage {
  type: WsMessageType.REQ_SEARCH_MENU_NEWSPAPERS;
}

export interface WsRespSearchMenuNewspapers extends WsMessage {
  type: WsMessageType.RESP_SEARCH_MENU_NEWSPAPERS;
  newspapers: NewspaperListing[];
}

// =============================================================================
// ROAD BUILDING MESSAGES
// =============================================================================

export interface WsReqBuildRoad extends WsMessage {
  type: WsMessageType.REQ_BUILD_ROAD;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /**
   * What the world says about each tile of the staircase path, in path order and start tile
   * included (issue #99). Terrain, the road layer and concrete live in the renderer, so the
   * client attests them and the gateway prices from them; omitted — or any other length —
   * and the path is priced as plain land.
   */
  tileFacts?: RoadTileFacts[];
}

export interface WsRespBuildRoad extends WsMessage {
  type: WsMessageType.RESP_BUILD_ROAD;
  success: boolean;
  cost: number;
  tileCount: number;
  message?: string;
  errorCode?: number;
  partial?: boolean;
}

/**
 * Not emitted yet: the client prices a drag itself with `estimateRoadCost`
 * (`@/shared/road-cost`), from the same formula and the same tile facts it sends with
 * `REQ_BUILD_ROAD`. The door stays open for a caller that holds no renderer.
 */
export interface WsReqGetRoadCost extends WsMessage {
  type: WsMessageType.REQ_GET_ROAD_COST;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Same contract as `WsReqBuildRoad.tileFacts`. */
  tileFacts?: RoadTileFacts[];
}

export interface WsRespGetRoadCost extends WsMessage {
  type: WsMessageType.RESP_GET_ROAD_COST;
  cost: number;
  tileCount: number;
  costPerTile: number;
}

// =============================================================================
// ROAD DEMOLITION MESSAGES
// =============================================================================

export interface WsReqDemolishRoad extends WsMessage {
  type: WsMessageType.REQ_DEMOLISH_ROAD;
  x: number;
  y: number;
}

export interface WsRespDemolishRoad extends WsMessage {
  type: WsMessageType.RESP_DEMOLISH_ROAD;
  success: boolean;
  message?: string;
  errorCode?: number;
}

export interface WsReqDemolishRoadArea extends WsMessage {
  type: WsMessageType.REQ_DEMOLISH_ROAD_AREA;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface WsRespDemolishRoadArea extends WsMessage {
  type: WsMessageType.RESP_DEMOLISH_ROAD_AREA;
  success: boolean;
  message?: string;
  errorCode?: number;
}

// =============================================================================
// LOGOUT MESSAGES
// =============================================================================

export interface WsReqLogout extends WsMessage {
  type: WsMessageType.REQ_LOGOUT;
}

export interface WsRespLogout extends WsMessage {
  type: WsMessageType.RESP_LOGOUT;
  success: boolean;
  message?: string;
}

// =============================================================================
// MAIL MESSAGES
// =============================================================================

export interface WsReqMailConnect extends WsMessage {
  type: WsMessageType.REQ_MAIL_CONNECT;
}

export interface WsReqMailGetFolder extends WsMessage {
  type: WsMessageType.REQ_MAIL_GET_FOLDER;
  folder: MailFolder;
}

export interface WsReqMailReadMessage extends WsMessage {
  type: WsMessageType.REQ_MAIL_READ_MESSAGE;
  folder: MailFolder;
  messageId: string;
}

export interface WsReqMailCompose extends WsMessage {
  type: WsMessageType.REQ_MAIL_COMPOSE;
  to: string;         // Recipient address(es), semicolon-separated
  subject: string;
  body: string[];      // Lines of text
  headers?: string;    // Original message headers for reply/forward threading (AddHeaders)
  existingDraftId?: string;   // Sent from an opened draft: delete that Draft copy once Post succeeds (#510)
}

export interface WsReqMailDelete extends WsMessage {
  type: WsMessageType.REQ_MAIL_DELETE;
  folder: MailFolder;
  messageId: string;
}

export interface WsReqMailGetUnreadCount extends WsMessage {
  type: WsMessageType.REQ_MAIL_GET_UNREAD_COUNT;
}

export interface WsRespMailConnected extends WsMessage {
  type: WsMessageType.RESP_MAIL_CONNECTED;
  unreadCount: number;
}

export interface WsRespMailFolder extends WsMessage {
  type: WsMessageType.RESP_MAIL_FOLDER;
  folder: MailFolder;
  messages: MailMessageHeader[];
}

export interface WsRespMailMessage extends WsMessage {
  type: WsMessageType.RESP_MAIL_MESSAGE;
  message: MailMessageFull;
}

export interface WsRespMailSent extends WsMessage {
  type: WsMessageType.RESP_MAIL_SENT;
  success: boolean;
  message?: string;
}

export interface WsRespMailDeleted extends WsMessage {
  type: WsMessageType.RESP_MAIL_DELETED;
  success: boolean;
}

export interface WsRespMailUnreadCount extends WsMessage {
  type: WsMessageType.RESP_MAIL_UNREAD_COUNT;
  count: number;
}

export interface WsEventNewMail extends WsMessage {
  type: WsMessageType.EVENT_NEW_MAIL;
  unreadCount: number;
}

/** Emitted by the compose view's "Save draft" button (#120). */
export interface WsReqMailSaveDraft extends WsMessage {
  type: WsMessageType.REQ_MAIL_SAVE_DRAFT;
  to: string;
  subject: string;
  body: string[];
  headers?: string;           // Original headers for reply/forward threading
  existingDraftId?: string;   // If editing existing draft, delete old one first
}

export interface WsRespMailDraftSaved extends WsMessage {
  type: WsMessageType.RESP_MAIL_DRAFT_SAVED;
  success: boolean;
  message?: string;
}

// =============================================================================
// PROFILE MESSAGES
// =============================================================================

export interface WsReqGetProfile extends WsMessage {
  type: WsMessageType.REQ_GET_PROFILE;
}

export interface WsRespGetProfile extends WsMessage {
  type: WsMessageType.RESP_GET_PROFILE;
  profile: TycoonProfileFull;
}

// =============================================================================
// PROFILE TAB MESSAGES
// =============================================================================

// --- Curriculum ---
export interface WsReqProfileCurriculum extends WsMessage {
  type: WsMessageType.REQ_PROFILE_CURRICULUM;
}

export interface WsRespProfileCurriculum extends WsMessage {
  type: WsMessageType.RESP_PROFILE_CURRICULUM;
  data: CurriculumData;
}

// --- Bank Account ---
export interface WsReqProfileBank extends WsMessage {
  type: WsMessageType.REQ_PROFILE_BANK;
}

export interface WsRespProfileBank extends WsMessage {
  type: WsMessageType.RESP_PROFILE_BANK;
  data: BankAccountData;
}

export interface WsReqProfileBankAction extends WsMessage {
  type: WsMessageType.REQ_PROFILE_BANK_ACTION;
  action: BankActionType;
  amount?: string;
  toTycoon?: string;
  reason?: string;
  loanIndex?: number;
}

export interface WsRespProfileBankAction extends WsMessage {
  type: WsMessageType.RESP_PROFILE_BANK_ACTION;
  result: BankActionResult;
}

// --- Profit & Loss ---
export interface WsReqProfileProfitLoss extends WsMessage {
  type: WsMessageType.REQ_PROFILE_PROFITLOSS;
}

export interface WsRespProfileProfitLoss extends WsMessage {
  type: WsMessageType.RESP_PROFILE_PROFITLOSS;
  data: ProfitLossData;
}

// --- Companies ---
export interface WsReqProfileCompanies extends WsMessage {
  type: WsMessageType.REQ_PROFILE_COMPANIES;
}

export interface WsRespProfileCompanies extends WsMessage {
  type: WsMessageType.RESP_PROFILE_COMPANIES;
  data: CompaniesData;
}

// --- Company Profit & Loss (CompanyPage.asp) ---
export interface WsReqProfileCompanyProfitLoss extends WsMessage {
  type: WsMessageType.REQ_PROFILE_COMPANY_PROFITLOSS;
  companyName: string;
  cluster: string;
}

export interface WsRespProfileCompanyProfitLoss extends WsMessage {
  type: WsMessageType.RESP_PROFILE_COMPANY_PROFITLOSS;
  companyName: string;
  /** The parsed tree, or null when the page could not be read. */
  data: ProfitLossData | null;
  /** Why `data` is null — present exactly when it is. */
  error?: string;
}

// --- Auto Connections ---
export interface WsReqProfileAutoConnections extends WsMessage {
  type: WsMessageType.REQ_PROFILE_AUTOCONNECTIONS;
}

export interface WsRespProfileAutoConnections extends WsMessage {
  type: WsMessageType.RESP_PROFILE_AUTOCONNECTIONS;
  data: AutoConnectionsData;
}

export interface WsReqProfileAutoConnectionAction extends WsMessage {
  type: WsMessageType.REQ_PROFILE_AUTOCONNECTION_ACTION;
  action: AutoConnectionActionType;
  fluidId: string;
  suppliers?: string;
}

export interface WsRespProfileAutoConnectionAction extends WsMessage {
  type: WsMessageType.RESP_PROFILE_AUTOCONNECTION_ACTION;
  success: boolean;
  message?: string;
}

// --- Policy ---
export interface WsReqProfilePolicy extends WsMessage {
  type: WsMessageType.REQ_PROFILE_POLICY;
}

export interface WsRespProfilePolicy extends WsMessage {
  type: WsMessageType.RESP_PROFILE_POLICY;
  data: PolicyData;
}

export interface WsReqProfilePolicySet extends WsMessage {
  type: WsMessageType.REQ_PROFILE_POLICY_SET;
  tycoonName: string;
  status: number;
}

export interface WsRespProfilePolicySet extends WsMessage {
  type: WsMessageType.RESP_PROFILE_POLICY_SET;
  success: boolean;
  message?: string;
}

// --- Curriculum Action ---
export interface WsReqProfileCurriculumAction extends WsMessage {
  type: WsMessageType.REQ_PROFILE_CURRICULUM_ACTION;
  action: CurriculumActionType;
  value?: boolean;
}

export interface WsRespProfileCurriculumAction extends WsMessage {
  type: WsMessageType.RESP_PROFILE_CURRICULUM_ACTION;
  success: boolean;
  message?: string;
}

// =============================================================================
// POLITICS
// =============================================================================

export interface WsReqPoliticsData extends WsMessage {
  type: WsMessageType.REQ_POLITICS_DATA;
  townName: string;
  buildingX: number;
  buildingY: number;
  /**
   * Capitol (president) rather than Town Hall (mayor).
   *
   * Not cosmetic: the five Politics pages resolve their ratings folder from
   * `Capitol=YES` + x/y (`popularratings.asp:9-17`), and fall back to
   * `Towns\<TownName>.five\Ratings\` otherwise. Sending a Capitol request
   * without it resolves `Towns\.five\Ratings\` — an empty folder, which the
   * page renders as a legitimate empty table.
   */
  isCapitol?: boolean;
}

export interface WsRespPoliticsData extends WsMessage {
  type: WsMessageType.RESP_POLITICS_DATA;
  data: PoliticsData;
}

export interface WsReqPoliticsVote extends WsMessage {
  type: WsMessageType.REQ_POLITICS_VOTE;
  buildingX: number;
  buildingY: number;
  candidateName: string;
}

export interface WsRespPoliticsVote extends WsMessage {
  type: WsMessageType.RESP_POLITICS_VOTE;
  success: boolean;
  message?: string;
}

export interface WsReqPoliticsLaunchCampaign extends WsMessage {
  type: WsMessageType.REQ_POLITICS_LAUNCH_CAMPAIGN;
  buildingX: number;
  buildingY: number;
  townName?: string;
}

export interface WsRespPoliticsLaunchCampaign extends WsMessage {
  type: WsMessageType.RESP_POLITICS_LAUNCH_CAMPAIGN;
  success: boolean;
  message?: string;
}

export interface WsReqPoliticsCancelCampaign extends WsMessage {
  type: WsMessageType.REQ_POLITICS_CANCEL_CAMPAIGN;
  buildingX: number;
  buildingY: number;
  townName?: string;
}

export interface WsRespPoliticsCancelCampaign extends WsMessage {
  type: WsMessageType.RESP_POLITICS_CANCEL_CAMPAIGN;
  success: boolean;
  message?: string;
}

/**
 * Rate the politician in office on one criterion — `RDOSetRatingFrom`.
 *
 * `ratingId` is the rating cache Id carried by `PoliticsRatingEntry.id`, which
 * only the Tycoons' ratings tab supplies. `value` is a percentage; Voyager's
 * own form offers 0..100 in steps of 10 (`boardmsg.asp:344-355`).
 */
export interface WsReqPoliticsSetRating extends WsMessage {
  type: WsMessageType.REQ_POLITICS_SET_RATING;
  buildingX: number;
  buildingY: number;
  ratingId: string;
  value: number;
}

export interface WsRespPoliticsSetRating extends WsMessage {
  type: WsMessageType.RESP_POLITICS_SET_RATING;
  success: boolean;
  ratingId: string;
  value: number;
  message?: string;
}

/** Distribute publicity across one criterion — `RDOSetPublicity`. Ruler only. */
export interface WsReqPoliticsSetPublicity extends WsMessage {
  type: WsMessageType.REQ_POLITICS_SET_PUBLICITY;
  buildingX: number;
  buildingY: number;
  ratingId: string;
  value: number;
}

export interface WsRespPoliticsSetPublicity extends WsMessage {
  type: WsMessageType.RESP_POLITICS_SET_PUBLICITY;
  success: boolean;
  ratingId: string;
  value: number;
  message?: string;
}

/**
 * Set one campaign project — `RDOSetProjectData`.
 *
 * `data` is a widestring whatever the row's kind: a tycoon name for a Minister
 * row, the percentage as text for a goal row (`tycooncampaign.asp:186-196`
 * sends `control.value` unchanged in both cases).
 */
export interface WsReqPoliticsSetProject extends WsMessage {
  type: WsMessageType.REQ_POLITICS_SET_PROJECT;
  buildingX: number;
  buildingY: number;
  projectId: string;
  data: string;
}

export interface WsRespPoliticsSetProject extends WsMessage {
  type: WsMessageType.RESP_POLITICS_SET_PROJECT;
  success: boolean;
  projectId: string;
  data: string;
  message?: string;
}

// =============================================================================
// NEWSPAPER — the town paper's editorial board
// =============================================================================

/**
 * Everything the board pages need to identify the paper and the reader.
 *
 * `paperName` is the town's `NewspaperName` cache property, which the Town Hall
 * inspector already reads (`template-groups.ts` townGeneral). Voyager passes the
 * same value from `TownHallSheet.pas:348`.
 */
export interface WsReqNewspaperBoard extends WsMessage {
  type: WsMessageType.REQ_NEWSPAPER_BOARD;
  paperName: string;
  townName: string;
  isCapitol: boolean;
  buildingX: number;
  buildingY: number;
  /** Board path of the column to open. Omitted for the index. */
  path?: string;
}

export interface WsRespNewspaperBoard extends WsMessage {
  type: WsMessageType.RESP_NEWSPAPER_BOARD;
  board: NewspaperBoard;
}

export interface WsReqNewspaperPost extends WsMessage {
  type: WsMessageType.REQ_NEWSPAPER_POST;
  paperName: string;
  townName: string;
  isCapitol: boolean;
  buildingX: number;
  buildingY: number;
  subject: string;
  body: string;
  /** Reply to this column rather than opening a new one. */
  replyToPath?: string;
}

export interface WsRespNewspaperPost extends WsMessage {
  type: WsMessageType.RESP_NEWSPAPER_POST;
  success: boolean;
  message: string;
  /** The board as re-rendered by the post — `null` when the post never ran. */
  board: NewspaperBoard | null;
}

/**
 * The paper's kept issues — what `ShowBar.asp` iterates for its date row.
 *
 * The same five fields as `WsReqNewspaperBoard`: the bar identifies the paper
 * exactly as the board pages do (`Newsreader.asp:4` forwards both sets).
 */
export interface WsReqNewspaperIssues extends WsMessage {
  type: WsMessageType.REQ_NEWSPAPER_ISSUES;
  paperName: string;
  townName: string;
  isCapitol: boolean;
  buildingX: number;
  buildingY: number;
}

export interface WsRespNewspaperIssues extends WsMessage {
  type: WsMessageType.RESP_NEWSPAPER_ISSUES;
  list: NewspaperIssueList;
}

export interface WsReqNewspaperIssue extends WsMessage {
  type: WsMessageType.REQ_NEWSPAPER_ISSUE;
  paperName: string;
  townName: string;
  isCapitol: boolean;
  buildingX: number;
  buildingY: number;
  /** The issue folder to open — one of the folders the issue list carries. */
  folder: string;
}

export interface WsRespNewspaperIssue extends WsMessage {
  type: WsMessageType.RESP_NEWSPAPER_ISSUE;
  issue: NewspaperIssue;
}

// =============================================================================
// TYCOON POLITICAL ROLE (Cache Query)
// =============================================================================

export interface WsReqTycoonRole extends WsMessage {
  type: WsMessageType.REQ_TYCOON_ROLE;
  tycoonName: string;
}

export interface WsRespTycoonRole extends WsMessage {
  type: WsMessageType.RESP_TYCOON_ROLE;
  role: PoliticalRoleInfo;
}

// =============================================================================
// CONNECTION SEARCH
// =============================================================================

export interface WsReqSearchConnections extends WsMessage {
  type: WsMessageType.REQ_SEARCH_CONNECTIONS;
  buildingX: number;
  buildingY: number;
  fluidId: string;
  direction: 'input' | 'output';
  filters?: {
    company?: string;
    town?: string;
    maxResults?: number;
    roles?: number;
  };
}

export interface ConnectionSearchResult {
  facilityName: string;
  companyName: string;
  x: number;
  y: number;
  price?: string;
  quality?: string;
  town?: string;
}

export interface WsRespSearchConnections extends WsMessage {
  type: WsMessageType.RESP_SEARCH_CONNECTIONS;
  results: ConnectionSearchResult[];
  fluidId: string;
  direction: 'input' | 'output';
}

// =============================================================================
// COMPANY CREATION MESSAGES
// =============================================================================

export interface WsReqCreateCompany extends WsMessage {
  type: WsMessageType.REQ_CREATE_COMPANY;
  companyName: string;
  cluster: string;
}

export interface WsRespCreateCompany extends WsMessage {
  type: WsMessageType.RESP_CREATE_COMPANY;
  success: boolean;
  companyName: string;
  companyId: string;
  message?: string;
}

// =============================================================================
// CLUSTER BROWSING MESSAGES (COMPANY CREATION)
// =============================================================================

export interface WsReqClusterInfo extends WsMessage {
  type: WsMessageType.REQ_CLUSTER_INFO;
  clusterName: string;
}

export interface WsRespClusterInfo extends WsMessage {
  type: WsMessageType.RESP_CLUSTER_INFO;
  clusterInfo: ClusterInfo;
}

export interface WsReqClusterFacilities extends WsMessage {
  type: WsMessageType.REQ_CLUSTER_FACILITIES;
  cluster: string;
  folder: string;
}

export interface WsRespClusterFacilities extends WsMessage {
  type: WsMessageType.RESP_CLUSTER_FACILITIES;
  facilities: ClusterFacilityPreview[];
}

// =============================================================================
// EMPIRE (OWNED FACILITIES) MESSAGES
// =============================================================================

/** A bookmarked facility from the Favorites tree. */
export interface FavoritesItem {
  id: number;
  name: string;
  x: number;
  y: number;
  /**
   * The item's Location — the '/'-separated path of ids the server resolves
   * (`TFavorites.LocateItem`, `Kernel/Favorites.pas:312-334`). Delete and
   * rename address an item by this path, never by its bare id.
   */
  path: string;
  /** True only on a folder (`fvkFolder`, `Kernel/FavProtocol.pas:6`). */
  isFolder?: boolean;
  /** A folder's fetched contents. Absent or empty for a link, or an unfetched folder. */
  children?: FavoritesItem[];
}

export interface WsReqEmpireFacilities extends WsMessage {
  type: WsMessageType.REQ_EMPIRE_FACILITIES;
}

export interface WsRespEmpireFacilities extends WsMessage {
  type: WsMessageType.RESP_EMPIRE_FACILITIES;
  facilities: FavoritesItem[];
}

/**
 * Add a link to the Favorites tree — `RDOFavoritesNewItem` at the root.
 * `Interface Server/InterfaceServer.pas:200`.
 */
export interface WsReqFavoriteAdd extends WsMessage {
  type: WsMessageType.REQ_FAVORITE_ADD;
  name: string;
  x: number;
  y: number;
}

export interface WsRespFavoriteAdd extends WsMessage {
  type: WsMessageType.RESP_FAVORITE_ADD;
  success: boolean;
  /** The id the server assigned, present only on success. */
  id?: number;
  message?: string;
}

/** Remove one favourite — `RDOFavoritesDelItem` (`InterfaceServer.pas:201`). */
export interface WsReqFavoriteDelete extends WsMessage {
  type: WsMessageType.REQ_FAVORITE_DELETE;
  path: string;
}

export interface WsRespFavoriteDelete extends WsMessage {
  type: WsMessageType.RESP_FAVORITE_DELETE;
  success: boolean;
  message?: string;
}

/** Rename one favourite — `RDOFavoritesRenameItem` (`InterfaceServer.pas:203`). */
export interface WsReqFavoriteRename extends WsMessage {
  type: WsMessageType.REQ_FAVORITE_RENAME;
  path: string;
  name: string;
}

export interface WsRespFavoriteRename extends WsMessage {
  type: WsMessageType.RESP_FAVORITE_RENAME;
  success: boolean;
  message?: string;
}

/**
 * Create a folder in the Favorites tree — `RDOFavoritesNewItem` with
 * `Kind = fvkFolder` (`Interface Server/InterfaceServer.pas:200`).
 */
export interface WsReqFavoriteFolderCreate extends WsMessage {
  type: WsMessageType.REQ_FAVORITE_FOLDER_CREATE;
  parentPath: string;
  name: string;
}

export interface WsRespFavoriteFolderCreate extends WsMessage {
  type: WsMessageType.RESP_FAVORITE_FOLDER_CREATE;
  success: boolean;
  /** The id the server assigned, present only on success. */
  id?: number;
  message?: string;
}

/** Move one item — `RDOFavoritesMoveItem` (`Interface Server/InterfaceServer.pas:202`). */
export interface WsReqFavoriteMove extends WsMessage {
  type: WsMessageType.REQ_FAVORITE_MOVE;
  path: string;
  destPath: string;
}

export interface WsRespFavoriteMove extends WsMessage {
  type: WsMessageType.RESP_FAVORITE_MOVE;
  success: boolean;
  message?: string;
}

// =============================================================================
// RESEARCH / INVENTIONS MESSAGES
// =============================================================================

/** A single invention item from the server cache. */
export interface ResearchInventionItem {
  /** Invention string ID (e.g., "GreenTech.Level1") */
  inventionId: string;
  /** Display name (from cache if volatile, falls back to ID) */
  name: string;
  /** Whether this invention can be researched (available items only) */
  enabled?: boolean;
  /** Formatted cost string (completed items only) */
  cost?: string;
  /** Parent category for tree grouping */
  parent?: string;
  /** Whether this is a volatile/dynamic invention */
  volatile?: boolean;
}

/** Research data for a single category tab. */
export interface ResearchCategoryData {
  categoryIndex: number;
  available: ResearchInventionItem[];
  developing: ResearchInventionItem[];
  completed: ResearchInventionItem[];
}

/** Detailed invention info from RDOGetInvPropsByLang + RDOGetInvDescEx. */
export interface ResearchInventionDetails {
  inventionId: string;
  /** Multi-line properties text (Price, Licence, Implementation Cost, etc.) */
  properties: string;
  /** Description + prerequisites */
  description: string;
}

export interface WsReqResearchInventory extends WsMessage {
  type: WsMessageType.REQ_RESEARCH_INVENTORY;
  buildingX: number;
  buildingY: number;
  categoryIndex: number;
}

export interface WsRespResearchInventory extends WsMessage {
  type: WsMessageType.RESP_RESEARCH_INVENTORY;
  data: ResearchCategoryData;
}

export interface WsReqResearchDetails extends WsMessage {
  type: WsMessageType.REQ_RESEARCH_DETAILS;
  buildingX: number;
  buildingY: number;
  inventionId: string;
}

export interface WsRespResearchDetails extends WsMessage {
  type: WsMessageType.RESP_RESEARCH_DETAILS;
  details: ResearchInventionDetails;
}

// =============================================================================
// ZONE PAINTING MESSAGES
// =============================================================================

export interface WsReqDefineZone extends WsMessage {
  type: WsMessageType.REQ_DEFINE_ZONE;
  zoneId: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface WsRespDefineZone extends WsMessage {
  type: WsMessageType.RESP_DEFINE_ZONE;
  success: boolean;
  message?: string;
}

// =============================================================================
// CAPITOL MESSAGES
// =============================================================================

export interface WsReqBuildCapitol extends WsMessage {
  type: WsMessageType.REQ_BUILD_CAPITOL;
  x: number;
  y: number;
}

export interface WsRespCapitolPlaced extends WsMessage {
  type: WsMessageType.RESP_CAPITOL_PLACED;
  x: number;
  y: number;
  /** Absent in practice — see {@link WsRespBuildingPlaced.buildingId} (M-A). */
  buildingId?: string;
}

export interface WsRespCapitolCoords extends WsMessage {
  type: WsMessageType.RESP_CAPITOL_COORDS;
  x: number;
  y: number;
  hasCapitol: boolean;
}

// =============================================================================
// CAMERA POSITION MESSAGES
// =============================================================================

export interface WsReqUpdateCamera extends WsMessage {
  type: WsMessageType.REQ_UPDATE_CAMERA;
  x: number;  // column (j) — matches LastX.0 cookie
  y: number;  // row (i) — matches LastY.0 cookie
  viewX?: number;  // viewport top-left column
  viewY?: number;  // viewport top-left row
  viewW?: number;  // viewport width in tiles
  viewH?: number;  // viewport height in tiles
}

// =============================================================================
// TYPE GUARDS
// =============================================================================

export function isWsRequest(msg: WsMessage): boolean {
  return msg.type.startsWith('REQ_');
}
