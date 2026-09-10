/**
 * WebSocket Handler Registry
 *
 * Maps WsMessageType → handler function, replacing the monolithic switch block
 * that was previously in server.ts handleClientMessage().
 */

import { WsMessageType } from '../../shared/types';
import type { WsHandler } from './types';

// Auth & session
import { handleAuthCheck, handleConnectDirectory, handleLoginWorld, handleSelectCompany, handleSwitchCompany, handleLogout } from './auth-handlers';

// Map & camera
import { handleMapLoad, handleUpdateCamera, handleGetSurface, handleGetAllFacilityDimensions } from './map-handlers';

// Chat
import { handleChatGetUsers, handleChatGetChannels, handleChatGetChannelInfo, handleChatJoinChannel, handleChatSendMessage, handleChatTypingStatus, handleGmChatSend } from './chat-handlers';

// Building inspection & management
import { handleBuildingFocus, handleBuildingUnfocus, handleGetBuildingCategories, handleGetBuildingFacilities, handlePlaceBuilding, handleBuildCapitol, handleBuildingDetails, handleBuildingTabData, handleBuildingGateConnections, handleBuildingRefreshProperties, handleBuildingSetProperty, handleCloneFacility, handleBuildingUpgrade, handleRenameFacility, handleDeleteFacility, handleConnectFacilities } from './building-handlers';

// Roads
import { handleBuildRoad, handleGetRoadCost, handleDemolishRoad, handleDemolishRoadArea } from './road-handlers';

// Mail
import { handleMailConnect, handleMailGetFolder, handleMailReadMessage, handleMailCompose, handleMailSaveDraft, handleMailDelete, handleMailGetUnreadCount } from './mail-handlers';

// Profile
import { handleGetProfile, handleProfileCurriculum, handleProfileBank, handleProfileBankAction, handleProfileProfitLoss, handleProfileCompanies, handleProfileCompanyProfitLoss, handleProfileAutoConnections, handleProfileAutoConnectionAction, handleProfilePolicy, handleProfilePolicySet, handleProfileCurriculumAction } from './profile-handlers';

// Search menu
import { handleSearchMenuHome, handleSearchMenuTowns, handleSearchMenuPeopleSearch, handleSearchMenuTycoonProfile, handleSearchMenuRankings, handleSearchMenuRankingDetail, handleSearchMenuBanks, handleSearchMenuNewspapers } from './search-handlers';

// Politics
import {
  handleNewspaperBoard,
  handleNewspaperPost,
  handleNewspaperIssues,
  handleNewspaperIssue,
} from './newspaper-handlers';
import { handlePoliticsData, handlePoliticsVote, handlePoliticsLaunchCampaign, handlePoliticsCancelCampaign, handlePoliticsSetRating, handlePoliticsSetPublicity, handlePoliticsSetProject, handleTycoonRole } from './politics-handlers';

// Miscellaneous
import { handleDefineZone, handleCreateCompany, handleClusterInfo, handleClusterFacilities, handleSearchConnections, handleEmpireFacilities, handleFavoriteAdd, handleFavoriteDelete, handleFavoriteRename, handleFavoriteFolderCreate, handleFavoriteMove, handleResearchInventory, handleResearchDetails } from './misc-handlers';

export const wsHandlerRegistry: Partial<Record<WsMessageType, WsHandler>> = {
  // Auth & session
  [WsMessageType.REQ_AUTH_CHECK]: handleAuthCheck,
  [WsMessageType.REQ_CONNECT_DIRECTORY]: handleConnectDirectory,
  [WsMessageType.REQ_LOGIN_WORLD]: handleLoginWorld,
  [WsMessageType.REQ_SELECT_COMPANY]: handleSelectCompany,
  [WsMessageType.REQ_SWITCH_COMPANY]: handleSwitchCompany,
  [WsMessageType.REQ_LOGOUT]: handleLogout,

  // Map & camera
  [WsMessageType.REQ_MAP_LOAD]: handleMapLoad,
  [WsMessageType.REQ_UPDATE_CAMERA]: handleUpdateCamera,
  [WsMessageType.REQ_GET_SURFACE]: handleGetSurface,
  [WsMessageType.REQ_GET_ALL_FACILITY_DIMENSIONS]: handleGetAllFacilityDimensions,

  // Chat
  [WsMessageType.REQ_CHAT_GET_USERS]: handleChatGetUsers,
  [WsMessageType.REQ_CHAT_GET_CHANNELS]: handleChatGetChannels,
  [WsMessageType.REQ_CHAT_GET_CHANNEL_INFO]: handleChatGetChannelInfo,
  [WsMessageType.REQ_CHAT_JOIN_CHANNEL]: handleChatJoinChannel,
  [WsMessageType.REQ_CHAT_SEND_MESSAGE]: handleChatSendMessage,
  [WsMessageType.REQ_CHAT_TYPING_STATUS]: handleChatTypingStatus,
  [WsMessageType.REQ_GM_CHAT_SEND]: handleGmChatSend,

  // Building inspection & management
  [WsMessageType.REQ_BUILDING_FOCUS]: handleBuildingFocus,
  [WsMessageType.REQ_BUILDING_UNFOCUS]: handleBuildingUnfocus,
  [WsMessageType.REQ_GET_BUILDING_CATEGORIES]: handleGetBuildingCategories,
  [WsMessageType.REQ_GET_BUILDING_FACILITIES]: handleGetBuildingFacilities,
  [WsMessageType.REQ_PLACE_BUILDING]: handlePlaceBuilding,
  [WsMessageType.REQ_BUILD_CAPITOL]: handleBuildCapitol,
  [WsMessageType.REQ_BUILDING_DETAILS]: handleBuildingDetails,
  [WsMessageType.REQ_BUILDING_TAB_DATA]: handleBuildingTabData,
  [WsMessageType.REQ_BUILDING_GATE_CONNECTIONS]: handleBuildingGateConnections,
  [WsMessageType.REQ_BUILDING_REFRESH_PROPERTIES]: handleBuildingRefreshProperties,
  [WsMessageType.REQ_BUILDING_SET_PROPERTY]: handleBuildingSetProperty,
  [WsMessageType.REQ_CLONE_FACILITY]: handleCloneFacility,
  [WsMessageType.REQ_BUILDING_UPGRADE]: handleBuildingUpgrade,
  [WsMessageType.REQ_RENAME_FACILITY]: handleRenameFacility,
  [WsMessageType.REQ_DELETE_FACILITY]: handleDeleteFacility,
  [WsMessageType.REQ_CONNECT_FACILITIES]: handleConnectFacilities,

  // Roads
  [WsMessageType.REQ_BUILD_ROAD]: handleBuildRoad,
  [WsMessageType.REQ_GET_ROAD_COST]: handleGetRoadCost,
  [WsMessageType.REQ_DEMOLISH_ROAD]: handleDemolishRoad,
  [WsMessageType.REQ_DEMOLISH_ROAD_AREA]: handleDemolishRoadArea,

  // Mail
  [WsMessageType.REQ_MAIL_CONNECT]: handleMailConnect,
  [WsMessageType.REQ_MAIL_GET_FOLDER]: handleMailGetFolder,
  [WsMessageType.REQ_MAIL_READ_MESSAGE]: handleMailReadMessage,
  [WsMessageType.REQ_MAIL_COMPOSE]: handleMailCompose,
  [WsMessageType.REQ_MAIL_SAVE_DRAFT]: handleMailSaveDraft,
  [WsMessageType.REQ_MAIL_DELETE]: handleMailDelete,
  [WsMessageType.REQ_MAIL_GET_UNREAD_COUNT]: handleMailGetUnreadCount,

  // Profile
  [WsMessageType.REQ_GET_PROFILE]: handleGetProfile,
  [WsMessageType.REQ_PROFILE_CURRICULUM]: handleProfileCurriculum,
  [WsMessageType.REQ_PROFILE_BANK]: handleProfileBank,
  [WsMessageType.REQ_PROFILE_BANK_ACTION]: handleProfileBankAction,
  [WsMessageType.REQ_PROFILE_PROFITLOSS]: handleProfileProfitLoss,
  [WsMessageType.REQ_PROFILE_COMPANIES]: handleProfileCompanies,
  [WsMessageType.REQ_PROFILE_COMPANY_PROFITLOSS]: handleProfileCompanyProfitLoss,
  [WsMessageType.REQ_PROFILE_AUTOCONNECTIONS]: handleProfileAutoConnections,
  [WsMessageType.REQ_PROFILE_AUTOCONNECTION_ACTION]: handleProfileAutoConnectionAction,
  [WsMessageType.REQ_PROFILE_POLICY]: handleProfilePolicy,
  [WsMessageType.REQ_PROFILE_POLICY_SET]: handleProfilePolicySet,
  [WsMessageType.REQ_PROFILE_CURRICULUM_ACTION]: handleProfileCurriculumAction,

  // Search menu
  [WsMessageType.REQ_SEARCH_MENU_HOME]: handleSearchMenuHome,
  [WsMessageType.REQ_SEARCH_MENU_TOWNS]: handleSearchMenuTowns,
  [WsMessageType.REQ_SEARCH_MENU_PEOPLE_SEARCH]: handleSearchMenuPeopleSearch,
  [WsMessageType.REQ_SEARCH_MENU_TYCOON_PROFILE]: handleSearchMenuTycoonProfile,
  [WsMessageType.REQ_SEARCH_MENU_RANKINGS]: handleSearchMenuRankings,
  [WsMessageType.REQ_SEARCH_MENU_RANKING_DETAIL]: handleSearchMenuRankingDetail,
  [WsMessageType.REQ_SEARCH_MENU_BANKS]: handleSearchMenuBanks,
  [WsMessageType.REQ_SEARCH_MENU_NEWSPAPERS]: handleSearchMenuNewspapers,

  // Politics
  [WsMessageType.REQ_POLITICS_DATA]: handlePoliticsData,
  [WsMessageType.REQ_POLITICS_VOTE]: handlePoliticsVote,
  [WsMessageType.REQ_POLITICS_LAUNCH_CAMPAIGN]: handlePoliticsLaunchCampaign,
  [WsMessageType.REQ_POLITICS_CANCEL_CAMPAIGN]: handlePoliticsCancelCampaign,
  [WsMessageType.REQ_POLITICS_SET_RATING]: handlePoliticsSetRating,
  [WsMessageType.REQ_POLITICS_SET_PUBLICITY]: handlePoliticsSetPublicity,
  [WsMessageType.REQ_POLITICS_SET_PROJECT]: handlePoliticsSetProject,
  [WsMessageType.REQ_NEWSPAPER_BOARD]: handleNewspaperBoard,
  [WsMessageType.REQ_NEWSPAPER_POST]: handleNewspaperPost,
  [WsMessageType.REQ_NEWSPAPER_ISSUES]: handleNewspaperIssues,
  [WsMessageType.REQ_NEWSPAPER_ISSUE]: handleNewspaperIssue,
  [WsMessageType.REQ_TYCOON_ROLE]: handleTycoonRole,

  // Miscellaneous
  [WsMessageType.REQ_DEFINE_ZONE]: handleDefineZone,
  [WsMessageType.REQ_CREATE_COMPANY]: handleCreateCompany,
  [WsMessageType.REQ_CLUSTER_INFO]: handleClusterInfo,
  [WsMessageType.REQ_CLUSTER_FACILITIES]: handleClusterFacilities,
  [WsMessageType.REQ_SEARCH_CONNECTIONS]: handleSearchConnections,
  [WsMessageType.REQ_EMPIRE_FACILITIES]: handleEmpireFacilities,
  [WsMessageType.REQ_FAVORITE_ADD]: handleFavoriteAdd,
  [WsMessageType.REQ_FAVORITE_DELETE]: handleFavoriteDelete,
  [WsMessageType.REQ_FAVORITE_RENAME]: handleFavoriteRename,
  [WsMessageType.REQ_FAVORITE_FOLDER_CREATE]: handleFavoriteFolderCreate,
  [WsMessageType.REQ_FAVORITE_MOVE]: handleFavoriteMove,
  [WsMessageType.REQ_RESEARCH_INVENTORY]: handleResearchInventory,
  [WsMessageType.REQ_RESEARCH_DETAILS]: handleResearchDetails,
};
