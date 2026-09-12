/**
 * Bank loan handler — a visitor asks another tycoon's bank for a loan.
 *
 * `TBankBlock` publishes `RDOAskLoan( ClientId : integer; Amount : widestring ) : olevariant`
 * (`StdBlocks/Banks.pas:46`), a 2-argument function. Its body dereferences the
 * first argument as `TMoneyDealer(ClientId)` (`:165`), so what travels is the
 * MODEL SERVER'S pointer to the tycoon — `fTycoonProxyId` here, which is exactly
 * what Voyager's `getSecurityId` returns (`IntToStr(integer(fTycoonId))`,
 * `Voyager/URLHandlers/ServerCnxHandler.pas:2524-2527`). The amount travels as a
 * string because the server parses it itself (`StrToFloat(Amount)`, `:165`).
 *
 * The answer is an ordinal of `TBankRequestResult` (`Kernel/Kernel.pas:1750`).
 * Everything that goes wrong on the way — no security id, a failed call — is
 * Voyager's fourth, client-side ordinal `brqError`
 * (`Voyager/BankGeneralSheet.pas:22,438-444`): a distinguishable answer on
 * screen, never a thrown request.
 */

import type { SessionContext } from './session-context';
import type { BankLoanVerdict } from '../../shared/types';
import { TimeoutCategory } from '../../shared/timeout-categories';
import { parsePropertyResponse } from '../rdo-helpers';
import { RdoValue } from '../../shared/rdo-types';
import { rdoCall } from '../../shared/rdo-frame';
import { toErrorMessage } from '../../shared/error-utils';

/**
 * Wire ordinal → outcome.
 *
 * `Kernel/Kernel.pas:1750` declares `(brqApproved, brqRejected, brqNotEnoughFunds)`
 * — 0, 1, 2. Anything else the block answers ('3', '', garbage) is Voyager's
 * `brqError` (`Voyager/BankGeneralSheet.pas:22`), the failure ordinal the
 * reference client adds on its own side.
 */
export function bankLoanVerdictOf(raw: string): BankLoanVerdict {
  switch (raw.trim()) {
    case '0': return 'approved';
    case '1': return 'rejected';
    case '2': return 'notEnoughFunds';
    default: return 'error';
  }
}

export async function askBankLoan(
  ctx: SessionContext,
  x: number,
  y: number,
  amount: string,
): Promise<{ verdict: BankLoanVerdict; result: string }> {
  await ctx.connectMapService();
  const [currBlock] = await ctx.getCacherPropertyListAt(x, y, ['CurrBlock']);
  if (!currBlock) throw new Error(`No building found at (${x}, ${y})`);

  // BankGeneralSheet.pas:438-440 — no security id, no call, brqError.
  if (ctx.fTycoonProxyId === null) return { verdict: 'error', result: '' };

  if (!ctx.getSocket('construction')) {
    await ctx.connectConstructionService();
  }

  try {
    const packet = await ctx.sendRdoRequest('construction', rdoCall(
      'RDOAskLoan', currBlock, RdoValue.int(ctx.fTycoonProxyId), RdoValue.string(amount),
    ).packet, undefined, TimeoutCategory.NORMAL);

    const result = parsePropertyResponse(packet.payload || '', 'res');
    return { verdict: bankLoanVerdictOf(result), result };
  } catch (err: unknown) {
    // BankGeneralSheet.pas:443-444 — a failed call is brqError, not a crash.
    ctx.log.warn(`[BankLoan] RDOAskLoan failed at (${x}, ${y}): ${toErrorMessage(err)}`);
    return { verdict: 'error', result: '' };
  }
}
