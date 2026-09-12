import type { WsHandlerContext } from './types';
import { sendResponse, sendError } from './ws-utils';
import type {
  WsMessage,
  WsReqSearchMenuPeopleSearch,
  WsReqSearchMenuTycoonProfile,
  WsReqSearchMenuTycoonFullProfile,
  WsReqSearchMenuRankingDetail,
  WsReqSearchMenuDirectory,
  WsRespSearchMenuDirectory,
  WsRespSearchMenuHome,
  WsRespSearchMenuTowns,
  WsRespSearchMenuPeopleSearch,
  WsRespSearchMenuTycoonProfile,
  WsRespSearchMenuTycoonFullProfile,
  WsRespSearchMenuRankings,
  WsRespSearchMenuRankingDetail,
  WsRespSearchMenuBanks,
  WsRespSearchMenuNewspapers,
} from '../../shared/types';
import { WsMessageType } from '../../shared/types';
import * as ErrorCodes from '../../shared/error-codes';
import { toErrorMessage } from '../../shared/error-utils';

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

/**
 * One page of the directory tree below the town list. The `ref` is echoed back so the
 * client can match the reply to the entry that asked for it.
 */
export async function handleSearchMenuDirectory(ctx: WsHandlerContext, msg: WsMessage): Promise<void> {
  if (!ctx.searchMenuService) {
    sendError(ctx.ws, msg.wsRequestId, 'Search menu not available. Please log in first.', ErrorCodes.ERROR_AccessDenied);
    return;
  }
  const req = msg as WsReqSearchMenuDirectory;
  const page = await ctx.searchMenuService.getDirectoryPage(req.ref);
  const response: WsRespSearchMenuDirectory = {
    type: WsMessageType.RESP_SEARCH_MENU_DIRECTORY,
    wsRequestId: msg.wsRequestId,
    ref: req.ref,
    page,
  };
  sendResponse(ctx.ws, response);
}

/**
 * "Show Profile" on a directory card — the full curriculum page of ANY tycoon
 * (RenderTycoon.asp:119-124 opens `NewTycoon/Tycoon.asp?Tycoon=<other>`, whose
 * Main frame is TycoonCurriculum.asp for that tycoon).
 *
 * `ctx.session` rather than `ctx.searchMenuService`: the page is an ASP fetch
 * the session already knows how to sign, like handleSearchMenuPeopleSearch.
 */
export async function handleSearchMenuTycoonFullProfile(ctx: WsHandlerContext, msg: WsMessage): Promise<void> {
  const req = msg as WsReqSearchMenuTycoonFullProfile;
  const tycoonName = (req.tycoonName ?? '').trim();
  if (tycoonName === '') {
    sendError(ctx.ws, msg.wsRequestId, 'A tycoon name is required', ErrorCodes.ERROR_InvalidParameter);
    return;
  }
  try {
    const data = await ctx.session.fetchTycoonFullProfile(tycoonName);
    const response: WsRespSearchMenuTycoonFullProfile = {
      type: WsMessageType.RESP_SEARCH_MENU_TYCOON_FULL_PROFILE,
      wsRequestId: msg.wsRequestId,
      tycoonName,
      data,
    };
    sendResponse(ctx.ws, response);
  } catch (e: unknown) {
    sendError(ctx.ws, msg.wsRequestId, toErrorMessage(e), ErrorCodes.ERROR_Unknown);
  }
}
