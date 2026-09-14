import { WebSocket } from 'ws';
import {
  WsMessageType,
  type WsMessage,
  type WsReqChatGetChannelInfo,
  type WsReqChatJoinChannel,
  type WsReqChatCreateChannel,
  type WsReqChatSendMessage,
  type WsReqChatTypingStatus,
  type WsReqChatChase,
  type WsReqGmChatSend,
  type WsRespChatChannelInfo,
  type WsRespChatChannelList,
  type WsRespChatSuccess,
  type WsRespChatUserList,
  type WsEventChatMsg,
} from '../../shared/types';
import type { WsHandlerContext, WsHandler } from './types';
import { sendResponse, sendError } from './ws-utils';
import { ChannelJoinError } from '../session/chat-handler';

export const handleChatGetUsers: WsHandler = async (ctx: WsHandlerContext, msg: WsMessage): Promise<void> => {
  console.log('[Gateway] Getting chat user list');
  const users = await ctx.session.getChatUserList();
  const response: WsRespChatUserList = {
    type: WsMessageType.RESP_CHAT_USER_LIST,
    wsRequestId: msg.wsRequestId,
    users,
  };
  sendResponse(ctx.ws, response);
};

export const handleChatGetChannels: WsHandler = async (ctx: WsHandlerContext, msg: WsMessage): Promise<void> => {
  console.log('[Gateway] Getting chat channel list');
  const channels = await ctx.session.getChatChannelList();
  const response: WsRespChatChannelList = {
    type: WsMessageType.RESP_CHAT_CHANNEL_LIST,
    wsRequestId: msg.wsRequestId,
    channels,
  };
  sendResponse(ctx.ws, response);
};

export const handleChatGetChannelInfo: WsHandler = async (ctx: WsHandlerContext, msg: WsMessage): Promise<void> => {
  const req = msg as WsReqChatGetChannelInfo;
  console.log(`[Gateway] Getting channel info: ${req.channelName}`);
  const info = await ctx.session.getChatChannelInfo(req.channelName);
  const response: WsRespChatChannelInfo = {
    type: WsMessageType.RESP_CHAT_CHANNEL_INFO,
    wsRequestId: msg.wsRequestId,
    info,
  };
  sendResponse(ctx.ws, response);
};

export const handleChatJoinChannel: WsHandler = async (ctx: WsHandlerContext, msg: WsMessage): Promise<void> => {
  const req = msg as WsReqChatJoinChannel;
  console.log(`[Gateway] Joining channel: ${req.channelName || 'Lobby'}`);
  try {
    await ctx.session.joinChatChannel(req.channelName, req.password ?? '');
  } catch (err: unknown) {
    if (err instanceof ChannelJoinError) {
      sendError(ctx.ws, msg.wsRequestId, err.message, err.code);
      return;
    }
    throw err;
  }
  const response: WsRespChatSuccess = {
    type: WsMessageType.RESP_CHAT_SUCCESS,
    wsRequestId: msg.wsRequestId,
  };
  sendResponse(ctx.ws, response);
};

export const handleChatCreateChannel: WsHandler = async (ctx: WsHandlerContext, msg: WsMessage): Promise<void> => {
  const req = msg as WsReqChatCreateChannel;
  console.log(`[Gateway] Creating channel: ${req.channelName}`);
  await ctx.session.createChatChannel(req.channelName, req.password);
  const response: WsRespChatSuccess = {
    type: WsMessageType.RESP_CHAT_SUCCESS,
    wsRequestId: msg.wsRequestId,
  };
  sendResponse(ctx.ws, response);
};

export const handleChatSendMessage: WsHandler = async (ctx: WsHandlerContext, msg: WsMessage): Promise<void> => {
  const req = msg as WsReqChatSendMessage;
  await ctx.session.sendChatMessage(req.message);
  const response: WsRespChatSuccess = {
    type: WsMessageType.RESP_CHAT_SUCCESS,
    wsRequestId: msg.wsRequestId,
  };
  sendResponse(ctx.ws, response);
};

export const handleChatTypingStatus: WsHandler = async (ctx: WsHandlerContext, msg: WsMessage): Promise<void> => {
  const req = msg as WsReqChatTypingStatus;
  await ctx.session.setChatTypingStatus(req.isTyping);
  // No response needed for typing status
};

export const handleChatAway: WsHandler = async (ctx: WsHandlerContext, msg: WsMessage): Promise<void> => {
  await ctx.session.setChatAway();
  // No response needed — mirrors handleChatTypingStatus
};

export const handleChatChase: WsHandler = async (ctx: WsHandlerContext, msg: WsMessage): Promise<void> => {
  const req = msg as WsReqChatChase;
  console.log(`[Gateway] Chasing user: ${req.userName}`);
  await ctx.session.chaseUser(req.userName);
  const response: WsRespChatSuccess = {
    type: WsMessageType.RESP_CHAT_SUCCESS,
    wsRequestId: msg.wsRequestId,
  };
  sendResponse(ctx.ws, response);
};

export const handleChatStopChase: WsHandler = async (ctx: WsHandlerContext, msg: WsMessage): Promise<void> => {
  console.log('[Gateway] Stopping chase');
  await ctx.session.stopChase();
  const response: WsRespChatSuccess = {
    type: WsMessageType.RESP_CHAT_SUCCESS,
    wsRequestId: msg.wsRequestId,
  };
  sendResponse(ctx.ws, response);
};

export const handleGmChatSend: WsHandler = async (ctx: WsHandlerContext, msg: WsMessage): Promise<void> => {
  const req = msg as WsReqGmChatSend;
  const senderName = ctx.connectedClients.get(ctx.ws) || 'Unknown';

  if (!ctx.gmUsernames.has(senderName)) {
    sendError(ctx.ws, msg.wsRequestId, 'Only Game Masters can send GM messages');
    return;
  }

  // Broadcast to all connected clients
  const gmEvent: WsEventChatMsg = {
    type: WsMessageType.EVENT_CHAT_MSG,
    channel: 'GM',
    from: senderName,
    message: req.message,
    isGM: true,
  };
  const gmPayload = JSON.stringify(gmEvent);
  for (const [clientWs] of ctx.connectedClients) {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(gmPayload);
    }
  }
};
