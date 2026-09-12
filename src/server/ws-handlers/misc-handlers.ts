import {
  WsMessageType,
  type WsMessage,
  type WsReqDefineZone,
  type WsRespDefineZone,
  type WsReqCreateCompany,
  type WsRespCreateCompany,
  type WsReqClusterInfo,
  type WsRespClusterInfo,
  type WsReqClusterFacilities,
  type WsRespClusterFacilities,
  type WsReqSearchConnections,
  type WsRespSearchConnections,
  type WsReqConnectionReachability,
  type WsRespConnectionReachability,
  type WsRespEmpireFacilities,
  type WsReqFavoriteAdd,
  type WsRespFavoriteAdd,
  type WsReqFavoriteDelete,
  type WsRespFavoriteDelete,
  type WsReqFavoriteRename,
  type WsRespFavoriteRename,
  type WsReqFavoriteFolderCreate,
  type WsRespFavoriteFolderCreate,
  type WsReqFavoriteMove,
  type WsRespFavoriteMove,
  type WsReqResearchInventory,
  type WsRespResearchInventory,
  type WsReqResearchDetails,
  type WsRespResearchDetails,
} from '../../shared/types';
import * as ErrorCodes from '../../shared/error-codes';
import type { WsHandlerContext, WsHandler } from './types';
import { sendResponse, sendError, withErrorHandler } from './ws-utils';

export const handleDefineZone: WsHandler = async (ctx: WsHandlerContext, msg: WsMessage): Promise<void> => {
  await withErrorHandler(ctx.ws, msg.wsRequestId, ErrorCodes.ERROR_AccessDenied, async () => {
    const req = msg as WsReqDefineZone;
    console.log(`[Gateway] Define zone ${req.zoneId} from (${req.x1}, ${req.y1}) to (${req.x2}, ${req.y2})`);

    const result = await ctx.session.defineZone(req.zoneId, req.x1, req.y1, req.x2, req.y2);

    const response: WsRespDefineZone = {
      type: WsMessageType.RESP_DEFINE_ZONE,
      wsRequestId: msg.wsRequestId,
      success: result.success,
      message: result.message,
    };
    sendResponse(ctx.ws, response);
  });
};

export const handleCreateCompany: WsHandler = async (ctx: WsHandlerContext, msg: WsMessage): Promise<void> => {
  const req = msg as WsReqCreateCompany;
  console.log(`[Gateway] Creating company: "${req.companyName}" in cluster "${req.cluster}"`);

  if (!req.companyName || req.companyName.trim().length === 0) {
    sendError(ctx.ws, msg.wsRequestId, 'Company name cannot be empty', ErrorCodes.ERROR_InvalidParameter);
    return;
  }

  await withErrorHandler(ctx.ws, msg.wsRequestId, ErrorCodes.ERROR_Unknown, async () => {
    const result = await ctx.session.createCompany(req.companyName.trim(), req.cluster);

    if (result.success) {
      const response: WsRespCreateCompany = {
        type: WsMessageType.RESP_CREATE_COMPANY,
        wsRequestId: msg.wsRequestId,
        success: true,
        companyName: result.companyName,
        companyId: result.companyId,
      };
      sendResponse(ctx.ws, response);
    } else {
      sendError(ctx.ws, msg.wsRequestId, result.message || 'Failed to create company', ErrorCodes.ERROR_Unknown);
    }
  });
};

export const handleClusterInfo: WsHandler = async (ctx: WsHandlerContext, msg: WsMessage): Promise<void> => {
  await withErrorHandler(ctx.ws, msg.wsRequestId, ErrorCodes.ERROR_Unknown, async () => {
    const req = msg as WsReqClusterInfo;
    const clusterInfo = await ctx.session.fetchClusterInfo(req.clusterName);
    const response: WsRespClusterInfo = {
      type: WsMessageType.RESP_CLUSTER_INFO,
      wsRequestId: msg.wsRequestId,
      clusterInfo,
    };
    sendResponse(ctx.ws, response);
  });
};

export const handleClusterFacilities: WsHandler = async (ctx: WsHandlerContext, msg: WsMessage): Promise<void> => {
  await withErrorHandler(ctx.ws, msg.wsRequestId, ErrorCodes.ERROR_Unknown, async () => {
    const req = msg as WsReqClusterFacilities;
    const facilities = await ctx.session.fetchClusterFacilities(req.cluster, req.folder);
    const response: WsRespClusterFacilities = {
      type: WsMessageType.RESP_CLUSTER_FACILITIES,
      wsRequestId: msg.wsRequestId,
      facilities,
    };
    sendResponse(ctx.ws, response);
  });
};

export const handleSearchConnections: WsHandler = async (ctx: WsHandlerContext, msg: WsMessage): Promise<void> => {
  const req = msg as WsReqSearchConnections;
  console.log(`[Gateway] Searching ${req.direction} connections for fluid: ${req.fluidId}`);
  const results = await ctx.session.searchConnections(
    req.buildingX, req.buildingY,
    req.fluidId, req.direction, req.filters
  );
  const response: WsRespSearchConnections = {
    type: WsMessageType.RESP_SEARCH_CONNECTIONS,
    wsRequestId: msg.wsRequestId,
    results,
    fluidId: req.fluidId,
    direction: req.direction,
  };
  sendResponse(ctx.ws, response);
};

export const handleConnectionReachability: WsHandler = async (ctx: WsHandlerContext, msg: WsMessage): Promise<void> => {
  await withErrorHandler(ctx.ws, msg.wsRequestId, ErrorCodes.ERROR_Unknown, async () => {
    const req = msg as WsReqConnectionReachability;
    await ctx.session.resolveConnectionReachability(
      req.buildingX, req.buildingY, req.candidates,
      entries => {
        const response: WsRespConnectionReachability = {
          type: WsMessageType.RESP_CONNECTION_REACHABILITY,
          wsRequestId: msg.wsRequestId,
          buildingX: req.buildingX,
          buildingY: req.buildingY,
          fluidId: req.fluidId,
          direction: req.direction,
          entries,
        };
        sendResponse(ctx.ws, response);
      },
    );
  });
};

export const handleEmpireFacilities: WsHandler = async (ctx: WsHandlerContext, msg: WsMessage): Promise<void> => {
  console.log('[Gateway] Fetching owned facilities (favorites)');
  const facilities = await ctx.session.fetchOwnedFacilities();
  const response: WsRespEmpireFacilities = {
    type: WsMessageType.RESP_EMPIRE_FACILITIES,
    wsRequestId: msg.wsRequestId,
    facilities,
  };
  sendResponse(ctx.ws, response);
};

/**
 * The three favourites mutations.
 *
 * `success` is copied from what the server answered and nothing else — a
 * refused write must never leave here as an OK (OB-1). A transport failure
 * throws and leaves through `withErrorHandler` as a RESP_ERROR.
 */
export const handleFavoriteAdd: WsHandler = async (ctx: WsHandlerContext, msg: WsMessage): Promise<void> => {
  await withErrorHandler(ctx.ws, msg.wsRequestId, ErrorCodes.ERROR_Unknown, async () => {
    const req = msg as WsReqFavoriteAdd;
    console.log(`[Gateway] Adding favorite "${req.name}" at (${req.x}, ${req.y})`);
    const result = await ctx.session.addFavorite(req.name, req.x, req.y);
    const response: WsRespFavoriteAdd = {
      type: WsMessageType.RESP_FAVORITE_ADD,
      wsRequestId: msg.wsRequestId,
      success: result.success,
      id: result.id,
      message: result.message,
    };
    sendResponse(ctx.ws, response);
  });
};

export const handleFavoriteDelete: WsHandler = async (ctx: WsHandlerContext, msg: WsMessage): Promise<void> => {
  await withErrorHandler(ctx.ws, msg.wsRequestId, ErrorCodes.ERROR_Unknown, async () => {
    const req = msg as WsReqFavoriteDelete;
    console.log(`[Gateway] Deleting favorite at "${req.path}"`);
    const result = await ctx.session.deleteFavorite(req.path);
    const response: WsRespFavoriteDelete = {
      type: WsMessageType.RESP_FAVORITE_DELETE,
      wsRequestId: msg.wsRequestId,
      success: result.success,
      message: result.message,
    };
    sendResponse(ctx.ws, response);
  });
};

export const handleFavoriteRename: WsHandler = async (ctx: WsHandlerContext, msg: WsMessage): Promise<void> => {
  await withErrorHandler(ctx.ws, msg.wsRequestId, ErrorCodes.ERROR_Unknown, async () => {
    const req = msg as WsReqFavoriteRename;
    console.log(`[Gateway] Renaming favorite at "${req.path}"`);
    const result = await ctx.session.renameFavorite(req.path, req.name);
    const response: WsRespFavoriteRename = {
      type: WsMessageType.RESP_FAVORITE_RENAME,
      wsRequestId: msg.wsRequestId,
      success: result.success,
      message: result.message,
    };
    sendResponse(ctx.ws, response);
  });
};

export const handleFavoriteFolderCreate: WsHandler = async (ctx: WsHandlerContext, msg: WsMessage): Promise<void> => {
  await withErrorHandler(ctx.ws, msg.wsRequestId, ErrorCodes.ERROR_Unknown, async () => {
    const req = msg as WsReqFavoriteFolderCreate;
    console.log(`[Gateway] Creating favorite folder "${req.name}" at "${req.parentPath}"`);
    const result = await ctx.session.createFavoriteFolder(req.parentPath, req.name);
    const response: WsRespFavoriteFolderCreate = {
      type: WsMessageType.RESP_FAVORITE_FOLDER_CREATE,
      wsRequestId: msg.wsRequestId,
      success: result.success,
      id: result.id,
      message: result.message,
    };
    sendResponse(ctx.ws, response);
  });
};

export const handleFavoriteMove: WsHandler = async (ctx: WsHandlerContext, msg: WsMessage): Promise<void> => {
  await withErrorHandler(ctx.ws, msg.wsRequestId, ErrorCodes.ERROR_Unknown, async () => {
    const req = msg as WsReqFavoriteMove;
    console.log(`[Gateway] Moving favorite "${req.path}" -> "${req.destPath}"`);
    const result = await ctx.session.moveFavorite(req.path, req.destPath);
    const response: WsRespFavoriteMove = {
      type: WsMessageType.RESP_FAVORITE_MOVE,
      wsRequestId: msg.wsRequestId,
      success: result.success,
      message: result.message,
    };
    sendResponse(ctx.ws, response);
  });
};

export const handleResearchInventory: WsHandler = async (ctx: WsHandlerContext, msg: WsMessage): Promise<void> => {
  await withErrorHandler(ctx.ws, msg.wsRequestId, ErrorCodes.ERROR_AccessDenied, async () => {
    const req = msg as WsReqResearchInventory;
    console.log(`[Gateway] Research inventory request at (${req.buildingX}, ${req.buildingY}), cat=${req.categoryIndex}`);

    const data = await ctx.session.getResearchInventory(req.buildingX, req.buildingY, req.categoryIndex);

    // Enrich items with names/descriptions from parsed research.0.dat
    // The server cache only has names for volatile inventions — the .dat
    // file provides display names for all 879 inventions.
    if (ctx.inventionIndex) {
      const enrichSection = (items: typeof data.available) => {
        for (const item of items) {
          const datInv = ctx.inventionIndex!.byId.get(item.inventionId);
          if (datInv) {
            if (!item.name || item.name === item.inventionId) item.name = datInv.name;
            if (!item.parent) item.parent = datInv.parent;
          }
        }
      };
      enrichSection(data.available);
      enrichSection(data.developing);
      enrichSection(data.completed);
    }

    const response: WsRespResearchInventory = {
      type: WsMessageType.RESP_RESEARCH_INVENTORY,
      wsRequestId: msg.wsRequestId,
      data,
    };
    sendResponse(ctx.ws, response);
  });
};

export const handleResearchDetails: WsHandler = async (ctx: WsHandlerContext, msg: WsMessage): Promise<void> => {
  await withErrorHandler(ctx.ws, msg.wsRequestId, ErrorCodes.ERROR_AccessDenied, async () => {
    const req = msg as WsReqResearchDetails;
    console.log(`[Gateway] Research details request for "${req.inventionId}" at (${req.buildingX}, ${req.buildingY})`);

    const details = await ctx.session.getResearchDetails(req.buildingX, req.buildingY, req.inventionId);

    const response: WsRespResearchDetails = {
      type: WsMessageType.RESP_RESEARCH_DETAILS,
      wsRequestId: msg.wsRequestId,
      details,
    };
    sendResponse(ctx.ws, response);
  });
};
