/**
 * The `ACCOUNT_*` decision table (Protocol.pas:82-86), and the promise that no
 * refusal sentence ever carries a piece of the RDO answer.
 */

import { describe, it, expect } from '@jest/globals';
import {
  ACCOUNT_Valid,
  ACCOUNT_UnknownError,
  ACCOUNT_Unexisting,
  ACCOUNT_InvalidName,
  ACCOUNT_InvalidPassword,
  AccountStatusError,
  accountStatusRefusal,
  parseAccountStatus,
} from './account-status';
import { ERROR_Unknown, ERROR_InvalidUserName, ERROR_InvalidPassword } from './error-codes';

describe('parseAccountStatus', () => {
  it.each([
    ['0', 0],
    ['4', 4],
    ['#2', 2],
    ['-1', -1],
  ])('reads %s as %i', (raw, expected) => {
    expect(parseAccountStatus(raw)).toBe(expected);
  });

  it.each([[''], ['x'], ['%'], ['4abc']])('answers null for %p', (raw) => {
    expect(parseAccountStatus(raw)).toBeNull();
  });
});

describe('accountStatusRefusal', () => {
  it.each([[ACCOUNT_Valid], [ACCOUNT_Unexisting]])('lets %i through', (status) => {
    expect(accountStatusRefusal(status)).toBeNull();
  });

  it('refuses a wrong password with the password code', () => {
    const refusal = accountStatusRefusal(ACCOUNT_InvalidPassword);
    expect(refusal).toBeInstanceOf(AccountStatusError);
    expect(refusal?.status).toBe(ACCOUNT_InvalidPassword);
    expect(refusal?.code).toBe(ERROR_InvalidPassword);
    expect(refusal?.message).toBe('You supplied an invalid password.');
    expect(refusal?.name).toBe('AccountStatusError');
  });

  it('gives a name already held by a live session its own message and code', () => {
    const refusal = accountStatusRefusal(ACCOUNT_InvalidName);
    expect(refusal?.code).toBe(ERROR_InvalidUserName);
    expect(refusal?.code).not.toBe(ERROR_InvalidPassword);
    expect(refusal?.message).toContain('already holds it');
  });

  it.each([[ACCOUNT_UnknownError], [5], [7]])('maps %i to the unknown-error refusal', (status) => {
    const refusal = accountStatusRefusal(status);
    expect(refusal?.code).toBe(ERROR_Unknown);
    expect(refusal?.status).toBe(status);
    expect(refusal?.message).toContain('unknown error');
  });

  it('never puts RDO payload characters in a message', () => {
    for (const status of [ACCOUNT_UnknownError, ACCOUNT_InvalidName, ACCOUNT_InvalidPassword, 9]) {
      const message = accountStatusRefusal(status)?.message ?? '';
      expect(message).not.toContain('res=');
      expect(message).not.toContain('"');
      expect(message).not.toContain('#');
      expect(message).not.toContain('%');
    }
  });
});
