/// <reference path="../../server/__tests__/matchers/rdo-matchers.d.ts" />

/**
 * L1 protocol scenario — sending a letter opened from Drafts, from the WS
 * request down to the frames.
 *
 * `MsgComposerHandler.pas:329-338` (`SendEvent`):
 *
 *   if ServerProxy.Post(fWorldName, Id)
 *     then begin
 *       if fCommand = cmOpen
 *         then ServerProxy.DeleteMessage(fWorldName, fAccount, tidFolder_Draft, fMessageId);
 *       ...
 *     end
 *     else ShowErrorMessage(...);
 *   ServerProxy.CloseMessage(Id);
 *
 * So `DeleteMessage` on the Draft folder fires only once `Post` has answered
 * true, and strictly before `CloseMessage`. This drives the real
 * `handleMailCompose` (not a re-implementation of it) with the `mail-ws-004`
 * request out of the mail scenario, and matches what it emits against the
 * scenario's own RDO exchanges (`mail-rdo-008` = DeleteMessage, matched by
 * member since its targetId is wildcarded), through the strict validator.
 */

jest.mock('node-fetch', () => ({
  __esModule: true,
  default: jest.fn(),
}));

import { RdoMock } from '../rdo-mock';
import { RdoStrictValidator } from '../rdo-strict-validator';
import { RdoProtocol } from '@/server/rdo';
import { composeMail } from '@/server/session/mail-handler';
import { handleMailCompose } from '@/server/ws-handlers/mail-handlers';
import type { WsHandlerContext } from '@/server/ws-handlers/types';
import { makeSessionCtx } from '@/server/__tests__/session/fake-session-context';
import type { FakeSessionCtx, SentRequest } from '@/server/__tests__/session/fake-session-context';
import { createMailScenario, CAPTURED_MAIL_SEND, CAPTURED_DRAFT_ID } from './mail-scenario';
import { DEFAULT_VARIABLES } from './scenario-variables';
import { RdoValue } from '@/shared/rdo-types';
import type { RdoPacket, WorldInfo, WsMessage, WsRespMailSent } from '@/shared/types';
import type { WsReqMailCompose } from '@/shared/types/message-types';

const WORLD: WorldInfo = {
  name: DEFAULT_VARIABLES.worldName,
  url: 'http://158.69.153.134',
  ip: '158.69.153.134',
  port: 7000,
};

const scenario = createMailScenario();

/** The `REQ_MAIL_COMPOSE` the scenario captured for a given exchange id. */
function scenarioRequest(id: string): WsReqMailCompose {
  const exchange = scenario.ws.exchanges.find(e => e.id === id);
  if (!exchange) throw new Error(`missing WS exchange ${id}`);
  return exchange.request as unknown as WsReqMailCompose;
}

function membersOf(sent: SentRequest[]): string[] {
  return sent.map(s => s.packet.member ?? '');
}

/** Drives `handleMailCompose` against a fake session whose `composeMail` calls the real one. */
function drive(fake: FakeSessionCtx) {
  const sentResponses: WsMessage[] = [];
  const wsCtx = {
    ws: { send: (payload: string) => { sentResponses.push(JSON.parse(payload) as WsMessage); } },
    session: {
      composeMail: (to: string, subject: string, body: string[], headers?: string, existingDraftId?: string) =>
        composeMail(fake.ctx, to, subject, body, headers, existingDraftId),
    },
  } as unknown as WsHandlerContext;
  return { wsCtx, sentResponses };
}

describe('L1: sending an opened draft — DeleteMessage after Post, before CloseMessage', () => {
  let rdoMock: RdoMock;
  let validator: RdoStrictValidator;

  beforeEach(() => {
    rdoMock = new RdoMock();
    validator = new RdoStrictValidator();
    rdoMock.addScenario(scenario.rdo);
    validator.addScenario(scenario.rdo);
  });

  afterEach(() => {
    const errors = validator.getErrors();
    if (errors.length > 0) {
      throw new Error(validator.formatReport());
    }
  });

  it('a successful Post fires DeleteMessage on the Draft folder before CloseMessage', async () => {
    const req = scenarioRequest('mail-ws-004');
    expect(req.existingDraftId).toBe(CAPTURED_DRAFT_ID);

    const fake = makeSessionCtx({
      sockets: ['mail'],
      mailAccount: DEFAULT_VARIABLES.mailAccount,
      currentWorldInfo: WORLD,
    });
    let frameCountAtPost = -1;
    let frameCountAtClose = -1;
    fake.respond((p: Partial<RdoPacket>) => {
      if (p.member === 'NewMail') return `NewMail="#${CAPTURED_MAIL_SEND.messageId}"`;
      if (p.member === 'Post') {
        frameCountAtPost = fake.frames.mail.length;
        return 'Post="#-1"';
      }
      if (p.member === 'CloseMessage') {
        frameCountAtClose = fake.frames.mail.length;
        return '';
      }
      return '';
    });

    const { wsCtx, sentResponses } = drive(fake);
    await handleMailCompose(wsCtx, req as unknown as WsMessage);

    expect(frameCountAtPost).toBe(0);
    expect(frameCountAtClose).toBe(1);
    expect(fake.frames.mail).toHaveLength(1);
    expect(membersOf(fake.sent)).toEqual(['NewMail', 'AddLine', 'Post', 'CloseMessage']);

    const deleteFrame = fake.frames.mail[0];
    validator.validate(RdoProtocol.parse(deleteFrame), deleteFrame);
    const match = rdoMock.match(deleteFrame);
    expect(match).not.toBeNull();
    expect(match!.exchange.id).toBe('mail-rdo-008');

    expect(deleteFrame).toMatchRdoCallFormat('DeleteMessage');
    expect(deleteFrame).toContain(RdoValue.string('Draft').format());
    expect(deleteFrame).toContain(RdoValue.string(CAPTURED_DRAFT_ID).format());
    expect(deleteFrame).toContain('"*"');

    expect(sentResponses).toHaveLength(1);
    expect(sentResponses[0]).toMatchObject({
      type: 'RESP_MAIL_SENT',
      wsRequestId: 'mail-004',
      success: true,
    } as Partial<WsRespMailSent>);
  });

  it('a failing Post sends no DeleteMessage but still closes the message', async () => {
    const req = scenarioRequest('mail-ws-004');

    const fake = makeSessionCtx({
      sockets: ['mail'],
      mailAccount: DEFAULT_VARIABLES.mailAccount,
      currentWorldInfo: WORLD,
    });
    fake.respond((p: Partial<RdoPacket>) => {
      if (p.member === 'NewMail') return `NewMail="#${CAPTURED_MAIL_SEND.messageId}"`;
      if (p.member === 'Post') return 'Post="#0"';
      return '';
    });

    const { wsCtx, sentResponses } = drive(fake);
    await handleMailCompose(wsCtx, req as unknown as WsMessage);

    expect(fake.frames.mail).toHaveLength(0);
    expect(membersOf(fake.sent)).toEqual(['NewMail', 'AddLine', 'Post', 'CloseMessage']);
    expect(sentResponses[0]).toMatchObject({ type: 'RESP_MAIL_SENT', success: false });
  });

  it('a brand-new message (no existingDraftId) issues no delete at all', async () => {
    const req = scenarioRequest('mail-ws-001');
    expect(req.existingDraftId).toBeUndefined();

    const fake = makeSessionCtx({
      sockets: ['mail'],
      mailAccount: DEFAULT_VARIABLES.mailAccount,
      currentWorldInfo: WORLD,
    });
    fake.respond((p: Partial<RdoPacket>) => {
      if (p.member === 'NewMail') return `NewMail="#${CAPTURED_MAIL_SEND.messageId}"`;
      if (p.member === 'Post') return 'Post="#-1"';
      return '';
    });

    const { wsCtx, sentResponses } = drive(fake);
    await handleMailCompose(wsCtx, req as unknown as WsMessage);

    expect(fake.frames.mail).toHaveLength(0);
    expect(sentResponses[0]).toMatchObject({ type: 'RESP_MAIL_SENT', success: true });
  });
});
