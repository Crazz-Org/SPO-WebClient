/**
 * REQ_AUTH_CHECK at the WebSocket frontier.
 *
 * The number `AuthError` carries comes from `RDOLogonUser`, so it belongs to the
 * Directory Server's numbering space (`DirectoryServerProtocol.pas:9-20`) and must
 * be worded from that table. Wording it from the general `ERROR_*` table turned a
 * wrong password (7) into "Unknown tycoon" — the regression this file pins.
 */

import { describe, it, expect, jest } from '@jest/globals';
import type { WebSocket } from 'ws';
import { WsMessageType, type WsMessage } from '../../../shared/types';
import { handleAuthCheck, handleLoginWorld } from '../auth-handlers';
import { AuthError } from '../../../shared/auth-error';
import { AccountStatusError, ACCOUNT_InvalidPassword } from '../../../shared/account-status';
import { getErrorMessage, ERROR_UnknownTycoon, ERROR_InvalidLogonData, ERROR_InvalidPassword } from '../../../shared/error-codes';
import { getDirectoryErrorMessage } from '../../../shared/directory-error-codes';
import type { WsHandlerContext } from '../types';

interface Recorded {
  ctx: WsHandlerContext;
  sent: Array<Record<string, unknown>>;
  checkAuth: jest.Mock;
}

function createCtx(checkAuth: jest.Mock): Recorded {
  const sent: Array<Record<string, unknown>> = [];
  const ws = {
    send(payload: string): void {
      sent.push(JSON.parse(payload) as Record<string, unknown>);
    },
  } as unknown as WebSocket;

  const ctx = { ws, session: { checkAuth } } as unknown as WsHandlerContext;
  return { ctx, sent, checkAuth };
}

const request = (over: Partial<Record<string, unknown>> = {}): WsMessage => ({
  type: WsMessageType.REQ_AUTH_CHECK,
  wsRequestId: '123',
  username: 'SPO_test3',
  password: 'test3',
  ...over,
}) as unknown as WsMessage;

describe('handleAuthCheck', () => {
  it('words a wrong password from the directory table, not "Unknown tycoon"', async () => {
    const { ctx, sent } = createCtx(jest.fn(async () => { throw new AuthError(7); }));

    await handleAuthCheck(ctx, request());

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: WsMessageType.RESP_ERROR,
      wsRequestId: '123',
      code: 7,
      errorMessage: getDirectoryErrorMessage(7),
    });
    expect(sent[0].errorMessage).toContain('two possible causes');
    expect(sent[0].errorMessage).not.toBe(getErrorMessage(ERROR_UnknownTycoon));
  });

  it.each([[3], [6], [8], [9]])('words DIR code %i from the directory table', async (code) => {
    const { ctx, sent } = createCtx(jest.fn(async () => { throw new AuthError(code); }));

    await handleAuthCheck(ctx, request());

    expect(sent[0]).toMatchObject({ code, errorMessage: getDirectoryErrorMessage(code) });
  });

  it('refuses a request with no credentials before touching the session', async () => {
    const { ctx, sent, checkAuth } = createCtx(jest.fn(async () => undefined));

    await handleAuthCheck(ctx, request({ username: '', password: '' }));

    expect(checkAuth).not.toHaveBeenCalled();
    expect(sent[0]).toMatchObject({
      type: WsMessageType.RESP_ERROR,
      code: ERROR_InvalidLogonData,
      errorMessage: 'Username and password required',
    });
  });

  it('answers RESP_AUTH_SUCCESS on a valid logon', async () => {
    const { ctx, sent, checkAuth } = createCtx(jest.fn(async () => undefined));

    await handleAuthCheck(ctx, request());

    expect(checkAuth).toHaveBeenCalledWith('SPO_test3', 'test3');
    expect(sent[0]).toMatchObject({
      type: WsMessageType.RESP_AUTH_SUCCESS,
      wsRequestId: '123',
    });
  });

  it('lets a non-AuthError failure propagate', async () => {
    const { ctx, sent } = createCtx(jest.fn(async () => { throw new Error('socket died'); }));

    await expect(handleAuthCheck(ctx, request())).rejects.toThrow('socket died');
    expect(sent).toHaveLength(0);
  });
});

/**
 * The world's `AccountStatus` refusal has to be WORDED here: the top-level router
 * (`server.ts:1221-1229`) turns every error a handler throws into "Internal server
 * error", so a refusal that propagates never reaches the player.
 */
describe('handleLoginWorld', () => {
  interface WorldRecorded {
    ctx: WsHandlerContext;
    sent: Array<Record<string, unknown>>;
    cleanupWorldSession: jest.Mock;
    setLanguageId: jest.Mock;
    /** Every session call in order, so "before loginWorld" is checkable. */
    order: string[];
  }

  function createWorldCtx(loginWorld: jest.Mock): WorldRecorded {
    const sent: Array<Record<string, unknown>> = [];
    const ws = {
      send(payload: string): void {
        sent.push(JSON.parse(payload) as Record<string, unknown>);
      },
    } as unknown as WebSocket;
    const cleanupWorldSession = jest.fn(async () => undefined);
    const order: string[] = [];
    const setLanguageId = jest.fn(() => { order.push('setLanguageId'); });
    const recordedLogin = jest.fn((...args: unknown[]) => {
      order.push('loginWorld');
      return (loginWorld as (...a: unknown[]) => unknown)(...args);
    });
    const session = {
      isWorldConnected: () => false,
      getWorldInfo: () => ({ name: 'planitia', ip: '1.2.3.4', port: 8000 }),
      cleanupWorldSession,
      setLanguageId,
      loginWorld: recordedLogin,
    };
    const ctx = { ws, session } as unknown as WsHandlerContext;
    return { ctx, sent, cleanupWorldSession, setLanguageId, order };
  }

  const loginRequest = (): WsMessage => ({
    type: WsMessageType.REQ_LOGIN_WORLD,
    wsRequestId: '77',
    username: 'SPO_test3',
    password: 'wrong',
    worldName: 'planitia',
  }) as unknown as WsMessage;

  it('words a wrong password as a message instead of letting the router mask it', async () => {
    const { ctx, sent, cleanupWorldSession } = createWorldCtx(jest.fn(async () => {
      throw new AccountStatusError(ACCOUNT_InvalidPassword, ERROR_InvalidPassword, 'You supplied an invalid password.');
    }));

    await handleLoginWorld(ctx, loginRequest());

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: WsMessageType.RESP_ERROR,
      wsRequestId: '77',
      code: ERROR_InvalidPassword,
      errorMessage: 'You supplied an invalid password.',
    });
    expect(cleanupWorldSession).toHaveBeenCalledTimes(1);
  });

  it('lets a non-AccountStatusError failure propagate', async () => {
    const { ctx, sent } = createWorldCtx(jest.fn(async () => { throw new Error('socket died'); }));

    await expect(handleLoginWorld(ctx, loginRequest())).rejects.toThrow('socket died');
    expect(sent).toHaveLength(0);
  });

  it('puts the language the browser picked on the session before the login runs', async () => {
    const { ctx, setLanguageId, order } = createWorldCtx(jest.fn(async () => ({ companies: [] })));

    await handleLoginWorld(ctx, { ...loginRequest(), languageId: '2' } as unknown as WsMessage);

    expect(setLanguageId).toHaveBeenCalledWith('2');
    // The language must reach the session before SetLanguage is emitted inside loginWorld.
    expect(order).toEqual(['setLanguageId', 'loginWorld']);
  });

  it('a login without the field still sets it, so a stale id cannot survive a re-login', async () => {
    const { ctx, setLanguageId } = createWorldCtx(jest.fn(async () => ({ companies: [] })));

    await handleLoginWorld(ctx, loginRequest());

    expect(setLanguageId).toHaveBeenCalledWith(undefined);
  });
});
