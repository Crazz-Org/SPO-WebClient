import type { WsHandlerContext } from './types';
import { sendResponse } from './ws-utils';
import type {
  WsMessage,
  WsReqProfileBankAction,
  WsReqProfileAutoConnectionAction,
  WsReqProfilePolicySet,
  WsReqProfileCurriculumAction,
  WsReqProfileCompanyProfitLoss,
  WsRespGetProfile,
  WsRespProfileCurriculum,
  WsRespProfileBank,
  WsRespProfileBankAction,
  WsRespProfileProfitLoss,
  WsRespProfileCompanies,
  WsRespProfileCompanyProfitLoss,
  WsRespProfileAutoConnections,
  WsRespProfileAutoConnectionAction,
  WsRespProfilePolicy,
  WsRespProfilePolicySet,
  WsRespProfileCurriculumAction,
} from '../../shared/types';
import { WsMessageType } from '../../shared/types';
import type { BankActionType, CurriculumActionType } from '../../shared/types';
import { toErrorMessage } from '../../shared/error-utils';

export async function handleGetProfile(ctx: WsHandlerContext, msg: WsMessage): Promise<void> {
  const profile = await ctx.session.fetchTycoonProfile();
  const response: WsRespGetProfile = {
    type: WsMessageType.RESP_GET_PROFILE,
    wsRequestId: msg.wsRequestId,
    profile,
  };
  sendResponse(ctx.ws, response);
}

export async function handleProfileCurriculum(ctx: WsHandlerContext, msg: WsMessage): Promise<void> {
  const data = await ctx.session.fetchCurriculumData();
  const response: WsRespProfileCurriculum = {
    type: WsMessageType.RESP_PROFILE_CURRICULUM,
    wsRequestId: msg.wsRequestId,
    data,
  };
  sendResponse(ctx.ws, response);
}

export async function handleProfileBank(ctx: WsHandlerContext, msg: WsMessage): Promise<void> {
  const data = await ctx.session.fetchBankAccount();
  const response: WsRespProfileBank = {
    type: WsMessageType.RESP_PROFILE_BANK,
    wsRequestId: msg.wsRequestId,
    data,
  };
  sendResponse(ctx.ws, response);
}

export async function handleProfileBankAction(ctx: WsHandlerContext, msg: WsMessage): Promise<void> {
  const req = msg as WsReqProfileBankAction;
  const result = await ctx.session.executeBankAction(
    req.action as BankActionType,
    req.amount,
    req.toTycoon,
    req.reason,
    req.loanIndex
  );
  const response: WsRespProfileBankAction = {
    type: WsMessageType.RESP_PROFILE_BANK_ACTION,
    wsRequestId: msg.wsRequestId,
    result,
  };
  sendResponse(ctx.ws, response);
}

export async function handleProfileProfitLoss(ctx: WsHandlerContext, msg: WsMessage): Promise<void> {
  const data = await ctx.session.fetchProfitLoss();
  const response: WsRespProfileProfitLoss = {
    type: WsMessageType.RESP_PROFILE_PROFITLOSS,
    wsRequestId: msg.wsRequestId,
    data,
  };
  sendResponse(ctx.ws, response);
}

export async function handleProfileCompanies(ctx: WsHandlerContext, msg: WsMessage): Promise<void> {
  const data = await ctx.session.fetchCompanies();
  const response: WsRespProfileCompanies = {
    type: WsMessageType.RESP_PROFILE_COMPANIES,
    wsRequestId: msg.wsRequestId,
    data,
  };
  sendResponse(ctx.ws, response);
}

/**
 * A failure travels in the typed response, not as RESP_ERROR: the client's
 * RESP_ERROR branch (event-handler.ts:426-431) only logs and routes to the
 * search menu, so it could never clear the company view.
 */
export async function handleProfileCompanyProfitLoss(ctx: WsHandlerContext, msg: WsMessage): Promise<void> {
  const req = msg as WsReqProfileCompanyProfitLoss;
  const companyName = typeof req.companyName === 'string' ? req.companyName.trim() : '';
  const base = { type: WsMessageType.RESP_PROFILE_COMPANY_PROFITLOSS as const, wsRequestId: msg.wsRequestId, companyName };
  let response: WsRespProfileCompanyProfitLoss;
  if (!companyName) {
    response = { ...base, data: null, error: 'A company name is required' };
  } else {
    try {
      response = { ...base, data: await ctx.session.fetchCompanyProfitLoss(companyName, req.cluster ?? '') };
    } catch (e: unknown) {
      response = { ...base, data: null, error: toErrorMessage(e) };
    }
  }
  sendResponse(ctx.ws, response);
}

export async function handleProfileAutoConnections(ctx: WsHandlerContext, msg: WsMessage): Promise<void> {
  const data = await ctx.session.fetchAutoConnections();
  const response: WsRespProfileAutoConnections = {
    type: WsMessageType.RESP_PROFILE_AUTOCONNECTIONS,
    wsRequestId: msg.wsRequestId,
    data,
  };
  sendResponse(ctx.ws, response);
}

export async function handleProfileAutoConnectionAction(ctx: WsHandlerContext, msg: WsMessage): Promise<void> {
  const req = msg as WsReqProfileAutoConnectionAction;
  const result = await ctx.session.executeAutoConnectionAction(
    req.action,
    req.fluidId,
    req.suppliers
  );
  const response: WsRespProfileAutoConnectionAction = {
    type: WsMessageType.RESP_PROFILE_AUTOCONNECTION_ACTION,
    wsRequestId: msg.wsRequestId,
    success: result.success,
    message: result.message,
  };
  sendResponse(ctx.ws, response);
}

export async function handleProfilePolicy(ctx: WsHandlerContext, msg: WsMessage): Promise<void> {
  const data = await ctx.session.fetchPolicy();
  const response: WsRespProfilePolicy = {
    type: WsMessageType.RESP_PROFILE_POLICY,
    wsRequestId: msg.wsRequestId,
    data,
  };
  sendResponse(ctx.ws, response);
}

export async function handleProfilePolicySet(ctx: WsHandlerContext, msg: WsMessage): Promise<void> {
  const req = msg as WsReqProfilePolicySet;
  const result = await ctx.session.setPolicyStatus(req.tycoonName, req.status);
  const response: WsRespProfilePolicySet = {
    type: WsMessageType.RESP_PROFILE_POLICY_SET,
    wsRequestId: msg.wsRequestId,
    success: result.success,
    message: result.message,
  };
  sendResponse(ctx.ws, response);
}

export async function handleProfileCurriculumAction(ctx: WsHandlerContext, msg: WsMessage): Promise<void> {
  const req = msg as WsReqProfileCurriculumAction;
  const result = req.action === 'abandonRole'
    ? await ctx.session.abandonRole()
    : { ...(await ctx.session.executeCurriculumAction(req.action as CurriculumActionType, req.value)), outcome: 'unchanged' as const };
  const response: WsRespProfileCurriculumAction = {
    type: WsMessageType.RESP_PROFILE_CURRICULUM_ACTION,
    wsRequestId: msg.wsRequestId,
    success: result.success,
    message: result.message,
    ...(result.outcome === 'switched' ? { switchedTo: result.company } : {}),
    ...(result.outcome === 'no-company' ? { returnToCompanyStage: true } : {}),
  };
  sendResponse(ctx.ws, response);
}
