/// <reference path="../../server/__tests__/matchers/rdo-matchers.d.ts" />
jest.mock('node-fetch', () => ({
  __esModule: true,
  default: jest.fn(),
}));

/**
 * The mail read path at the WS frontier, driven through the L1 substrate.
 *
 * Proves the one fact the plan for issue 504 turns on: reading an Inbox
 * message produces the RDO read sequence plus exactly one header-touching
 * HTTP GET (MessageBody.asp, `mail-http-005`); the same request for a Draft
 * produces none. Everything upstream of `readMailMessage` — the WS handler,
 * the session context — is exercised for real; only the socket and the fetch
 * are mocked, through `RdoMock` / `HttpMock`.
 */

import fetch from 'node-fetch';
import type { Response } from 'node-fetch';
import type { WebSocket } from 'ws';
import { RdoProtocol } from '@/server/rdo';
import type { RdoPacket } from '@/shared/types/protocol-types';
import { WsMessageType, type WsMessage } from '@/shared/types';
import { readMailMessage as readMailMessageHandler } from '@/server/session/mail-handler';
import { handleMailReadMessage } from '@/server/ws-handlers/mail-handlers';
import type { WsHandlerContext } from '@/server/ws-handlers/types';
import { makeSessionCtx } from '@/server/__tests__/session/fake-session-context';
import { RdoMock } from '../rdo-mock';
import { HttpMock } from '../http-mock';
import { createMailScenario } from './mail-scenario';
import { DEFAULT_VARIABLES } from './scenario-variables';

const mockFetch = fetch as unknown as jest.MockedFunction<
  (url: string, init?: unknown) => Promise<Response>
>;

const { rdo, http } = createMailScenario();

function membersOf(sent: string[]): string[] {
  return sent.map(cmd => RdoProtocol.parse(cmd).member ?? '');
}

/** Drives `handleMailReadMessage` through a fresh RdoMock/HttpMock pair. */
function drive() {
  const rdoMock = new RdoMock();
  rdoMock.addScenario(rdo);
  const httpMock = new HttpMock();
  httpMock.addScenario(http);

  mockFetch.mockImplementation(async (url: string) => {
    const result = httpMock.match('GET', url);
    if (!result) return { ok: false, status: 404, text: async () => '' } as unknown as Response;
    return { ok: result.status === 200, status: result.status, text: async () => result.body } as unknown as Response;
  });

  const sentCommands: string[] = [];
  let nextRid = 3000;

  const fake = makeSessionCtx({
    sockets: ['mail'],
    mailAccount: DEFAULT_VARIABLES.mailAccount,
    mailServerId: DEFAULT_VARIABLES.mailServerId,
    currentWorldInfo: {
      name: DEFAULT_VARIABLES.worldName,
      url: DEFAULT_VARIABLES.worldUrl,
      ip: DEFAULT_VARIABLES.worldIp,
      port: DEFAULT_VARIABLES.worldPort,
    },
  });
  fake.respond((packet) => {
    const rid = nextRid++;
    const command = RdoProtocol.format({ ...packet, raw: '', type: 'REQUEST', rid } as RdoPacket);
    sentCommands.push(command);
    const result = rdoMock.match(command);
    if (!result) throw new Error(`L1: no exchange for ${command}`);
    return result.response.replace(/^A\d+\s*/, '');
  });

  const sentResponses: WsMessage[] = [];
  const ws = {
    send: jest.fn((payload: string) => { sentResponses.push(JSON.parse(payload) as WsMessage); }),
  } as unknown as WebSocket;

  const wsCtx = {
    ws,
    session: {
      readMailMessage: (folder: string, messageId: string) =>
        readMailMessageHandler(fake.ctx, folder, messageId),
    },
  } as unknown as WsHandlerContext;

  return { wsCtx, sentCommands, sentResponses };
}

const request = (folder: string, messageId: string): WsMessage => ({
  type: WsMessageType.REQ_MAIL_READ_MESSAGE,
  wsRequestId: 'req-1',
  folder,
  messageId,
}) as unknown as WsMessage;

describe('mail-scenario — readMailMessage at the WS frontier', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('an Inbox read runs the RDO sequence and touches MessageBody.asp exactly once', async () => {
    const { wsCtx, sentCommands, sentResponses } = drive();

    await handleMailReadMessage(wsCtx, request('Inbox', 'MSG-77'));

    expect(membersOf(sentCommands)).toEqual([
      'OpenMessage', 'GetHeaders', 'GetLines', 'GetAttachmentCount', 'CloseMessage',
    ]);
    // OpenMessage on the mail server, the three reads on the message it
    // answered, and the message handed back to the server to close.
    expect(sentCommands).toEqual([
      'C 3000 sel 30437308 call OpenMessage "^" "%Shamba","%SPO_test3@Shamba.net","%Inbox","%MSG-77"',
      'C 3001 sel 30430750 call GetHeaders "^" "#0"',
      'C 3002 sel 30430750 call GetLines "^" "#0"',
      'C 3003 sel 30430750 call GetAttachmentCount "^" "#0"',
      'C 3004 sel 30437308 call CloseMessage "*" "#30430750"',
    ]);
    expect(sentCommands).toPassStrictRdoValidation(rdo);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const url = mockFetch.mock.calls[0][0] as string;
    const httpMock = new HttpMock();
    httpMock.addScenario(http);
    const matched = httpMock.match('GET', url);
    expect(matched?.exchange.id).toBe('mail-http-005');
    expect(sentResponses).toHaveLength(1);
    expect(sentResponses[0]).toMatchObject({ type: WsMessageType.RESP_MAIL_MESSAGE, wsRequestId: 'req-1' });
  });

  it('a Draft read runs the same RDO sequence and touches nothing over HTTP', async () => {
    const { wsCtx, sentCommands, sentResponses } = drive();

    await handleMailReadMessage(wsCtx, request('Draft', 'MSG-77'));

    expect(membersOf(sentCommands)).toEqual([
      'OpenMessage', 'GetHeaders', 'GetLines', 'GetAttachmentCount', 'CloseMessage',
    ]);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(sentResponses).toHaveLength(1);
    expect(sentResponses[0]).toMatchObject({ type: WsMessageType.RESP_MAIL_MESSAGE, wsRequestId: 'req-1' });
  });
});
