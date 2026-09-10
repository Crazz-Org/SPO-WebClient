import type { WsHandlerContext } from './types';
import { sendResponse } from './ws-utils';
import { toProxyUrl } from '../../shared/proxy-utils';
import { mailStampPath } from '../../shared/mail-stamp';
import type {
  WsMessage,
  WsReqMailGetFolder,
  WsReqMailReadMessage,
  WsReqMailCompose,
  WsReqMailSaveDraft,
  WsReqMailDelete,
  WsRespMailConnected,
  WsRespMailFolder,
  WsRespMailMessage,
  WsRespMailSent,
  WsRespMailDraftSaved,
  WsRespMailDeleted,
  WsRespMailUnreadCount,
} from '../../shared/types';
import { WsMessageType } from '../../shared/types';

export async function handleMailConnect(ctx: WsHandlerContext, msg: WsMessage): Promise<void> {
  await ctx.session.connectMailService();
  const unreadCount = await ctx.session.getMailUnreadCount();
  const response: WsRespMailConnected = {
    type: WsMessageType.RESP_MAIL_CONNECTED,
    wsRequestId: msg.wsRequestId,
    unreadCount,
  };
  sendResponse(ctx.ws, response);
}

export async function handleMailGetFolder(ctx: WsHandlerContext, msg: WsMessage): Promise<void> {
  const req = msg as WsReqMailGetFolder;
  const messages = await ctx.session.getMailFolder(req.folder);
  const response: WsRespMailFolder = {
    type: WsMessageType.RESP_MAIL_FOLDER,
    wsRequestId: msg.wsRequestId,
    folder: req.folder,
    messages,
  };
  sendResponse(ctx.ws, response);
}

export async function handleMailReadMessage(ctx: WsHandlerContext, msg: WsMessage): Promise<void> {
  const req = msg as WsReqMailReadMessage;
  const message = await ctx.session.readMailMessage(req.folder, req.messageId);
  // The stamp picture lives on the world's IIS (MessageHeader.asp:167-169); only the gateway
  // knows that host, so the proxied URL is attached here. No world → no URL → no picture.
  const worldIp = ctx.session.currentWorldInfo?.ip;
  const response: WsRespMailMessage = {
    type: WsMessageType.RESP_MAIL_MESSAGE,
    wsRequestId: msg.wsRequestId,
    message: worldIp ? { ...message, stampUrl: toProxyUrl(mailStampPath(message.stamp), worldIp) } : message,
  };
  sendResponse(ctx.ws, response);
}

export async function handleMailCompose(ctx: WsHandlerContext, msg: WsMessage): Promise<void> {
  const req = msg as WsReqMailCompose;
  const success = await ctx.session.composeMail(req.to, req.subject, req.body, req.headers, req.existingDraftId);
  const response: WsRespMailSent = {
    type: WsMessageType.RESP_MAIL_SENT,
    wsRequestId: msg.wsRequestId,
    success,
    message: success ? 'Message sent' : 'Failed to send message',
  };
  sendResponse(ctx.ws, response);
}

export async function handleMailSaveDraft(ctx: WsHandlerContext, msg: WsMessage): Promise<void> {
  const req = msg as WsReqMailSaveDraft;
  const success = await ctx.session.saveDraft(
    req.to,
    req.subject,
    req.body,
    req.headers,
    req.existingDraftId
  );
  const response: WsRespMailDraftSaved = {
    type: WsMessageType.RESP_MAIL_DRAFT_SAVED,
    wsRequestId: msg.wsRequestId,
    success,
    message: success ? 'Draft saved' : 'Failed to save draft',
  };
  sendResponse(ctx.ws, response);
}

export async function handleMailDelete(ctx: WsHandlerContext, msg: WsMessage): Promise<void> {
  const req = msg as WsReqMailDelete;
  await ctx.session.deleteMailMessage(req.folder, req.messageId);
  const response: WsRespMailDeleted = {
    type: WsMessageType.RESP_MAIL_DELETED,
    wsRequestId: msg.wsRequestId,
    success: true,
  };
  sendResponse(ctx.ws, response);
}

export async function handleMailGetUnreadCount(ctx: WsHandlerContext, msg: WsMessage): Promise<void> {
  const count = await ctx.session.getMailUnreadCount();
  const response: WsRespMailUnreadCount = {
    type: WsMessageType.RESP_MAIL_UNREAD_COUNT,
    wsRequestId: msg.wsRequestId,
    count,
  };
  sendResponse(ctx.ws, response);
}
