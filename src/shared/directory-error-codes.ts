/**
 * Directory Server error codes — the numbers `RDOLogonUser` answers.
 *
 * Declared in `DServer/DirectoryServerProtocol.pas:9-20`. This is a SECOND
 * numbering space, unrelated to the general `ERROR_*` table in `error-codes.ts`
 * (`Protocol/Protocol.pas`): there, 7 is "Unknown tycoon"; here, 7 is a wrong
 * password. Translating a directory answer with `getErrorMessage()` therefore
 * prints an unrelated sentence, which is why the two tables live in two files.
 *
 * The wording follows the legacy logon page where it has one
 * (`~/SPO-ASP/Five/0/language/NewLogon.lng:109-118`); the refusals that page
 * never worded get one short authored sentence each.
 */

export const DIR_NOERROR_StillTrial = -1;
export const DIR_NOERROR = 0;
export const DIR_ERROR_Unknown = 1;
export const DIR_ERROR_AccountAlreadyExists = 2;
export const DIR_ERROR_UnexistingAccount = 3;
export const DIR_ERROR_SerialMaxed = 4;
export const DIR_ERROR_InvalidSerial = 5;
export const DIR_ERROR_InvalidAlias = 6;
export const DIR_ERROR_InvalidPassword = 7;
export const DIR_ERROR_AccountBlocked = 8;
export const DIR_ERROR_TrialExpired = 9;
export const DIR_ERROR_SubscriberIdNotFound = 10;

/**
 * Human-readable sentence for a Directory Server code.
 * Never feed an `ERROR_*` code to this function, nor a `DIR_*` code to
 * `getErrorMessage()` — the two spaces overlap and neither can detect the swap.
 */
export function getDirectoryErrorMessage(code: number): string {
  switch (code) {
    case DIR_NOERROR_StillTrial:
    case DIR_NOERROR:
      return 'No error';
    case DIR_ERROR_Unknown:
      // NewLogon.lng:117-118 ("ocurred" corrected).
      return 'An unknown error occurred. If you get this kind of error often please report to Starpeace Online Team Support.';
    case DIR_ERROR_AccountAlreadyExists:
      // NewLogon.lng:110.
      return 'There is someone using the name you specified.';
    case DIR_ERROR_UnexistingAccount:
      return 'There is no account with that name.';
    case DIR_ERROR_SerialMaxed:
      return 'This serial number has already reached its maximum number of accounts.';
    case DIR_ERROR_InvalidSerial:
      return 'The serial number for this account is not valid.';
    case DIR_ERROR_InvalidAlias:
      // The slot Voyager maps to ERROR_InvalidUserName (LogonHandlerViewer.pas:566-567);
      // text NewLogon.lng:109-110, tags stripped.
      return 'Invalid User Name. There is someone using the name you specified.';
    case DIR_ERROR_InvalidPassword:
      // NewLogon.lng:111-113, tags stripped.
      return 'There are two possible causes for this error: (a) You are logging for the first time and you chose a name that is already taken. (b) You have already an identity in this world but you specified an invalid password or misspelled your name. Let us know in case you forgot your password. We can help you to get it back.';
    case DIR_ERROR_AccountBlocked:
      // Voyager's Literal_AccCancelled slot (LogonHandlerViewer.pas:645-650).
      return 'Your account has been cancelled.';
    case DIR_ERROR_TrialExpired:
      // Voyager's Literal_TrialOver slot (LogonHandlerViewer.pas:645-648).
      return 'Your trial period is over.';
    case DIR_ERROR_SubscriberIdNotFound:
      return 'No subscriber is registered under that ID.';
    default:
      return `Directory error ${code}`;
  }
}
