import type { WsHandlerContext } from './types';
import { sendResponse, sendError } from './ws-utils';
import type {
  WsMessage,
  WsReqSearchMenuPeopleSearch,
  WsReqSearchMenuTycoonProfile,
  WsReqSearchMenuRankingDetail,
  WsRespSearchMenuHome,
  WsRespSearchMenuTowns,
  WsRespSearchMenuPeopleSearch,
  WsRespSearchMenuTycoonProfile,
  WsRespSearchMenuRankings,
  WsRespSearchMenuRankingDetail,
  WsRespSearchMenuBanks,
  WsRespSearchMenuNewspapers,
} from '../../shared/types';
import { WsMessageType } from '../../shared/types';
import * as ErrorCodes from '../../shared/error-codes';

export async function handleSearchMenuHome(ctx: WsHandlerContext, msg: WsMessage): Promise<void> {
  if (!ctx.searchMenuService) {
    sendError(ctx.ws, msg.wsRequestId, 'Search menu not available. Please log in first.', ErrorCodes.ERROR_AccessDenied);
    return;
  }
  const categories = await ctx.searchMenuService.getHomePage();
  const response: WsRespSearchMenuHome = {
    type: WsMessageType.RESP_SEARCH_MENU_HOME,
    wsRequestId: msg.wsRequestId,
    categories,
  };
  sendResponse(ctx.ws, response);
}

export async function handleSearchMenuTowns(ctx: WsHandlerContext, msg: WsMessage): Promise<void> {
  if (!ctx.searchMenuService) {
    sendError(ctx.ws, msg.wsRequestId, 'Search menu not available. Please log in first.', ErrorCodes.ERROR_AccessDenied);
    return;
  }
  const towns = await ctx.searchMenuService.getTowns();
  const response: WsRespSearchMenuTowns = {
    type: WsMessageType.RESP_SEARCH_MENU_TOWNS,
    wsRequestId: msg.wsRequestId,
    towns,
  };
  sendResponse(ctx.ws, response);
}

export async function handleSearchMenuPeopleSearch(ctx: WsHandlerContext, msg: WsMessage): Promise<void> {
  const req = msg as WsReqSearchMenuPeopleSearch;
  const results = await ctx.session.searchPeople(req.searchStr);
  const response: WsRespSearchMenuPeopleSearch = {
    type: WsMessageType.RESP_SEARCH_MENU_PEOPLE_SEARCH,
    wsRequestId: msg.wsRequestId,
    results,
  };
  sendResponse(ctx.ws, response);
}

export async function handleSearchMenuTycoonProfile(ctx: WsHandlerContext, msg: WsMessage): Promise<void> {
  if (!ctx.searchMenuService) {
    sendError(ctx.ws, msg.wsRequestId, 'Search menu not available. Please log in first.', ErrorCodes.ERROR_AccessDenied);
    return;
  }
  const req = msg as WsReqSearchMenuTycoonProfile;
  const profile = await ctx.searchMenuService.getTycoonProfile(req.tycoonName);
  const response: WsRespSearchMenuTycoonProfile = {
    type: WsMessageType.RESP_SEARCH_MENU_TYCOON_PROFILE,
    wsRequestId: msg.wsRequestId,
    profile,
  };
  sendResponse(ctx.ws, response);
}

export async function handleSearchMenuRankings(ctx: WsHandlerContext, msg: WsMessage): Promise<void> {
  if (!ctx.searchMenuService) {
    sendError(ctx.ws, msg.wsRequestId, 'Search menu not available. Please log in first.', ErrorCodes.ERROR_AccessDenied);
    return;
  }
  const categories = await ctx.searchMenuService.getRankings();
  const response: WsRespSearchMenuRankings = {
    type: WsMessageType.RESP_SEARCH_MENU_RANKINGS,
    wsRequestId: msg.wsRequestId,
    categories,
  };
  sendResponse(ctx.ws, response);
}

export async function handleSearchMenuRankingDetail(ctx: WsHandlerContext, msg: WsMessage): Promise<void> {
  if (!ctx.searchMenuService) {
    sendError(ctx.ws, msg.wsRequestId, 'Search menu not available. Please log in first.', ErrorCodes.ERROR_AccessDenied);
    return;
  }
  const req = msg as WsReqSearchMenuRankingDetail;
  const result = await ctx.searchMenuService.getRankingDetail(req.rankingPath);
  const response: WsRespSearchMenuRankingDetail = {
    type: WsMessageType.RESP_SEARCH_MENU_RANKING_DETAIL,
    wsRequestId: msg.wsRequestId,
    title: result.title,
    entries: result.entries,
  };
  sendResponse(ctx.ws, response);
}

export async function handleSearchMenuBanks(ctx: WsHandlerContext, msg: WsMessage): Promise<void> {
  if (!ctx.searchMenuService) {
    sendError(ctx.ws, msg.wsRequestId, 'Search menu not available. Please log in first.', ErrorCodes.ERROR_AccessDenied);
    return;
  }
  const banks = await ctx.searchMenuService.getBanks();
  const response: WsRespSearchMenuBanks = {
    type: WsMessageType.RESP_SEARCH_MENU_BANKS,
    wsRequestId: msg.wsRequestId,
    banks,
  };
  sendResponse(ctx.ws, response);
}

export async function handleSearchMenuNewspapers(ctx: WsHandlerContext, msg: WsMessage): Promise<void> {
  if (!ctx.searchMenuService) {
    sendError(ctx.ws, msg.wsRequestId, 'Search menu not available. Please log in first.', ErrorCodes.ERROR_AccessDenied);
    return;
  }
  const newspapers = await ctx.searchMenuService.getNewspapers();
  const response: WsRespSearchMenuNewspapers = {
    type: WsMessageType.RESP_SEARCH_MENU_NEWSPAPERS,
    wsRequestId: msg.wsRequestId,
    newspapers,
  };
  sendResponse(ctx.ws, response);
}
