/// <reference path="../../server/__tests__/matchers/rdo-matchers.d.ts" />

/**
 * The context-status ask at the WS frontier, driven through the L1 substrate.
 *
 * Proves the wire half of issue 589: a camera position turns into one
 * `ContextStatusText "^" "#x","#y"` frame against the client view, and the
 * answer comes back out as `RESP_CONTEXT_STATUS`. Both answers the source
 * guarantees are covered — a sentence, and the empty string for "no town here"
 * (`Kernel/World.pas:4243`), which the client renders as a hidden strip.
 *
 * Everything upstream of `getContextStatusText` — the WS handler, the session
 * context — is exercised for real; only the socket is mocked, through `RdoMock`.
 */

import type { WebSocket } from 'ws';
import { RdoProtocol } from '@/server/rdo';
import type { RdoPacket } from '@/shared/types/protocol-types';
import { WsMessageType, type WsMessage } from '@/shared/types';
import { getContextStatusText } from '@/server/session/context-status-handler';
import { handleContextStatus } from '@/server/ws-handlers/map-handlers';
import type { WsHandlerContext } from '@/server/ws-handlers/types';
import { makeSessionCtx } from '@/server/__tests__/session/fake-session-context';
import { RdoMock } from '../rdo-mock';
import {
  createContextStatusScenario,
  PLAUSIBLE_CONTEXT_SENTENCE,
  CONTEXT_TOWN_POSITION,
  CONTEXT_EMPTY_POSITION,
} from './context-status-scenario';

const { rdo } = createContextStatusScenario();

/** Drives `handleContextStatus` through a fresh RdoMock. */
function drive() {
  const rdoMock = new RdoMock();
  rdoMock.addScenario(rdo);

  const sentCommands: string[] = [];
  let nextRid = 80;

  const fake = makeSessionCtx({ sockets: ['world'] });
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
      getContextStatusText: (x: number, y: number) => getContextStatusText(fake.ctx, x, y),
    },
  } as unknown as WsHandlerContext;

  return { wsCtx, sentCommands, sentResponses, rdoMock };
}

const request = (x: number, y: number): WsMessage => ({
  type: WsMessageType.REQ_CONTEXT_STATUS,
  wsRequestId: 'req-1',
  x,
  y,
}) as unknown as WsMessage;

describe('context-status-scenario — the town under the camera at the WS frontier', () => {
  it('passes strict RDO validation', () => {
    expect(rdo).toPassStrictRdoValidation();
  });

  it('a camera move over a town asks ContextStatusText and renders the answer', async () => {
    const { wsCtx, sentCommands, sentResponses, rdoMock } = drive();

    await handleContextStatus(wsCtx, request(CONTEXT_TOWN_POSITION.x, CONTEXT_TOWN_POSITION.y));

    expect(sentCommands).toHaveLength(1);
    const parsed = RdoProtocol.parse(sentCommands[0]);
    expect(parsed.member).toBe('ContextStatusText');
    expect(parsed.separator).toBe('"^"');
    // `RdoProtocol.parse` unquotes each argument; the `#` prefix is what matters.
    expect(parsed.args).toEqual([
      `#${CONTEXT_TOWN_POSITION.x}`,
      `#${CONTEXT_TOWN_POSITION.y}`,
    ]);
    expect(rdoMock.getConsumedIds()).toContain('ctx-rdo-001');

    expect(sentResponses).toEqual([{
      type: WsMessageType.RESP_CONTEXT_STATUS,
      wsRequestId: 'req-1',
      text: PLAUSIBLE_CONTEXT_SENTENCE,
    }]);
  });

  it('a camera move over open land answers the empty string, not an error', async () => {
    const { wsCtx, sentResponses, rdoMock } = drive();

    await handleContextStatus(wsCtx, request(CONTEXT_EMPTY_POSITION.x, CONTEXT_EMPTY_POSITION.y));

    expect(rdoMock.getConsumedIds()).toContain('ctx-rdo-002');
    expect(sentResponses).toEqual([{
      type: WsMessageType.RESP_CONTEXT_STATUS,
      wsRequestId: 'req-1',
      text: '',
    }]);
  });
});
