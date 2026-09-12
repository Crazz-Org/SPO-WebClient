/**
 * `AccountStatus` — the answer the world's InterfaceServer gives before `Logon`.
 *
 * The five values are declared in `Protocol/Protocol.pas:82-86`, and
 * `Interface Server/InterfaceServer.pas:3131-3168` is what produces them:
 * a live session holding the same name with the same password is retired and the
 * answer is `ACCOUNT_Valid` (`:3141-3151`); the same name with a DIFFERENT password
 * is `ACCOUNT_InvalidName` (`:3153`); anything else is delegated to
 * `WorldProxy.RDOAccountStatus` (`:3159`), and an absent proxy or an exception is
 * `ACCOUNT_UnknownError` (`:3160`, `:3168`).
 *
 * The reference client branched on this answer before calling `Logon`
 * (`Voyager/URLHandlers/ServerCnxHandler.pas:2763-2846`): 0 and 2 continue,
 * 3 / 4 / 1 abort with a message. The English wording below is that client's
 * (`ServerCnxHandler.pas:882-884`, `:899`).
 *
 * Nothing here ever puts an RDO payload in a message — the sentences are fixed.
 */

import { ERROR_Unknown, ERROR_InvalidUserName, ERROR_InvalidPassword } from './error-codes';
import { RDO_PREFIX_STRIP } from './rdo-types';

// Protocol/Protocol.pas:82-86 (`ACCOUNT_Forbiden = 5` at :87 is not answered by
// `TInterfaceServer.AccountStatus`; it falls through the default branch below).
export const ACCOUNT_Valid = 0;
export const ACCOUNT_UnknownError = 1;
export const ACCOUNT_Unexisting = 2;
export const ACCOUNT_InvalidName = 3;
export const ACCOUNT_InvalidPassword = 4;

/**
 * A world-side refusal of the credentials, raised before `Logon` is attempted.
 * `code` is the general `ERROR_*` number the gateway sends on, so the browser's
 * own `getErrorMessage(code)` also says something sensible.
 */
export class AccountStatusError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'AccountStatusError';
  }
}

/**
 * Decide what an `ACCOUNT_*` answer means for the login.
 * `null` means "continue" — the two values the reference client let through.
 */
export function accountStatusRefusal(status: number): AccountStatusError | null {
  switch (status) {
    case ACCOUNT_Valid:
    case ACCOUNT_Unexisting:
      // ServerCnxHandler.pas:2796-2798 — a first-time player is remembered as
      // NEWACCOUNT and carries on into Logon.
      return null;
    case ACCOUNT_InvalidPassword:
      // ServerCnxHandler.pas:884.
      return new AccountStatusError(
        status,
        ERROR_InvalidPassword,
        'You supplied an invalid password.',
      );
    case ACCOUNT_InvalidName:
      // ServerCnxHandler.pas:882. The second clause states what
      // InterfaceServer.pas:3139-3153 actually tested to get here.
      return new AccountStatusError(
        status,
        ERROR_InvalidUserName,
        'You supplied an invalid name: another session in this world already holds it.',
      );
    default:
      // ACCOUNT_UnknownError and anything the server invents later.
      // ServerCnxHandler.pas:899 ("ocurred" corrected).
      return new AccountStatusError(
        status,
        ERROR_Unknown,
        'An unknown error occurred while checking your account. Please try again later.',
      );
  }
}

/** The integer inside an `AccountStatus` answer, or `null` when it is not one. */
export function parseAccountStatus(raw: string): number | null {
  const cleaned = raw.replace(RDO_PREFIX_STRIP, '').trim();
  if (!/^-?\d+$/.test(cleaned)) return null;
  return Number.parseInt(cleaned, 10);
}
