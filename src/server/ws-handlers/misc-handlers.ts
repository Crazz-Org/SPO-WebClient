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
  type WsReqNearCircuits,
  type WsRespNearCircuits,
  type WsReqFacilityStatusBatch,
  type WsRespFacilityStatusBatch,
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
  type WsRespWorldEvent,
} from '../../shared/types';
import * as ErrorCodes from '../../shared/error-codes';
import type { WsHandlerContext, WsHandler } from './types';
import { sendResponse, sendError, withErrorHandler } from './ws-utils';
import { markActiveDeveloping } from '../session/research-status-handler';

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
      errorCode: result.errorCode,
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

/**
 * Most tiles one REQ_NEAR_CIRCUITS may ask for. The request holds the socket's RDO lane
 * for its whole run, two map-socket round trips plus a 30 ms settle per tile
 * (`readNearCircuits`). Measured on the live bots (SPO-Bots run records, 2026-10-04,
 * cycles.jsonl timing.byType.REQ_CONNECTION_REACHABILITY): 3.7-4.9 s per request of at
 * most 11 tile reads, so about 0.4-0.5 s per tile; 100 tiles is under a minute, a
 * client's request timeout, and the frame stays far inside `WS_MAX_PAYLOAD_BYTES`.
 */
export const MAX_NEAR_CIRCUITS_TILES = 100;

/** A map tile coordinate: a non-negative safe integer. */
function isTileCoord(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}

/**
 * The validation of a REQ_NEAR_CIRCUITS body: the tile list, or why it is refused.
 * `tiles` must be an array of 1..MAX_NEAR_CIRCUITS_TILES `{ x, y }` with integer
 * coordinates >= 0; anything else is refused before any RDO frame is sent.
 */
export function validateNearCircuitsTiles(raw: unknown): { tiles: Array<{ x: number; y: number }> } | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { error: 'tiles must be a non-empty array' };
  if (raw.length > MAX_NEAR_CIRCUITS_TILES) return { error: `at most ${MAX_NEAR_CIRCUITS_TILES} tiles per request` };
  const tiles: Array<{ x: number; y: number }> = [];
  for (const t of raw) {
    const tile = typeof t === 'object' && t !== null ? (t as { x?: unknown; y?: unknown }) : null;
    if (tile === null || !isTileCoord(tile.x) || !isTileCoord(tile.y)) {
      return { error: 'each tile needs integer x and y >= 0' };
    }
    tiles.push({ x: tile.x, y: tile.y });
  }
  return { tiles };
}

/**
 * Raw `NearCircuits` per tile, so a client can compare every (buyer, supplier) pair
 * itself and read each tile once (`readNearCircuitsAt` in politics-handler.ts).
 */
export const handleNearCircuits: WsHandler = async (ctx: WsHandlerContext, msg: WsMessage): Promise<void> => {
  const checked = validateNearCircuitsTiles((msg as Partial<WsReqNearCircuits>).tiles);
  if ('error' in checked) {
    sendError(ctx.ws, msg.wsRequestId, checked.error, ErrorCodes.ERROR_InvalidParameter);
    return;
  }
  await withErrorHandler(ctx.ws, msg.wsRequestId, ErrorCodes.ERROR_Unknown, async () => {
    const tiles = await ctx.session.readNearCircuitsAt(checked.tiles);
    const response: WsRespNearCircuits = {
      type: WsMessageType.RESP_NEAR_CIRCUITS,
      wsRequestId: msg.wsRequestId,
      tiles,
    };
    sendResponse(ctx.ws, response);
  });
};

/**
 * Most ids one REQ_FACILITY_STATUS_BATCH may ask for. Sized for a whole estate per cycle
 * (SPO-Bots plans 170-290 shops per bot, measurements/research/2026-10-05/money-read-paths.md)
 * in ONE WS message, so the ws-message-guard (20/s, burst 50, queue 100) never sees a burst.
 * The request frame stays far inside `WS_MAX_PAYLOAD_BYTES` (300 ids of at most 11 chars).
 */
export const MAX_FACILITY_STATUS_BATCH_IDS = 300;

/** A facility id as focus returns it: `TObjId` is a 32-bit integer (`integer(FacilityAt(x,y))`). */
const INT32_MAX = 2147483647;
const INT32_MIN = -2147483648;

/**
 * The validation of a REQ_FACILITY_STATUS_BATCH body: the ids as decimal strings, or why
 * the request is refused. `ids` must be 1..MAX_FACILITY_STATUS_BATCH_IDS non-zero 32-bit
 * integers (numbers, or strings of digits as REQ_BUILDING_FOCUS returns them); anything else
 * is refused before any RDO frame. Duplicates are kept (answered once each, in order).
 */
export function validateFacilityStatusIds(raw: unknown): { ids: string[] } | { error: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { error: 'ids must be a non-empty array' };
  if (raw.length > MAX_FACILITY_STATUS_BATCH_IDS) return { error: `at most ${MAX_FACILITY_STATUS_BATCH_IDS} ids per request` };
  const ids: string[] = [];
  for (const v of raw) {
    let n: number;
    if (typeof v === 'number') n = v;
    else if (typeof v === 'string' && /^-?\d{1,10}$/.test(v)) n = Number(v);
    else return { error: 'each id must be an integer or a string of digits' };
    if (!Number.isSafeInteger(n) || n === 0 || n > INT32_MAX || n < INT32_MIN) {
      return { error: 'each id must be a non-zero 32-bit integer' };
    }
    ids.push(String(n));
  }
  return { ids };
}

/**
 * Status text (with the `($X/h)` money per hour) of many facilities in one frame, without
 * focusing any (`readFacilityStatusBatch` in session/facility-status-handler.ts). Callers must
 * only pass ids they hold as alive this cycle — see that module's SAFETY note; ids this
 * gateway session never focused are answered `status: 'error'`, never sent to the server. A
 * slow or failed id is answered `status: 'unknown'`; the batch itself fails only on its body.
 */
export const handleFacilityStatusBatch: WsHandler = async (ctx: WsHandlerContext, msg: WsMessage): Promise<void> => {
  const checked = validateFacilityStatusIds((msg as Partial<WsReqFacilityStatusBatch>).ids);
  if ('error' in checked) {
    sendError(ctx.ws, msg.wsRequestId, checked.error, ErrorCodes.ERROR_InvalidParameter);
    return;
  }
  await withErrorHandler(ctx.ws, msg.wsRequestId, ErrorCodes.ERROR_Unknown, async () => {
    const entries = await ctx.session.readFacilityStatusBatch(checked.ids);
    const response: WsRespFacilityStatusBatch = {
      type: WsMessageType.RESP_FACILITY_STATUS_BATCH,
      wsRequestId: msg.wsRequestId,
      entries,
    };
    sendResponse(ctx.ws, response);
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

    // After the enrichment, never before it: the status text names the active
    // invention by its display name, and until this point a non-volatile item
    // still carries its id in `name` (`Inventions/Inventions.pas:756-759`).
    markActiveDeveloping(data.developing, data.activeResearch ?? null);

    const response: WsRespResearchInventory = {
      type: WsMessageType.RESP_RESEARCH_INVENTORY,
      wsRequestId: msg.wsRequestId,
      data,
    };
    sendResponse(ctx.ws, response);
  });
};

/**
 * The newest world event (`PickEvent`). No `withErrorHandler`: the session
 * method already answers `null` instead of throwing — an absent event is the
 * normal case (backup running, empty queue), not an error worth an error frame.
 */
export const handleWorldEvent: WsHandler = async (ctx: WsHandlerContext, msg: WsMessage): Promise<void> => {
  const event = await ctx.session.pickWorldEvent();

  const response: WsRespWorldEvent = {
    type: WsMessageType.RESP_WORLD_EVENT,
    wsRequestId: msg.wsRequestId,
    event,
  };
  sendResponse(ctx.ws, response);
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
