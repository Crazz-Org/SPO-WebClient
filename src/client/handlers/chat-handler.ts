/**
 * Chat Handler — extracted from StarpeaceClient.
 *
 * Handles chat messages, typing status, channel management, and user list.
 */

import {
  WsMessageType,
  WsMessage,
  WsReqChatSendMessage,
  WsReqChatGetUsers,
  WsRespChatUserList,
  WsReqChatGetChannels,
  WsRespChatChannelList,
  WsReqChatGetChannelInfo,
  WsRespChatChannelInfo,
  WsReqChatJoinChannel,
  WsReqChatCreateChannel,
  WsReqChatTypingStatus,
  WsReqChatAway,
  WsReqChatChase,
  WsReqChatStopChase
} from '../../shared/types';
import { toErrorMessage } from '../../shared/error-utils';
import { ClientBridge } from '../bridge/client-bridge';
import { useChatStore } from '../store/chat-store';
import { loadDefaultChannel } from '../store/default-channel';
import type { ClientHandlerContext } from './client-context';

export async function sendChatMessage(ctx: ClientHandlerContext, message: string): Promise<void> {
  if (ctx.isSendingChatMessage) return;

  // GM chat: messages starting with /gm are broadcast to all players
  if (message.startsWith('/gm ')) {
    const gmMessage = message.substring(4).trim();
    if (gmMessage) {
      ctx.sendMessage({
        type: WsMessageType.REQ_GM_CHAT_SEND,
        message: gmMessage,
      } as WsMessage);
    }
    return;
  }

  ctx.isSendingChatMessage = true;

  try {
    const req: WsReqChatSendMessage = {
      type: WsMessageType.REQ_CHAT_SEND_MESSAGE,
      message
    };
    await ctx.sendRequest(req);
  } catch (err: unknown) {
    ClientBridge.log('Error', `Failed to send message: ${toErrorMessage(err)}`);
  } finally {
    ctx.isSendingChatMessage = false;
  }
}

/**
 * Tell the world whether we are composing a message.
 *
 * Fire-and-forget on purpose: the gateway turns this into `MsgCompositionChanged`,
 * a void RDO push that answers nothing, and a lost notice must never cost the
 * user a keystroke. Only the two transitions go out — never one frame per
 * character — which is what the flag guards.
 */
export function setTypingStatus(ctx: ClientHandlerContext, isTyping: boolean): void {
  if (ctx.isTypingInChat === isTyping) return;
  ctx.isTypingInChat = isTyping;

  const req: WsReqChatTypingStatus = {
    type: WsMessageType.REQ_CHAT_TYPING_STATUS,
    isTyping,
  };
  ctx.sendMessage(req);
}

/**
 * Announce the away state (`/afk`, composition state 2). Fire-and-forget, like
 * `setTypingStatus`: the gateway turns this into a void `MsgCompositionChanged` push.
 *
 * Clearing `isTypingInChat` is the whole "typing again clears it" mechanism: away is
 * not "composing", so the next keystroke's `setTypingStatus(ctx, true)` is a real
 * transition rather than a no-op the dedupe swallows — which is what clears state 2
 * server-side.
 */
export function setAwayStatus(ctx: ClientHandlerContext): void {
  const req: WsReqChatAway = {
    type: WsMessageType.REQ_CHAT_AWAY,
  };
  ctx.sendMessage(req);
  ctx.isTypingInChat = false;
}

export async function requestUserList(ctx: ClientHandlerContext): Promise<void> {
  try {
    const req: WsReqChatGetUsers = {
      type: WsMessageType.REQ_CHAT_GET_USERS
    };
    const resp = (await ctx.sendRequest(req)) as WsRespChatUserList;
    ClientBridge.setChatUsers(resp.users);
  } catch (err: unknown) {
    ClientBridge.log('Error', `Failed to get user list: ${toErrorMessage(err)}`);
  }
}

/**
 * Join the player's default channel if one is pinned, otherwise today's unconditional
 * Lobby join. A pinned name absent from the channel list is recreated (`createChannel`
 * falls through to `JoinChannel` for a name already taken -- see the note on
 * `createChannel` below), and any failure to land in the pinned channel falls back to
 * Lobby with a visible notice, never a silent failure.
 */
export async function initChatChannels(ctx: ClientHandlerContext): Promise<void> {
  await requestChannelList(ctx);

  const preferred = loadDefaultChannel();
  if (preferred && preferred !== 'Lobby') {
    const exists = useChatStore.getState().channels.some((ch) => ch.name === preferred);
    if (exists) {
      await joinChannel(ctx, preferred);
      await requestChannelInfo(ctx, preferred);
    } else {
      try {
        await createChannel(ctx, preferred, '');
      } catch {
        /* falls through to the Lobby fallback below */
      }
    }

    if (useChatStore.getState().currentChannel === preferred) {
      await requestUserList(ctx);
      return;
    }

    ctx.showNotification(`Default channel "${preferred}" is unavailable — you are in Lobby`, 'warning');
  }

  await joinChannel(ctx, '');
  ClientBridge.setCurrentChannel('Lobby');
  await requestUserList(ctx);
}

async function requestChannelList(ctx: ClientHandlerContext): Promise<void> {
  try {
    const req: WsReqChatGetChannels = {
      type: WsMessageType.REQ_CHAT_GET_CHANNELS
    };
    const resp = (await ctx.sendRequest(req)) as WsRespChatChannelList;
    ClientBridge.setChatChannels(resp.channels);
  } catch (err: unknown) {
    ClientBridge.log('Error', `Failed to get channel list: ${toErrorMessage(err)}`);
  }
}

/**
 * Fetch the channel's description (creator, member roster, password status) and
 * store it under the display name the caller used (`'Lobby'` for the default
 * channel), matching the keys `channels`/`currentChannel` already use in the
 * store. The server itself expects the wire name -- `''` for Lobby, same as
 * `joinChannel` -- so that translation happens here rather than at the call site.
 */
export async function requestChannelInfo(ctx: ClientHandlerContext, channelName: string): Promise<void> {
  ClientBridge.setChannelInfo(channelName, 'Loading...');
  try {
    const req: WsReqChatGetChannelInfo = {
      type: WsMessageType.REQ_CHAT_GET_CHANNEL_INFO,
      channelName: channelName === 'Lobby' ? '' : channelName,
    };
    const resp = (await ctx.sendRequest(req)) as WsRespChatChannelInfo;
    ClientBridge.setChannelInfo(channelName, resp.info);
  } catch (err: unknown) {
    ClientBridge.log('Error', `Failed to get channel info: ${toErrorMessage(err)}`);
    ClientBridge.setChannelInfo(channelName, '');
  }
}

export async function joinChannel(ctx: ClientHandlerContext, channelName: string, password?: string): Promise<void> {
  if (ctx.isJoiningChannel) return;

  ctx.isJoiningChannel = true;
  const previousChannel = useChatStore.getState().currentChannel;

  try {
    ClientBridge.log('Chat', `Joining channel: ${channelName || 'Lobby'}`);
    ClientBridge.setCurrentChannel(channelName);
    const req: WsReqChatJoinChannel = {
      type: WsMessageType.REQ_CHAT_JOIN_CHANNEL,
      channelName,
      ...(password ? { password } : {}),
    };
    await ctx.sendRequest(req);
  } catch (err: unknown) {
    // The gateway's sentence is the player-readable one; `message` has already
    // been flattened to getErrorMessage(code) by client.ts:1090-1097 (INV-8).
    const { serverMessage } = err as { serverMessage?: string };
    const text = serverMessage || toErrorMessage(err);
    ClientBridge.setCurrentChannel(previousChannel);
    ClientBridge.log('Error', `Failed to join channel: ${text}`);
    ctx.showNotification(text, 'error');
  } finally {
    ctx.isJoiningChannel = false;
  }
}

/**
 * Create a named channel and stand in it.
 *
 * Unlike `joinChannel`, a failure is **rethrown**: the modal must stay open and
 * show the server's own reason ("already exists and its password does not
 * match"), so the player can correct the form.
 *
 * The list is updated by insertion, not by re-fetching — what the reference
 * client did (`ChatHandler.pas:284-287` calls `AddChannel` on the broadcast and
 * never re-asks). It costs no round trip, de-dups a name that was already
 * listed, and cannot race an in-flight `GetChannelList` the way a wholesale
 * `setChannels` would.
 *
 * `channelName` is passed raw: `requestChannelInfo` does its own `'Lobby'` → `''`
 * translation, and a channel a player *names* "Lobby" is refused client-side.
 */
export async function createChannel(
  ctx: ClientHandlerContext,
  channelName: string,
  password: string,
): Promise<void> {
  const req: WsReqChatCreateChannel = {
    type: WsMessageType.REQ_CHAT_CREATE_CHANNEL,
    channelName,
    password,
  };
  await ctx.sendRequest(req);
  ClientBridge.addChatChannel(channelName);
  ClientBridge.setCurrentChannel(channelName);
  ClientBridge.log('Chat', `Created channel: ${channelName}`);
  await requestChannelInfo(ctx, channelName);
}

/**
 * Start following another player's camera.
 *
 * The gateway turns this into `Chase( UserName )` on the Interface Server
 * (InterfaceServer.pas:189) and rejects when the server refuses. Only a server
 * that accepted puts the badge up — Voyager likewise only remembers
 * `fChasedUser` on NOERROR (ServerCnxHandler.pas:1873-1897).
 */
export async function chaseUser(ctx: ClientHandlerContext, userName: string): Promise<void> {
  try {
    const req: WsReqChatChase = {
      type: WsMessageType.REQ_CHAT_CHASE,
      userName,
    };
    await ctx.sendRequest(req);
    ClientBridge.setChasedUser(userName);
    ClientBridge.log('Chat', `Now following ${userName}`);
  } catch (err: unknown) {
    ClientBridge.log('Error', `Failed to follow ${userName}: ${toErrorMessage(err)}`);
    ctx.showNotification(`Cannot follow ${userName}`, 'error');
  }
}

/**
 * Stop following.
 *
 * The badge is cleared in a `finally`, regardless of the server's answer —
 * Voyager raises `evnUserChaseAborted` the same way
 * (ServerCnxHandler.pas:1900-1921). A failed stop must never leave the player
 * stuck with a badge they cannot dismiss.
 */
export async function stopChase(ctx: ClientHandlerContext): Promise<void> {
  try {
    const req: WsReqChatStopChase = {
      type: WsMessageType.REQ_CHAT_STOP_CHASE,
    };
    await ctx.sendRequest(req);
    ClientBridge.log('Chat', 'Stopped following');
  } catch (err: unknown) {
    ClientBridge.log('Error', `Failed to stop following: ${toErrorMessage(err)}`);
  } finally {
    ClientBridge.setChasedUser(null);
  }
}
