import { AuthError } from '../../shared/auth-error';
import * as ErrorCodes from '../../shared/error-codes';
import { getDirectoryErrorMessage } from '../../shared/directory-error-codes';
import { toErrorMessage } from '../../shared/error-utils';
import {
  WsMessageType,
  type WsMessage,
  type WsReqAuthCheck,
  type WsReqConnectDirectory,
  type WsReqLoginWorld,
  type WsReqLogout,
  type WsReqSelectCompany,
  type WsReqSwitchCompany,
  type WsRespAuthSuccess,
  type WsRespConnectSuccess,
  type WsRespLoginSuccess,
  type WsRespLogout,
  type WsRespRdoResult,
} from '../../shared/types';
import type { WsHandlerContext, WsHandler } from './types';
import { sendResponse, sendError } from './ws-utils';

export const handleAuthCheck: WsHandler = async (ctx: WsHandlerContext, msg: WsMessage): Promise<void> => {
  const req = msg as WsReqAuthCheck;
  if (!req.username || !req.password) {
    sendError(ctx.ws, msg.wsRequestId, 'Username and password required', ErrorCodes.ERROR_InvalidLogonData);
    return;
  }
  try {
    await ctx.session.checkAuth(req.username, req.password);
    const response: WsRespAuthSuccess = {
      type: WsMessageType.RESP_AUTH_SUCCESS,
      wsRequestId: msg.wsRequestId,
    };
    sendResponse(ctx.ws, response);
  } catch (err: unknown) {
    if (err instanceof AuthError) {
      // `authCode` comes from RDOLogonUser: it is a DIR_* code
      // (DirectoryServerProtocol.pas:9-20), not an ERROR_* one.
      sendError(ctx.ws, msg.wsRequestId, getDirectoryErrorMessage(err.authCode), err.authCode);
    } else {
      throw err;
    }
  }
};

export const handleConnectDirectory: WsHandler = async (ctx: WsHandlerContext, msg: WsMessage): Promise<void> => {
  const req = msg as WsReqConnectDirectory;
  if (!req.username || !req.password) {
    sendError(ctx.ws, msg.wsRequestId, 'Username and Password required for Directory connection', ErrorCodes.ERROR_InvalidLogonData);
    return;
  }
  const worlds = await ctx.session.connectDirectory(req.username, req.password, req.zonePath);
  const response: WsRespConnectSuccess = {
    type: WsMessageType.RESP_CONNECT_SUCCESS,
    wsRequestId: msg.wsRequestId,
    worlds,
  };
  sendResponse(ctx.ws, response);
};

export const handleLoginWorld: WsHandler = async (ctx: WsHandlerContext, msg: WsMessage): Promise<void> => {
  const req = msg as WsReqLoginWorld;
  console.log(`[Gateway] Logging into world: ${req.worldName}`);

  // Server switch: cleanup previous world session if still connected
  if (ctx.session.isWorldConnected()) {
    console.log('[Gateway] Server switch: cleaning up previous world session...');
    await ctx.session.cleanupWorldSession();
  }

  // Lookup world info from session's cached directory data
  const worldInfo = ctx.session.getWorldInfo(req.worldName);
  if (!worldInfo) {
    sendError(ctx.ws, msg.wsRequestId, `World '${req.worldName}' not found in session cache. Did you connect to Directory first?`, ErrorCodes.ERROR_UnknownCluster);
    return;
  }

  let result;
  try {
    result = await ctx.session.loginWorld(req.username, req.password, worldInfo);
  } catch (err: unknown) {
    // Reset session phase so the client can retry REQ_LOGIN_WORLD
    try { await ctx.session.cleanupWorldSession(); } catch { /* best-effort */ }
    throw err;
  }
  const response: WsRespLoginSuccess = {
    type: WsMessageType.RESP_LOGIN_SUCCESS,
    wsRequestId: msg.wsRequestId,
    tycoonId: result.tycoonId,
    contextId: result.contextId,
    companyCount: result.companies.length,
    companies: result.companies,
    worldXSize: result.worldXSize ?? undefined,
    worldYSize: result.worldYSize ?? undefined,
    worldSeason: result.worldSeason ?? undefined,
    ...(result.loginPage ? { loginPage: result.loginPage } : {}),
    ...(result.admission ? { admission: result.admission } : {}),
  };
  sendResponse(ctx.ws, response);
};

export const handleSelectCompany: WsHandler = async (ctx: WsHandlerContext, msg: WsMessage): Promise<void> => {
  const req = msg as WsReqSelectCompany;
  console.log(`[Gateway] Selecting company: ${req.companyId}`);
  await ctx.session.selectCompany(req.companyId);

  const playerPos = ctx.session.getPlayerPosition();
  const response: WsRespRdoResult & { playerX?: number; playerY?: number } = {
    type: WsMessageType.RESP_RDO_RESULT,
    wsRequestId: msg.wsRequestId,
    result: '',
    playerX: playerPos.x || undefined,
    playerY: playerPos.y || undefined,
  };
  sendResponse(ctx.ws, response);
};

export const handleSwitchCompany: WsHandler = async (ctx: WsHandlerContext, msg: WsMessage): Promise<void> => {
  const req = msg as WsReqSwitchCompany;
  console.log(`[Gateway] Switching company: ${req.company.name} (role: ${req.company.ownerRole})`);
  await ctx.session.switchCompany(req.company);

  const playerPos = ctx.session.getPlayerPosition();
  const response: WsRespRdoResult & { playerX?: number; playerY?: number } = {
    type: WsMessageType.RESP_RDO_RESULT,
    wsRequestId: msg.wsRequestId,
    result: '',
    playerX: playerPos.x || undefined,
    playerY: playerPos.y || undefined,
  };
  sendResponse(ctx.ws, response);
};

export const handleLogout: WsHandler = async (ctx: WsHandlerContext, msg: WsMessage): Promise<void> => {
  const _req = msg as WsReqLogout;
  console.log('[Gateway] Processing logout request');

  try {
    await ctx.session.endSession();

    const response: WsRespLogout = {
      type: WsMessageType.RESP_LOGOUT,
      wsRequestId: msg.wsRequestId,
      success: true,
      message: 'Logged out successfully',
    };
    sendResponse(ctx.ws, response);

    // Close WebSocket connection after sending response
    setTimeout(() => {
      ctx.ws.close(1000, 'User logged out');
    }, 100);
  } catch (err: unknown) {
    console.error('[Gateway] Logout error:', toErrorMessage(err));
    const response: WsRespLogout = {
      type: WsMessageType.RESP_LOGOUT,
      wsRequestId: msg.wsRequestId,
      success: false,
      message: toErrorMessage(err) || 'Logout failed',
    };
    sendResponse(ctx.ws, response);
  }
};
