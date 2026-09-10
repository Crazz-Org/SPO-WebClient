/**
 * Event Handler — extracted from StarpeaceClient.handleMessage().
 *
 * Handles the switch block for incoming server events and push messages.
 */

import {
  WsMessageType,
  WsMessage,
  WsRespError,
  WsEventChatMsg,
  WsRespMapData,
  WsEventChatUserTyping,
  WsEventChatChannelChange,
  WsEventChatUserListChange,
  WsEventBuildingRefresh,
  WsEventAreaRefresh,
  WsEventTycoonUpdate,
  WsEventRefreshDate,
  WsEventShowNotification,
  WsEventNewMail,
  WsRespMailConnected,
  WsReqMailGetUnreadCount,
  WsRespCapitolCoords,
  WsRespGetProfile,
  WsRespSearchConnections,
  WsRespClusterInfo,
  WsRespClusterFacilities,
  WsRespResearchInventory,
  WsRespResearchDetails,
} from '../../shared/types';
import { toErrorMessage } from '../../shared/error-utils';
import { requestBuildingRefreshProperties } from './building-action-handler';
import { migrateLocalBookmarks } from './favorites-handler';
import { ClientBridge } from '../bridge/client-bridge';
import { useGameStore, delphiTDateTimeToJsDate } from '../store/game-store';
import { useUiStore } from '../store/ui-store';
import { useBuildingStore } from '../store/building-store';
import { useProfileStore } from '../store/profile-store';
import { getFacilityDimensionsCache } from '../facility-dimensions-cache';
import type { ClientHandlerContext } from './client-context';

// ── Refresh Throttle (R2 + R3) ────────────────────────────────────────────────
// The Delphi server pushes EVENT_BUILDING_REFRESH every ~5s. The legacy client
// only refreshes the active tab (1 RDO call per event). Our refresh re-fetches
// more data, so we throttle to reduce server load.
const REFRESH_INTERVAL_OWNED_MS = 8_000;      // owned buildings: 8s min interval
const REFRESH_INTERVAL_NON_OWNED_MS = 20_000;  // non-owned: 20s min interval
let lastBuildingRefreshTime = 0;

/**
 * Dispatch incoming server events and push messages.
 * Returns true if the message was handled, false otherwise.
 */
export function dispatchEvent(ctx: ClientHandlerContext, msg: WsMessage): void {
  switch (msg.type) {
    case WsMessageType.EVENT_CHAT_MSG: {
      const chat = msg as WsEventChatMsg;
      const isSystem = chat.from === 'SYSTEM';
      ClientBridge.addChatMessage(chat.channel, {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        from: chat.from,
        text: chat.message,
        timestamp: Date.now(),
        isSystem,
        isGM: chat.from === 'GM',
      });
      ClientBridge.log('Chat', `[${chat.channel}] ${chat.from}: ${chat.message}`);
      ctx.soundManager.play('chat-message');
      break;
    }

    case WsMessageType.EVENT_CHAT_USER_TYPING: {
      const typing = msg as WsEventChatUserTyping;
      ClientBridge.setChatUserTyping(typing.username, typing.isTyping);
      break;
    }

    case WsMessageType.EVENT_CHAT_CHANNEL_CHANGE: {
      const channelChange = msg as WsEventChatChannelChange;
      ClientBridge.setCurrentChannel(channelChange.channelName);
      ctx.requestUserList();
      break;
    }

    case WsMessageType.EVENT_CHAT_USER_LIST_CHANGE: {
      const userChange = msg as WsEventChatUserListChange;
      if (userChange.action === 'JOIN') {
        ClientBridge.addChatUser(userChange.user);
      } else {
        ClientBridge.removeChatUser(userChange.user.name);
      }
      break;
    }

    case WsMessageType.EVENT_MAP_DATA:
    case WsMessageType.RESP_MAP_DATA: {
      const mapMsg = msg as WsRespMapData;
      ClientBridge.log('Map', `Received area (${mapMsg.data.x}, ${mapMsg.data.y}): ${mapMsg.data.buildings.length} buildings, ${mapMsg.data.segments.length} segments`);
      ctx.getRenderer()?.updateMapData(mapMsg.data);
      break;
    }

    case WsMessageType.EVENT_AREA_REFRESH: {
      const areaEvt = msg as WsEventAreaRefresh;
      ClientBridge.log('Map', `Area refresh at (${areaEvt.x}, ${areaEvt.y}) ${areaEvt.width}x${areaEvt.height}`);
      const areaRenderer = ctx.getRenderer();
      if (areaRenderer) {
        areaRenderer.invalidateArea(
          areaEvt.x,
          areaEvt.y,
          areaEvt.x + areaEvt.width,
          areaEvt.y + areaEvt.height
        );
        areaRenderer.triggerZoneCheck();
      }
      break;
    }

    case WsMessageType.EVENT_BUILDING_REFRESH: {
      const refreshEvt = msg as WsEventBuildingRefresh;
      const kind = refreshEvt.kindOfChange;

      if (kind === 1 || kind === 2) {
        const renderer = ctx.getRenderer();
        if (renderer) {
          ClientBridge.log('Map', `Building ${refreshEvt.building.buildingId} ${kind === 1 ? 'structure changed' : 'destroyed'}, invalidating zone at (${refreshEvt.building.x}, ${refreshEvt.building.y})`);
          renderer.invalidateZone(refreshEvt.building.x, refreshEvt.building.y);
          renderer.triggerZoneCheck();
        }
      }

      if (ctx.currentFocusedBuilding &&
          ctx.currentFocusedBuilding.buildingId === refreshEvt.building.buildingId) {
        const refreshVc = ctx.currentFocusedVisualClass || '0';
        const refreshDims = getFacilityDimensionsCache().getFacility(refreshVc);
        refreshEvt.building.xsize = refreshDims?.xsize ?? 1;
        refreshEvt.building.ysize = refreshDims?.ysize ?? 1;
        refreshEvt.building.visualClass = refreshVc;

        // Preserve previously-parsed Town Hall demographics when a refresh
        // arrives without them (e.g. a status-only push lacking the ExtraInfo
        // arg) — avoids blanking the population panel on partial refreshes.
        if (!refreshEvt.building.demographics && ctx.currentFocusedBuilding.demographics) {
          refreshEvt.building.demographics = ctx.currentFocusedBuilding.demographics;
        }

        ctx.currentFocusedBuilding = refreshEvt.building;
        ClientBridge.setFocusedBuilding(refreshEvt.building);

        // R2+R3: Throttle refresh to reduce RDO call volume.
        // The legacy Delphi client refreshes only the active tab (~1 RDO/event).
        // We refresh more data per event, so we compensate with longer intervals.
        // Structural changes (kind 1/2) always refresh immediately.
        const now = Date.now();
        const isOwned = useBuildingStore.getState().isOwner;
        const minInterval = isOwned ? REFRESH_INTERVAL_OWNED_MS : REFRESH_INTERVAL_NON_OWNED_MS;
        const isStructuralChange = kind === 1 || kind === 2;

        if (!isStructuralChange && (now - lastBuildingRefreshTime) < minInterval) {
          break;
        }
        lastBuildingRefreshTime = now;

        // Lightweight refresh: re-read properties on existing Delphi temp object.
        // Avoids creating a new temp object every ~5s (which leaked the old one
        // and destabilized in-flight tab data requests).
        const activeTabId = useBuildingStore.getState().currentTab;
        const refreshGen = ctx.nextGeneration('buildingRefresh');
        requestBuildingRefreshProperties(
          ctx,
          ctx.currentFocusedBuilding.x,
          ctx.currentFocusedBuilding.y,
          ctx.currentFocusedVisualClass || '0',
          activeTabId,
        ).then(refreshedDetails => {
          // Discard stale refresh if the user switched buildings while in-flight
          if (!ctx.isCurrentGeneration('buildingRefresh', refreshGen)) return;
          if (refreshedDetails) {
            ClientBridge.updateBuildingDetails(refreshedDetails);
          }
        }).catch((err: unknown) => {
          ClientBridge.log('Error', `Failed to refresh building: ${toErrorMessage(err)}`);
        });
      }
      break;
    }

    case WsMessageType.EVENT_TYCOON_UPDATE: {
      const tycoonUpdate = msg as WsEventTycoonUpdate;
      ctx.currentTycoonData = {
        cash: tycoonUpdate.cash,
        incomePerHour: tycoonUpdate.incomePerHour,
        ranking: tycoonUpdate.ranking,
        buildingCount: tycoonUpdate.buildingCount,
        maxBuildings: tycoonUpdate.maxBuildings
      };
      ClientBridge.log('Tycoon', `Cash: ${tycoonUpdate.cash} | Income/h: ${tycoonUpdate.incomePerHour} | Rank: ${tycoonUpdate.ranking} | Buildings: ${tycoonUpdate.buildingCount}/${tycoonUpdate.maxBuildings}`);
      ClientBridge.updateTycoonStats({
        username: ctx.storedUsername,
        ...ctx.currentTycoonData,
        failureLevel: tycoonUpdate.failureLevel,
      });
      break;
    }

    case WsMessageType.EVENT_RDO_PUSH: {
      const pushData = (msg as unknown as Record<string, unknown>).rawPacket || msg;
      ClientBridge.log('Push', `Received: ${JSON.stringify(pushData).substring(0, 100)}...`);
      break;
    }

    case WsMessageType.EVENT_END_OF_PERIOD:
      ClientBridge.log('Period', 'Financial period ended — refreshing data');
      ctx.showNotification('Financial period ended', 'info');
      ctx.soundManager.play('period-end');
      ctx.getProfile().catch((err: unknown) => {
        ClientBridge.log('Error', `Failed to refresh tycoon data: ${toErrorMessage(err)}`);
      });
      break;

    case WsMessageType.EVENT_REFRESH_DATE: {
      const dateEvent = msg as WsEventRefreshDate;
      useGameStore.getState().setGameDate(delphiTDateTimeToJsDate(dateEvent.dateDouble));
      break;
    }

    case WsMessageType.EVENT_SHOW_NOTIFICATION: {
      const notif = msg as WsEventShowNotification;
      ClientBridge.log('Notification', `Kind=${notif.kind}, Options=${notif.options}: ${notif.body || notif.title}`);
      const displayText = notif.body || notif.title || 'Server notification';
      const variant = notif.kind === 4 ? 'success' as const : 'info' as const;
      ctx.showNotification(displayText, variant);

      if (notif.kind === 4 && notif.options === 1) {
        ClientBridge.log('Notification', 'Research event — invalidating build catalog cache');
        ctx.buildingCategories = [];
        ClientBridge.setBuildMenuCategories([]);
      }
      break;
    }

    case WsMessageType.EVENT_WORLD_RECONNECTED: {
      ClientBridge.log('Session', 'World socket reconnected');
      ctx.showNotification('Connection restored', 'success');
      break;
    }

    case WsMessageType.EVENT_WORLD_DISCONNECTED: {
      ClientBridge.log('Session', 'World socket disconnected — reconnection failed');
      ctx.showNotification('Connection lost — please refresh', 'error');
      break;
    }

    case WsMessageType.EVENT_CACHE_REFRESH: {
      ClientBridge.log('Cache', 'Server invalidated cache — re-fetching building details');
      if (ctx.currentFocusedBuilding) {
        ctx.requestBuildingDetails(
          ctx.currentFocusedBuilding.x,
          ctx.currentFocusedBuilding.y,
          ctx.currentFocusedVisualClass || '0'
        ).then(refreshedDetails => {
          if (refreshedDetails) {
            ClientBridge.updateBuildingDetails(refreshedDetails);
          }
        }).catch((err: unknown) => {
          ClientBridge.log('Error', `Failed to refresh building after cache invalidation: ${toErrorMessage(err)}`);
        });
      }
      break;
    }

    case WsMessageType.EVENT_NEW_MAIL: {
      const newMail = msg as WsEventNewMail;
      ClientBridge.log('Mail', `New mail! ${newMail.unreadCount} unread message(s)`);
      ctx.soundManager.play('mail');
      ClientBridge.setMailUnreadCount(newMail.unreadCount);
      break;
    }

    case WsMessageType.RESP_MAIL_CONNECTED: {
      const mailConn = msg as WsRespMailConnected;
      ClientBridge.log('Mail', `Mail service connected. ${mailConn.unreadCount} unread.`);
      ClientBridge.setMailUnreadCount(mailConn.unreadCount);
      break;
    }

    case WsMessageType.RESP_MAIL_MESSAGE:
    case WsMessageType.RESP_MAIL_DELETED:
      ClientBridge.handleMailResponse(msg);
      // Reading an Inbox message clears its unread flag: the gateway touches
      // MessageBody.asp after the RDO read completes, before it sends this
      // response, so the mail server's Read flag is already on disk by the
      // time we get here. Deleting a message can remove an unread one outright.
      // Both move a count only the server can compute — without this the badge
      // only ever climbs: RESP_MAIL_CONNECTED sets it once at login and
      // EVENT_NEW_MAIL raises it, and nothing ever brought it down.
      requestMailUnreadCount(ctx);
      break;

    case WsMessageType.RESP_MAIL_FOLDER:
    case WsMessageType.RESP_MAIL_SENT:
    case WsMessageType.RESP_MAIL_UNREAD_COUNT:
    case WsMessageType.RESP_MAIL_DRAFT_SAVED:
      ClientBridge.handleMailResponse(msg);
      break;

    case WsMessageType.RESP_SEARCH_MENU_HOME:
    case WsMessageType.RESP_SEARCH_MENU_TOWNS:
    case WsMessageType.RESP_SEARCH_MENU_PEOPLE_SEARCH:
    case WsMessageType.RESP_SEARCH_MENU_TYCOON_PROFILE:
    case WsMessageType.RESP_SEARCH_MENU_RANKINGS:
    case WsMessageType.RESP_SEARCH_MENU_RANKING_DETAIL:
    case WsMessageType.RESP_SEARCH_MENU_BANKS:
    case WsMessageType.RESP_SEARCH_MENU_NEWSPAPERS:
      ClientBridge.handleSearchMenuResponse(msg);
      break;

    case WsMessageType.RESP_CAPITOL_COORDS: {
      const capitolMsg = msg as WsRespCapitolCoords;
      if (capitolMsg.hasCapitol) {
        useGameStore.getState().setCapitolCoords({ x: capitolMsg.x, y: capitolMsg.y });
        ClientBridge.log('Capitol', `Capitol located at (${capitolMsg.x}, ${capitolMsg.y})`);
      } else {
        useGameStore.getState().setCapitolCoords(null);
        ClientBridge.log('Capitol', 'No Capitol in this world');
      }
      break;
    }

    case WsMessageType.RESP_PROFILE_CURRICULUM:
    case WsMessageType.RESP_PROFILE_BANK:
    case WsMessageType.RESP_PROFILE_BANK_ACTION:
    case WsMessageType.RESP_PROFILE_PROFITLOSS:
    case WsMessageType.RESP_PROFILE_COMPANIES:
    case WsMessageType.RESP_PROFILE_COMPANY_PROFITLOSS:
    case WsMessageType.RESP_PROFILE_AUTOCONNECTIONS:
    case WsMessageType.RESP_PROFILE_AUTOCONNECTION_ACTION:
    case WsMessageType.RESP_PROFILE_POLICY:
    case WsMessageType.RESP_PROFILE_POLICY_SET:
    case WsMessageType.RESP_PROFILE_CURRICULUM_ACTION:
      ClientBridge.handleProfileResponse(msg);
      break;

    case WsMessageType.RESP_POLITICS_DATA:
      ClientBridge.handlePoliticsResponse(msg);
      break;

    case WsMessageType.RESP_POLITICS_LAUNCH_CAMPAIGN:
    case WsMessageType.RESP_POLITICS_CANCEL_CAMPAIGN:
      ClientBridge.handlePoliticsCampaignResponse(msg);
      break;

    case WsMessageType.RESP_POLITICS_SET_RATING:
    case WsMessageType.RESP_POLITICS_SET_PUBLICITY:
    case WsMessageType.RESP_POLITICS_SET_PROJECT:
      ClientBridge.handlePoliticsMutationResponse(msg);
      break;

    case WsMessageType.RESP_NEWSPAPER_BOARD:
    case WsMessageType.RESP_NEWSPAPER_POST:
    case WsMessageType.RESP_NEWSPAPER_ISSUES:
    case WsMessageType.RESP_NEWSPAPER_ISSUE:
      ClientBridge.handleNewspaperResponse(msg);
      break;

    case WsMessageType.RESP_TYCOON_ROLE:
      ClientBridge.handleTycoonRoleResponse(msg);
      break;

    case WsMessageType.RESP_EMPIRE_FACILITIES:
      ClientBridge.handleEmpireResponse(msg);
      // The tree is now known, so the places this browser still holds can be
      // merged into it (N4, OB-33). The call is a no-op after the first one.
      void migrateLocalBookmarks(ctx);
      break;

    case WsMessageType.RESP_RESEARCH_INVENTORY: {
      const resInv = msg as WsRespResearchInventory;
      useBuildingStore.getState().setResearchInventory(resInv.data);
      break;
    }
    case WsMessageType.RESP_RESEARCH_DETAILS: {
      const resDet = msg as WsRespResearchDetails;
      useBuildingStore.getState().setResearchDetails(resDet.details);
      break;
    }

    case WsMessageType.RESP_SEARCH_CONNECTIONS: {
      const searchResp = msg as WsRespSearchConnections;
      if (useUiStore.getState().modal === 'supplierSearch') {
        useProfileStore.getState().setSupplierSearchResults(searchResp.results);
      } else {
        ClientBridge.updateConnectionResults(searchResp.results);
      }
      break;
    }

    case WsMessageType.RESP_CLUSTER_INFO: {
      const clusterResp = msg as WsRespClusterInfo;
      ClientBridge.handleClusterInfoResponse(clusterResp.clusterInfo);
      break;
    }
    case WsMessageType.RESP_CLUSTER_FACILITIES: {
      const facResp = msg as WsRespClusterFacilities;
      ClientBridge.handleClusterFacilitiesResponse(facResp.facilities);
      break;
    }

    case WsMessageType.RESP_GET_PROFILE: {
      const profile = (msg as WsRespGetProfile).profile;
      ClientBridge.log('Profile', `Profile loaded: ${profile.name} (${profile.levelName})`);
      const baseStats = ctx.currentTycoonData ?? {
        cash: profile.budget,
        incomePerHour: '0',
        ranking: profile.ranking,
        buildingCount: profile.facCount,
        maxBuildings: profile.facMax,
      };
      ClientBridge.updateTycoonStats({
        ...baseStats,
        username: ctx.storedUsername,
        prestige: profile.prestige,
        levelName: profile.levelName,
        levelTier: profile.levelTier,
        nobPoints: profile.nobPoints,
        area: profile.area,
      });
      ClientBridge.setProfile(profile);
      break;
    }

    case WsMessageType.RESP_ERROR: {
      const errorResp = msg as WsRespError;
      ClientBridge.log('Error', errorResp.errorMessage || 'Unknown error');
      ClientBridge.handleSearchMenuError(errorResp.errorMessage || 'Request failed');
      break;
    }
  }
}

/**
 * Ask the server for the current unread count.
 *
 * Fire-and-forget: the answer comes back as RESP_MAIL_UNREAD_COUNT through this
 * same dispatcher, which stores it. A lost request costs a stale badge, never a
 * lost message, so it is not worth a round-trip await.
 */
function requestMailUnreadCount(ctx: ClientHandlerContext): void {
  const req: WsReqMailGetUnreadCount = { type: WsMessageType.REQ_MAIL_GET_UNREAD_COUNT };
  ctx.sendMessage(req);
}
