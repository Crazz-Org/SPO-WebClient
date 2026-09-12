import * as ErrorCodes from '../../shared/error-codes';
import { getCivicVisualClassIds } from '../../shared/building-details/civic-buildings';
import {
  WsMessageType,
  type WsMessage,
  type WsReqContextStatus,
  type WsReqGetSurface,
  type WsReqMapLoad,
  type WsRespAllFacilityDimensions,
  type WsRespContextStatus,
  type WsRespMapData,
  type WsRespSurfaceData,
} from '../../shared/types';
import type { WsHandlerContext, WsHandler } from './types';
import { sendResponse, withErrorHandler } from './ws-utils';

export const handleMapLoad: WsHandler = async (ctx: WsHandlerContext, msg: WsMessage): Promise<void> => {
  const req = msg as WsReqMapLoad;
  const mapData = await ctx.session.loadMapArea(req.x, req.y, req.width, req.height);

  const response: WsRespMapData = {
    type: WsMessageType.RESP_MAP_DATA,
    wsRequestId: msg.wsRequestId,
    data: mapData,
  };
  sendResponse(ctx.ws, response);
};

export const handleUpdateCamera: WsHandler = async (ctx: WsHandlerContext, msg: WsMessage): Promise<void> => {
  const camReq = msg as unknown as { x: number; y: number; viewX?: number; viewY?: number; viewW?: number; viewH?: number };
  ctx.session.updateCameraPosition(camReq.x, camReq.y, camReq.viewX, camReq.viewY, camReq.viewW, camReq.viewH);
  // Fire-and-forget — no response needed
};

export const handleGetSurface: WsHandler = async (ctx: WsHandlerContext, msg: WsMessage): Promise<void> => {
  await withErrorHandler(ctx.ws, msg.wsRequestId, ErrorCodes.ERROR_InvalidParameter, async () => {
    const req = msg as WsReqGetSurface;
    console.log(`[Gateway] Getting surface data: ${req.surfaceType} for area (${req.x1},${req.y1}) to (${req.x2},${req.y2})`);

    const data = await ctx.session.getSurfaceData(req.surfaceType, req.x1, req.y1, req.x2, req.y2);
    const response: WsRespSurfaceData = {
      type: WsMessageType.RESP_SURFACE_DATA,
      wsRequestId: msg.wsRequestId,
      data,
    };
    sendResponse(ctx.ws, response);
  });
};

export const handleGetAllFacilityDimensions: WsHandler = async (ctx: WsHandlerContext, msg: WsMessage): Promise<void> => {
  await withErrorHandler(ctx.ws, msg.wsRequestId, ErrorCodes.ERROR_Unknown, async () => {
    console.log('[Gateway] Getting all facility dimensions (preload)');

    const dimensions = ctx.facilityDimensionsCache().getAllFacilitiesAsObject();

    const response: WsRespAllFacilityDimensions = {
      type: WsMessageType.RESP_ALL_FACILITY_DIMENSIONS,
      wsRequestId: msg.wsRequestId,
      dimensions,
      civicVisualClassIds: getCivicVisualClassIds(),
    };

    console.log(`[Gateway] Sending ${Object.keys(dimensions).length} facility dimensions`);
    sendResponse(ctx.ws, response);
  });
};

/**
 * The sentence describing the town under the camera. `text` is '' when there is
 * no town there (World.pas:4243) — the client hides its strip rather than
 * showing an empty bar.
 */
export const handleContextStatus: WsHandler = async (ctx: WsHandlerContext, msg: WsMessage): Promise<void> => {
  await withErrorHandler(ctx.ws, msg.wsRequestId, ErrorCodes.ERROR_Unknown, async () => {
    const req = msg as WsReqContextStatus;
    const text = await ctx.session.getContextStatusText(req.x, req.y);

    const response: WsRespContextStatus = {
      type: WsMessageType.RESP_CONTEXT_STATUS,
      wsRequestId: msg.wsRequestId,
      text,
    };
    sendResponse(ctx.ws, response);
  });
};
