import {
  WsMessageType,
  type WsMessage,
  type WsReqNewspaperBoard,
  type WsRespNewspaperBoard,
  type WsReqNewspaperPost,
  type WsRespNewspaperPost,
  type WsReqNewspaperIssues,
  type WsRespNewspaperIssues,
  type WsReqNewspaperIssue,
  type WsRespNewspaperIssue,
} from '../../shared/types';
import type { NewspaperTarget } from '../session/newspaper-handler';
import type { WsHandlerContext, WsHandler } from './types';
import { sendResponse } from './ws-utils';

function targetOf(
  req: WsReqNewspaperBoard | WsReqNewspaperPost | WsReqNewspaperIssues | WsReqNewspaperIssue,
): NewspaperTarget {
  return {
    paperName: req.paperName,
    townName: req.townName,
    isCapitol: req.isCapitol,
    buildingX: req.buildingX,
    buildingY: req.buildingY,
  };
}

export const handleNewspaperBoard: WsHandler = async (ctx: WsHandlerContext, msg: WsMessage): Promise<void> => {
  const req = msg as WsReqNewspaperBoard;
  console.log(`[Gateway] Reading newspaper: ${req.paperName}${req.path ? ` (${req.path})` : ''}`);
  const board = await ctx.session.getNewspaperBoard(targetOf(req), req.path);
  const response: WsRespNewspaperBoard = {
    type: WsMessageType.RESP_NEWSPAPER_BOARD,
    wsRequestId: msg.wsRequestId,
    board,
  };
  sendResponse(ctx.ws, response);
};

export const handleNewspaperPost: WsHandler = async (ctx: WsHandlerContext, msg: WsMessage): Promise<void> => {
  const req = msg as WsReqNewspaperPost;
  console.log(`[Gateway] Posting a column to ${req.paperName}`);
  const result = await ctx.session.postNewspaperColumn(
    targetOf(req), req.subject, req.body, req.replyToPath,
  );
  const response: WsRespNewspaperPost = {
    type: WsMessageType.RESP_NEWSPAPER_POST,
    wsRequestId: msg.wsRequestId,
    success: result.success,
    message: result.message,
    board: result.board,
  };
  sendResponse(ctx.ws, response);
};

export const handleNewspaperIssues: WsHandler = async (ctx: WsHandlerContext, msg: WsMessage): Promise<void> => {
  const req = msg as WsReqNewspaperIssues;
  console.log(`[Gateway] Reading the issue bar of ${req.paperName}`);
  const list = await ctx.session.getNewspaperIssues(targetOf(req));
  const response: WsRespNewspaperIssues = {
    type: WsMessageType.RESP_NEWSPAPER_ISSUES,
    wsRequestId: msg.wsRequestId,
    list,
  };
  sendResponse(ctx.ws, response);
};

export const handleNewspaperIssue: WsHandler = async (ctx: WsHandlerContext, msg: WsMessage): Promise<void> => {
  const req = msg as WsReqNewspaperIssue;
  console.log(`[Gateway] Reading issue ${req.folder} of ${req.paperName}`);
  const issue = await ctx.session.getNewspaperIssue(targetOf(req), req.folder);
  const response: WsRespNewspaperIssue = {
    type: WsMessageType.RESP_NEWSPAPER_ISSUE,
    wsRequestId: msg.wsRequestId,
    issue,
  };
  sendResponse(ctx.ws, response);
};
