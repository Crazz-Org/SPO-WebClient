/**
 * Push Dispatcher — extracted from StarpeaceSession.handlePush().
 *
 * Handles all server-initiated push commands (events sent without a request).
 * Each push type is parsed and forwarded as a typed WebSocket event.
 */

import type { RdoPacket, ChatUser } from '../../shared/types';
import {
  WsMessageType,
  parseAccDesc,
  type WsEventChatMsg,
  type WsEventTycoonUpdate,
  type WsEventEndOfPeriod,
  type WsEventRefreshDate,
  type WsEventRdoPush,
  type WsEventNewMail,
  type WsEventChatUserTyping,
  type WsEventChatChannelChange,
  type WsEventChatUserListChange,
  type WsEventShowNotification,
  type WsEventCacheRefresh,
  type WsEventTycoonRetired,
  type WsEventModelStatusChanged,
  type WsEventRefreshSeason,
  type WsEventMoveTo,
  type WsEventChannelListChange,
} from '../../shared/types';
import { RdoParser, RDO_PREFIX_STRIP } from '../../shared/rdo-types';

// ── Push Context ────────────────────────────────────────────────────────────

/**
 * Narrow interface for push dispatcher state access.
 * StarpeaceSession implements this so the dispatcher can read/write
 * the fields it needs without importing the full class.
 */
export interface PushContext {
  // ── Logging ──
  readonly log: {
    debug(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
  };

  // ── Event Emission ──
  emit(event: string, ...args: unknown[]): boolean;

  // ── InitClient synchronization ──
  getWaitingForInitClient(): boolean;
  setWaitingForInitClient(value: boolean): void;
  getInitClientResolver(): (() => void) | null;
  setInitClientResolver(value: (() => void) | null): void;

  // ── Session state (read/write) ──
  getVirtualDate(): number | null;
  setVirtualDate(value: number | null): void;
  getAccountMoney(): string | null;
  setAccountMoney(value: string): void;
  getFailureLevel(): number | null;
  setFailureLevel(value: number | null): void;
  getFTycoonProxyId(): number | null;
  setFTycoonProxyId(value: number | null): void;
  getCurrentChannel(): string;
  setCurrentChannel(channel: string): void;

  // ── Cached push data ──
  getLastRanking(): number;
  setLastRanking(value: number): void;
  getLastBuildingCount(): number;
  setLastBuildingCount(value: number): void;
  getLastMaxBuildings(): number;
  setLastMaxBuildings(value: number): void;

  // ── ServerBusy from push (ModelStatusChanged) ──
  setServerBusyFromPush(busy: boolean): void;

  // ── Season ──
  setWorldSeason(value: number | null): void;
}

// ── Dispatcher ──────────────────────────────────────────────────────────────

/**
 * Dispatch a server-initiated push command to the appropriate handler.
 * Each push type is parsed and emitted as a typed WebSocket event.
 */
export function dispatchPush(ctx: PushContext, _socketName: string, packet: RdoPacket): void {
  // CRITICAL: Detect InitClient push during login
  if (ctx.getWaitingForInitClient()) {
    const hasInitClient = packet.member === 'InitClient' ||
      (packet.raw && packet.raw.includes('InitClient'));
    if (hasInitClient) {
      ctx.log.debug(`[Session] Server sent InitClient push (detected in ${packet.member ? 'member' : 'raw'})`);

      // Parse InitClient data
      // Example: C sel 44917624 call InitClient "*" "@78006","%419278163478","#0","#223892356";
      // Args: [Date, Money, FailureLevel, fTycoonProxyId]
      if (packet.args && packet.args.length >= 4) {
        try {
          ctx.setVirtualDate(RdoParser.asFloat(packet.args[0]));
          ctx.setAccountMoney(RdoParser.getValue(packet.args[1]));
          ctx.setFailureLevel(RdoParser.asInt(packet.args[2]));
          ctx.setFTycoonProxyId(RdoParser.asInt(packet.args[3]));

          ctx.log.debug(`[Session] InitClient parsed - Date: ${ctx.getVirtualDate()}, Money: ${ctx.getAccountMoney()}, FailureLevel: ${ctx.getFailureLevel()}, fTycoonProxyId: ${ctx.getFTycoonProxyId()}`);

          // Forward initial game date to client
          const vDate = ctx.getVirtualDate();
          if (vDate !== null) {
            ctx.emit('ws_event', {
              type: WsMessageType.EVENT_REFRESH_DATE,
              dateDouble: vDate,
            } as WsEventRefreshDate);
          }
        } catch (error) {
          ctx.log.error(`[Session] Failed to parse InitClient data:`, error);
          ctx.log.debug(`[Session] Raw args:`, packet.args);
        }
      } else {
        ctx.log.warn(`[Session] InitClient packet has insufficient args (expected 4, got ${packet.args?.length || 0})`);
      }

      ctx.setWaitingForInitClient(false);
      const resolver = ctx.getInitClientResolver();
      if (resolver) {
        resolver();
        ctx.setInitClientResolver(null);
      }
      return;
    }
  }

  // Server-initiated SetLanguage (just log it, no action needed)
  if (packet.member === 'SetLanguage') {
    ctx.log.debug(`[Session] Server sent SetLanguage push (ignored)`);
    return;
  }

  // NewMail notification — push from InterfaceServer via fClientEventsProxy.NewMail(MsgCount)
  if (packet.member === 'NewMail') {
    const count = packet.args?.[0] ? parseInt(packet.args[0].replace(/^#/, ''), 10) : 0;
    ctx.log.debug(`[Session] NewMail notification: ${count} unread message(s)`);
    const event: WsEventNewMail = {
      type: WsMessageType.EVENT_NEW_MAIL,
      unreadCount: count,
    };
    ctx.emit('ws_event', event);
    return;
  }

  // 1. ChatMsg parsing
  if (packet.member === 'ChatMsg') {
    ctx.log.debug(`[Chat] Raw ChatMsg packet:`, packet);
    ctx.log.debug(`[Chat] Args:`, packet.args);
    ctx.log.debug(`[Chat] Args length:`, packet.args?.length);

    if (packet.args && packet.args.length >= 2) {
      let from = packet.args[0].replace(RDO_PREFIX_STRIP, '');
      const message = packet.args[1].replace(RDO_PREFIX_STRIP, '');

      const fromParts = from.split('/');
      if (fromParts.length > 1) {
        from = fromParts[0];
      }

      ctx.log.debug(`[Chat] Parsed - from: "${from}", message: "${message}"`);

      const accDesc = fromParts.length > 1 ? parseAccDesc(fromParts[1]) : null;

      const event: WsEventChatMsg = {
        type: WsMessageType.EVENT_CHAT_MSG,
        channel: ctx.getCurrentChannel() || 'Lobby',
        from: from,
        message: message,
        ...(accDesc ? { nobilityTier: accDesc.nobilityTier, modifiers: accDesc.modifiers } : {}),
      };

      ctx.log.debug(`[Chat] Emitting event:`, event);
      ctx.emit('ws_event', event);
      return;
    } else {
      ctx.log.warn(`[Chat] ChatMsg packet has insufficient args:`, packet);
    }
  }

  // 2. NotifyMsgCompositionState - User typing status
  if (packet.member === 'NotifyMsgCompositionState' && packet.args && packet.args.length >= 2) {
    const username = packet.args[0].replace(RDO_PREFIX_STRIP, '');
    const statusStr = packet.args[1].replace(RDO_PREFIX_STRIP, '');
    const isTyping = statusStr === '1';

    ctx.log.debug(`[Chat] ${username} is ${isTyping ? 'typing' : 'idle'}`);

    const event: WsEventChatUserTyping = {
      type: WsMessageType.EVENT_CHAT_USER_TYPING,
      username,
      isTyping,
    };

    ctx.emit('ws_event', event);
    return;
  }

  // 3. NotifyChannelChange - Channel switched
  if (packet.member === 'NotifyChannelChange' && packet.args && packet.args.length >= 1) {
    const channelName = packet.args[0].replace(RDO_PREFIX_STRIP, '');
    ctx.setCurrentChannel(channelName);

    ctx.log.debug(`[Chat] Channel changed to: ${channelName || 'Lobby'}`);

    const event: WsEventChatChannelChange = {
      type: WsMessageType.EVENT_CHAT_CHANNEL_CHANGE,
      channelName: channelName || 'Lobby',
    };

    ctx.emit('ws_event', event);
    return;
  }

  // 4. NotifyUserListChange - User joined/left
  // Delphi sends Name as "name", "name/id", or "name/id/afk" — handle all formats
  if (packet.member === 'NotifyUserListChange' && packet.args && packet.args.length >= 2) {
    const userInfo = packet.args[0].replace(RDO_PREFIX_STRIP, '');
    const actionCode = packet.args[1].replace(RDO_PREFIX_STRIP, '');
    const userParts = userInfo.split('/');

    if (userParts[0]?.trim()) {
      const accDescStr = userParts[1] ?? '0';
      const user: ChatUser = {
        name: userParts[0],
        id: accDescStr,
        status: parseInt(userParts[2], 10) || 0,
        ...parseAccDesc(accDescStr),
      };

      const action = actionCode === '0' ? 'JOIN' : 'LEAVE';
      ctx.log.debug(`[Chat] User ${user.name} ${action === 'JOIN' ? 'joined' : 'left'} (format: ${userParts.length}-field)`);

      const event: WsEventChatUserListChange = {
        type: WsMessageType.EVENT_CHAT_USER_LIST_CHANGE,
        user,
        action,
      };

      ctx.emit('ws_event', event);
    }
    return;
  }

  // 5. RefreshTycoon parsing
  if (packet.member === 'RefreshTycoon' && packet.args && packet.args.length >= 5) {
    try {
      const cleanArgs = packet.args.map(arg => arg.replace(RDO_PREFIX_STRIP, ''));

      const tycoonUpdate: WsEventTycoonUpdate = {
        type: WsMessageType.EVENT_TYCOON_UPDATE,
        cash: cleanArgs[0],
        incomePerHour: cleanArgs[1],
        ranking: parseInt(cleanArgs[2], 10) || 0,
        buildingCount: parseInt(cleanArgs[3], 10) || 0,
        maxBuildings: parseInt(cleanArgs[4], 10) || 0,
        failureLevel: ctx.getFailureLevel() ?? undefined,
      };

      // Cache push data for profile queries
      ctx.setAccountMoney(tycoonUpdate.cash);
      ctx.setLastRanking(tycoonUpdate.ranking);
      ctx.setLastBuildingCount(tycoonUpdate.buildingCount);
      ctx.setLastMaxBuildings(tycoonUpdate.maxBuildings);

      ctx.log.debug(`[Push] Tycoon Update: Cash=${tycoonUpdate.cash}, Income/h=${tycoonUpdate.incomePerHour}, Rank=${tycoonUpdate.ranking}, Buildings=${tycoonUpdate.buildingCount}/${tycoonUpdate.maxBuildings}`);
      ctx.emit('ws_event', tycoonUpdate);
      return;
    } catch (e) {
      ctx.log.error('[Push] Error parsing RefreshTycoon:', e);
      // Fallback to generic push
    }
  }

  // 6. EndOfPeriod — server signals a financial period has ended
  if (packet.member === 'EndOfPeriod') {
    const failureLevel = packet.args?.[0] ? RdoParser.asInt(packet.args[0]) : 0;
    ctx.setFailureLevel(failureLevel);
    ctx.log.debug(`[Push] EndOfPeriod received (failureLevel=${failureLevel})`);
    const endOfPeriodEvent: WsEventEndOfPeriod = {
      type: WsMessageType.EVENT_END_OF_PERIOD,
      failureLevel,
    };
    ctx.emit('ws_event', endOfPeriodEvent);
    return;
  }

  // 7. RefreshDate — server sends updated virtual date periodically
  if (packet.member === 'RefreshDate' && packet.args && packet.args.length >= 1) {
    const dateDouble = RdoParser.asFloat(packet.args[0]);
    ctx.setVirtualDate(dateDouble);
    ctx.log.debug(`[Push] RefreshDate: ${dateDouble}`);
    const dateEvent: WsEventRefreshDate = {
      type: WsMessageType.EVENT_REFRESH_DATE,
      dateDouble,
    };
    ctx.emit('ws_event', dateEvent);
    return;
  }

  // 8. ShowNotification — server game notification (research complete, events, etc.)
  if (packet.member === 'ShowNotification') {
    const kind = packet.args?.[0] ? RdoParser.asInt(packet.args[0]) : 0;
    const title = packet.args?.[1] ? RdoParser.getValue(packet.args[1]) : '';
    const body = packet.args?.[2] ? RdoParser.getValue(packet.args[2]) : '';
    const options = packet.args?.[3] ? RdoParser.asInt(packet.args[3]) : 0;
    ctx.log.debug(`[Push] ShowNotification: kind=${kind}, title="${title}", body="${body}", options=${options}`);
    const notifEvent: WsEventShowNotification = {
      type: WsMessageType.EVENT_SHOW_NOTIFICATION,
      kind,
      title,
      body,
      options,
    };
    ctx.emit('ws_event', notifEvent);
    return;
  }

  // 9. Refresh — cache proxy invalidation (server tells client to re-fetch building data)
  if (packet.member === 'Refresh' && (!packet.args || packet.args.length === 0)) {
    ctx.log.debug('[Push] Cache Refresh received — building data invalidated');
    const refreshEvent: WsEventCacheRefresh = {
      type: WsMessageType.EVENT_CACHE_REFRESH,
    };
    ctx.emit('ws_event', refreshEvent);
    return;
  }

  // 10. TycoonRetired — player bankrupt / removed from game (Delphi TycoonRetired push)
  if (packet.member === 'TycoonRetired') {
    const failureLevel = packet.args?.[0] ? RdoParser.asInt(packet.args[0]) : 0;
    ctx.log.warn(`[Push] TycoonRetired! failureLevel=${failureLevel}`);
    const retiredEvent: WsEventTycoonRetired = {
      type: WsMessageType.EVENT_TYCOON_RETIRED,
      failureLevel,
    };
    ctx.emit('ws_event', retiredEvent);
    return;
  }

  // 11. ModelStatusChanged — instant ServerBusy notification (Delphi ModelStatusChanged push)
  //     mstBusy=0, mstNotBusy=1, mstError=2
  if (packet.member === 'ModelStatusChanged') {
    const status = packet.args?.[0] ? RdoParser.asInt(packet.args[0]) : 1;
    const busy = status === 0; // mstBusy = 0
    ctx.log.debug(`[Push] ModelStatusChanged: status=${status} (busy=${busy})`);
    ctx.setServerBusyFromPush(busy);
    const statusEvent: WsEventModelStatusChanged = {
      type: WsMessageType.EVENT_MODEL_STATUS_CHANGED,
      status,
    };
    ctx.emit('ws_event', statusEvent);
    return;
  }

  // 12. RefreshSeason — season changed, affects terrain textures (Delphi RefreshSeason push)
  if (packet.member === 'RefreshSeason' && packet.args && packet.args.length >= 1) {
    const season = RdoParser.asInt(packet.args[0]);
    ctx.setWorldSeason(season);
    ctx.log.debug(`[Push] RefreshSeason: ${season}`);
    const seasonEvent: WsEventRefreshSeason = {
      type: WsMessageType.EVENT_REFRESH_SEASON,
      season,
    };
    ctx.emit('ws_event', seasonEvent);
    return;
  }

  // 13. MoveTo — server requests camera pan (Delphi MoveTo push)
  if (packet.member === 'MoveTo' && packet.args && packet.args.length >= 2) {
    const x = RdoParser.asInt(packet.args[0]);
    const y = RdoParser.asInt(packet.args[1]);
    ctx.log.debug(`[Push] MoveTo: (${x}, ${y})`);
    const moveEvent: WsEventMoveTo = {
      type: WsMessageType.EVENT_MOVE_TO,
      x,
      y,
    };
    ctx.emit('ws_event', moveEvent);
    return;
  }

  // 14. NotifyChannelListChange — chat channel created/destroyed (Delphi NotifyChannelListChange push)
  if (packet.member === 'NotifyChannelListChange' && packet.args && packet.args.length >= 3) {
    const name = RdoParser.getValue(packet.args[0]);
    const password = RdoParser.getValue(packet.args[1]);
    const change = RdoParser.asInt(packet.args[2]);
    ctx.log.debug(`[Push] NotifyChannelListChange: name="${name}" change=${change}`);
    const channelEvent: WsEventChannelListChange = {
      type: WsMessageType.EVENT_CHANNEL_LIST_CHANGE,
      name,
      password,
      change,
    };
    ctx.emit('ws_event', channelEvent);
    return;
  }

  // 15. Generic push fallback (for unhandled events)
  const event: WsEventRdoPush = {
    type: WsMessageType.EVENT_RDO_PUSH,
    rawPacket: packet.raw,
  };

  ctx.emit('ws_event', event);
}
