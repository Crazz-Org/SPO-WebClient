/**
 * Tests for the Directory Server error codes.
 *
 * The point of this module is that it is NOT the general `ERROR_*` table: the
 * same small integers mean different things in the two numbering spaces, and
 * the bug this file guards against is a directory answer being worded from the
 * general table (7 → "Unknown tycoon" instead of the wrong-password sentence).
 * The reference is `DServer/DirectoryServerProtocol.pas:9-20`.
 */

import * as errorCodes from './error-codes';
import { getErrorMessage } from './error-codes';
import * as dirCodes from './directory-error-codes';
import { getDirectoryErrorMessage } from './directory-error-codes';

/** Every sentence the general table can produce, for any code it declares. */
const GENERAL_MESSAGES = new Set(
  Object.values(errorCodes)
    .filter((value) => typeof value === 'number')
    .map((value) => getErrorMessage(value as number)),
);

const REFUSAL_CODES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

describe('directory code values — DirectoryServerProtocol.pas:9-20', () => {
  it.each([
    ['DIR_NOERROR_StillTrial', -1],
    ['DIR_NOERROR', 0],
    ['DIR_ERROR_Unknown', 1],
    ['DIR_ERROR_AccountAlreadyExists', 2],
    ['DIR_ERROR_UnexistingAccount', 3],
    ['DIR_ERROR_SerialMaxed', 4],
    ['DIR_ERROR_InvalidSerial', 5],
    ['DIR_ERROR_InvalidAlias', 6],
    ['DIR_ERROR_InvalidPassword', 7],
    ['DIR_ERROR_AccountBlocked', 8],
    ['DIR_ERROR_TrialExpired', 9],
    ['DIR_ERROR_SubscriberIdNotFound', 10],
  ])('%s is %i on the wire', (name, value) => {
    expect(dirCodes[name as keyof typeof dirCodes]).toBe(value);
  });
});

describe('getDirectoryErrorMessage', () => {
  // The criterion: each refusal owns a sentence, and none of them is a sentence
  // the general ERROR_* table would have produced for the same number.
  it.each(REFUSAL_CODES)('code %i has its own sentence, never an ERROR_* one', (code) => {
    const message = getDirectoryErrorMessage(code);

    expect(message.length).toBeGreaterThan(0);
    expect(message).not.toBe(`Directory error ${code}`);
    expect(GENERAL_MESSAGES.has(message)).toBe(false);
  });

  it('gives the ten refusals ten distinct sentences', () => {
    const messages = REFUSAL_CODES.map(getDirectoryErrorMessage);
    expect(new Set(messages).size).toBe(messages.length);
  });

  it('words a wrong password with the legacy two-causes text', () => {
    const message = getDirectoryErrorMessage(dirCodes.DIR_ERROR_InvalidPassword);
    expect(message).toContain('two possible causes');
    expect(message).toContain('invalid password');
    // The bug: 7 in the general space is "Unknown tycoon".
    expect(message).not.toBe(getErrorMessage(errorCodes.ERROR_UnknownTycoon));
  });

  it('treats both success codes as no error', () => {
    expect(getDirectoryErrorMessage(dirCodes.DIR_NOERROR)).toBe('No error');
    expect(getDirectoryErrorMessage(dirCodes.DIR_NOERROR_StillTrial)).toBe('No error');
  });

  it.each([11, 99, -2])('falls back to a numbered sentence for %i', (code) => {
    expect(getDirectoryErrorMessage(code)).toBe(`Directory error ${code}`);
  });
});
