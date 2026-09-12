/**
 * Abandon-role handler — wraps the existing two-step curriculum resignation
 * with the reference client's read-then-resign-then-navigate-home sequence
 * (`~/SPO-ASP/Five/0/Visual/Voyager/NewTycoon/rdoAbandonRole.asp:22-27,40`):
 * read the player's own company list before resigning, resign, then reuse
 * `switchCompany` to land back on the personal tycoon
 * (`~/SPO-Original/Voyager/URLHandlers/ServerCnxHandler.pas:1165-1167`).
 */

import type { CompanyInfo } from '../../shared/types';
import { toErrorMessage } from '../../shared/error-utils';

export interface AbandonRoleContext {
  readonly cachedUsername: string | null;
  readonly activeUsername: string | null;
  readonly currentCompany: CompanyInfo | null;
  log: {
    debug(message: string, meta?: unknown): void;
    info(message: string, meta?: unknown): void;
    warn(message: string, meta?: unknown): void;
    error(message: string, meta?: unknown): void;
  };
  readPersonalCompanies(): Promise<CompanyInfo[]>;
  executeCurriculumAction(action: 'abandonRole'): Promise<{ success: boolean; message?: string }>;
  switchCompany(company: CompanyInfo): Promise<void>;
}

export type AbandonRoleOutcome = 'unchanged' | 'switched' | 'no-company';

export interface AbandonRoleResult {
  success: boolean;
  message?: string;
  outcome: AbandonRoleOutcome;
  company?: CompanyInfo;
}

/**
 * Abandon the currently held role, then — if the session was entered as that
 * role — switch back to the player's own first company (rdoAbandonRole.asp:22-27,40;
 * ServerCnxHandler.pas:1165-1167).
 */
export async function abandonRole(ctx: AbandonRoleContext): Promise<AbandonRoleResult> {
  const personal = ctx.cachedUsername ?? '';
  const enteredAsRole = !!ctx.activeUsername && ctx.activeUsername.toLowerCase() !== personal.toLowerCase();

  let companies: CompanyInfo[];
  try {
    companies = await ctx.readPersonalCompanies();
  } catch (e: unknown) {
    ctx.log.warn(`[AbandonRole] Failed to read personal companies before resigning: ${toErrorMessage(e)}`);
    companies = [];
  }

  const result = await ctx.executeCurriculumAction('abandonRole');
  if (!result.success) {
    return { ...result, outcome: 'unchanged' };
  }

  if (!enteredAsRole) {
    return { ...result, outcome: 'unchanged' };
  }

  const home = companies.find(c => !c.ownerRole || c.ownerRole.toLowerCase() === personal.toLowerCase());
  if (!home) {
    return { ...result, outcome: 'no-company' };
  }

  try {
    await ctx.switchCompany(home);
    return { ...result, outcome: 'switched', company: home };
  } catch (e: unknown) {
    return {
      success: false,
      message: `Role abandoned, but returning to ${home.name} failed: ${toErrorMessage(e)}`,
      outcome: 'unchanged',
    };
  }
}
