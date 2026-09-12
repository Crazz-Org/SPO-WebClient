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
import { handleAuthCheck, handleConnectDirectory } from '../auth-handlers';
import { AuthError } from '../../../shared/auth-error';
import { getErrorMessage, ERROR_UnknownTycoon, ERROR_InvalidLogonData } from '../../../shared/error-codes';
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

// ── REQ_CONNECT_DIRECTORY ───────────────────────────────────────────────────

const WORLDS = [{ name: 'planitia', ip: '1.2.3.4', port: 8000, url: '' }];

/** A session whose directory query already ran and reported `atWorldLimit`. */
function createDirectoryCtx(atWorldLimit: boolean | null): { ctx: WsHandlerContext; sent: Array<Record<string, unknown>> } {
  const sent: Array<Record<string, unknown>> = [];
  const ws = {
    send(payload: string): void {
      sent.push(JSON.parse(payload) as Record<string, unknown>);
    },
  } as unknown as WebSocket;
  const session = {
    connectDirectory: jest.fn(async () => WORLDS),
    isAtWorldLimit: jest.fn(() => atWorldLimit),
  };
  return { ctx: { ws, session } as unknown as WsHandlerContext, sent };
}

const connectRequest = (over: Partial<Record<string, unknown>> = {}): WsMessage => ({
  type: WsMessageType.REQ_CONNECT_DIRECTORY,
  wsRequestId: '9',
  username: 'SPO_test3',
  password: 'test3',
  zonePath: 'Root/Areas/Asia/Worlds',
  ...over,
}) as unknown as WsMessage;

describe('handleConnectDirectory', () => {
  it('carries atWorldLimit when RDOCanJoinNewWorld answered 0', async () => {
    const { ctx, sent } = createDirectoryCtx(true);

    await handleConnectDirectory(ctx, connectRequest());

    expect(sent[0]).toMatchObject({
      type: WsMessageType.RESP_CONNECT_SUCCESS,
      wsRequestId: '9',
      worlds: WORLDS,
      atWorldLimit: true,
    });
  });

  it.each([[false], [null]])('omits the key entirely when the session reports %s', async (answer) => {
    const { ctx, sent } = createDirectoryCtx(answer);

    await handleConnectDirectory(ctx, connectRequest());

    expect(sent[0]).toMatchObject({ type: WsMessageType.RESP_CONNECT_SUCCESS, worlds: WORLDS });
    expect(sent[0]).not.toHaveProperty('atWorldLimit');
  });

  it('refuses a request with no credentials before touching the session', async () => {
    const { ctx, sent } = createDirectoryCtx(true);

    await handleConnectDirectory(ctx, connectRequest({ username: '', password: '' }));

    expect(sent[0]).toMatchObject({ type: WsMessageType.RESP_ERROR, code: ERROR_InvalidLogonData });
  });
});
