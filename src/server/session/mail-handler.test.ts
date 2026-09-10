/// <reference path="../__tests__/matchers/rdo-matchers.d.ts" />

/**
 * mail-handler — the Mail Server members, on the `mail` socket, plus the two
 * HTTP scrapes: MessageList.asp (lists a folder) and MessageBody.asp (touched
 * after an Inbox read so the mail server's Read flag is set, see the file
 * header of mail-handler.ts).
 *
 * Two channels, and this file watches both:
 *   - `sendRdoRequest` (`fake.sent`) — the functions (`NewMail`, `Post`,
 *     `Save`, `OpenMessage`, `GetHeaders`, `GetLines`, `GetAttachmentCount`,
 *     `GetAttachment`, `CheckNewMail`) go without an explicit separator, so
 *     `RdoProtocol.format()` picks `"^"` from the presence of the QueryId
 *     (rdo.ts:424-426); and the two VOID members
 *       `procedure AddLine( line : widestring )` — MailServer.pas:140
 *       `procedure CloseMessage( Id : integer )` — MailServer.pas:112
 *     which the reference client sends `"*"` WITH a QueryId, acked `A<id> ;`
 *     (observed on the live wire).
 *   - `writeRdoFrame` (`fake.frames.mail`) — `AddHeaders` and `DeleteMessage`,
 *     fire-and-forget, `"*"` and no QueryId. `mail-handler-emission.test.ts`
 *     is blind to this channel (`write: () => true`); this file is not.
 *
 * The message id `NewMail` / `OpenMessage` answer is the one every
 * `AddLine`, `Get*` and `CloseMessage` must carry — it is never one of the
 * context ids, and never a constant.
 */

jest.mock('node-fetch', () => ({
  __esModule: true,
  default: jest.fn(),
}));

import fetch from 'node-fetch';
import type { Response } from 'node-fetch';
import {
  composeMail,
  saveDraft,
  readMailMessage,
  deleteMailMessage,
  getMailUnreadCount,
  getMailFolder,
} from './mail-handler';
import { makeSessionCtx, FAKE_CONTEXT_IDS } from '../__tests__/session/fake-session-context';
import type { FakeSessionCtx, SentRequest } from '../__tests__/session/fake-session-context';
import type { SessionContext } from './session-context';
import type { RdoPacket, WorldInfo } from '../../shared/types';
import { RdoValue, RdoCommand } from '../../shared/rdo-types';
import { RdoVerb, RdoAction } from '../../shared/types';
import { TimeoutCategory } from '../../shared/timeout-categories';

const mockFetch = fetch as unknown as jest.MockedFunction<
  (url: string, init?: unknown) => Promise<Response>
>;

function htmlResponse(body: string, status = 200): Response {
  return { status, ok: status === 200, text: async () => body } as unknown as Response;
}

const MAIL_SERVER = FAKE_CONTEXT_IDS.mailServerId;
const MAIL_INT_SERVER = FAKE_CONTEXT_IDS.mailIntServerId;
// The message id the fake server hands back — distinct from every
// context id and every argument.
const MSG_ID = '30437308';
const ACCOUNT = 'SPO_test3@shamba.net';
const WORLD: WorldInfo = { name: 'Shamba', url: 'http://158.69.153.134', ip: '158.69.153.134', port: 7000 };

function makeMailCtx(overrides: Partial<SessionContext> = {}): FakeSessionCtx {
  return makeSessionCtx({ sockets: ['mail'], mailAccount: ACCOUNT, currentWorldInfo: WORLD, ...overrides });
}

function membersOf(sent: SentRequest[]): string[] {
  return sent.map(s => s.packet.member ?? '');
}

beforeEach(() => {
  jest.useFakeTimers();
  mockFetch.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
});

// ===========================================================================
// composeMail — NewMail → [AddHeaders] → AddLine ×n → Post → [DeleteMessage
// old draft, on success] → CloseMessage
// ===========================================================================

describe('composeMail', () => {
  /** Answers NewMail with MSG_ID and Post with `postResult`, '' otherwise. */
  function answerCompose(fake: FakeSessionCtx, postResult = '#-1'): void {
    fake.respond(p => {
      if (p.member === 'NewMail') return `NewMail="#${MSG_ID}"`;
      if (p.member === 'Post') return `Post="${postResult}"`;
      return '';
    });
  }

  it('runs NewMail → AddLine ×n → Post → CloseMessage, threading the id NewMail returned', async () => {
    const fake = makeMailCtx();
    answerCompose(fake);

    const ok = await composeMail(fake.ctx, 'Alice', 'Hello', ['line one', 'line two']);

    expect(ok).toBe(true);
    expect(fake.ctx.ensureMailConnection).toHaveBeenCalled();
    expect(membersOf(fake.sent)).toEqual(['NewMail', 'AddLine', 'AddLine', 'Post', 'CloseMessage']);
    for (const req of fake.sent) {
      expect(req.socketName).toBe('mail');
    }

    // NewMail: mail server target, (account, to, subject) as OLEStrings, no explicit separator (→ "^" from the QueryId)
    expect(fake.sent[0].packet).toEqual({
      verb: RdoVerb.SEL,
      targetId: MAIL_SERVER,
      action: RdoAction.CALL,
      member: 'NewMail',
      separator: '"^"',
      args: [RdoValue.string(ACCOUNT).format(), RdoValue.string('Alice').format(), RdoValue.string('Hello').format()],
    });
    expect(fake.sent[0].category).toBe(TimeoutCategory.NORMAL);

    // AddLine: VOID member → "*" WITH QueryId, target = the returned message id
    expect(fake.sent[1].packet).toEqual({
      verb: RdoVerb.SEL,
      targetId: MSG_ID,
      action: RdoAction.CALL,
      member: 'AddLine',
      separator: '"*"',
      args: [RdoValue.string('line one').format()],
    });
    expect(fake.sent[2].packet.args).toEqual([RdoValue.string('line two').format()]);
    expect(fake.sent[2].packet.targetId).toBe(MSG_ID);

    // Post: (worldName, msgId as int) on the mail server, SLOW
    expect(fake.sent[3].packet).toEqual({
      verb: RdoVerb.SEL,
      targetId: MAIL_SERVER,
      action: RdoAction.CALL,
      member: 'Post',
      separator: '"^"',
      args: [RdoValue.string('Shamba').format(), RdoValue.int(parseInt(MSG_ID, 10)).format()],
    });
    expect(fake.sent[3].category).toBe(TimeoutCategory.SLOW);

    // CloseMessage: VOID member → "*" WITH QueryId, on the mail server, id as int
    expect(fake.sent[4].packet).toEqual({
      verb: RdoVerb.SEL,
      targetId: MAIL_SERVER,
      action: RdoAction.CALL,
      member: 'CloseMessage',
      separator: '"*"',
      args: [RdoValue.int(parseInt(MSG_ID, 10)).format()],
    });

    // nothing on the fire-and-forget channel without headers
    expect(fake.frames.mail).toHaveLength(0);
  });

  it('never carries "^" on AddLine or CloseMessage', async () => {
    const fake = makeMailCtx();
    answerCompose(fake);
    await composeMail(fake.ctx, 'A', 'S', ['x']);
    for (const req of fake.sent.filter(r => r.packet.member === 'AddLine' || r.packet.member === 'CloseMessage')) {
      expect(req.packet.separator).toBe('"*"');
    }
  });

  it('with headers, writes AddHeaders fire-and-forget on the message id, then waits 50 ms before AddLine', async () => {
    const fake = makeMailCtx();
    answerCompose(fake);

    const pending = composeMail(fake.ctx, 'A', 'S', ['body'], 'In-Reply-To=42');
    // AddHeaders is written synchronously after NewMail resolves; then the 50 ms park
    await jest.advanceTimersByTimeAsync(0);
    expect(fake.frames.mail).toEqual([
      RdoCommand.sel(MSG_ID).call('AddHeaders').push().args(RdoValue.string('In-Reply-To=42')).build(),
    ]);
    expect(membersOf(fake.sent)).toEqual(['NewMail']);

    await jest.advanceTimersByTimeAsync(50);
    expect(await pending).toBe(true);
    expect(membersOf(fake.sent)).toEqual(['NewMail', 'AddLine', 'Post', 'CloseMessage']);
    expect(fake.frames.mail[0]).toMatchRdoCallFormat('AddHeaders');
  });

  it('with headers but no mail socket, throws "Mail socket unavailable" after NewMail', async () => {
    const fake = makeSessionCtx({ mailAccount: ACCOUNT, currentWorldInfo: WORLD });
    answerCompose(fake);
    await expect(composeMail(fake.ctx, 'A', 'S', ['body'], 'H=1')).rejects.toThrow('Mail socket unavailable');
    expect(membersOf(fake.sent)).toEqual(['NewMail']);
  });

  it('sends no AddLine for an empty body', async () => {
    const fake = makeMailCtx();
    answerCompose(fake);
    await composeMail(fake.ctx, 'A', 'S', []);
    expect(membersOf(fake.sent)).toEqual(['NewMail', 'Post', 'CloseMessage']);
  });

  it('formats an accented body line as an OLEString, unchanged', async () => {
    const fake = makeMailCtx();
    answerCompose(fake);
    await composeMail(fake.ctx, 'A', 'S', ['déjà vu, señor']);
    expect(fake.sent[1].packet.args).toEqual([RdoValue.string('déjà vu, señor').format()]);
  });

  it('uses an empty world name when currentWorldInfo is null', async () => {
    const fake = makeMailCtx({ currentWorldInfo: null });
    answerCompose(fake);
    await composeMail(fake.ctx, 'A', 'S', []);
    expect(fake.sent[1].packet.args?.[0]).toBe(RdoValue.string('').format());
  });

  it('returns false and still closes the message when Post answers #0', async () => {
    const fake = makeMailCtx();
    answerCompose(fake, '#0');
    expect(await composeMail(fake.ctx, 'A', 'S', ['x'])).toBe(false);
    expect(membersOf(fake.sent)).toContain('CloseMessage');
  });

  it('returns false when Post answers an empty payload', async () => {
    const fake = makeMailCtx();
    fake.respond(p => (p.member === 'NewMail' ? `NewMail="#${MSG_ID}"` : ''));
    expect(await composeMail(fake.ctx, 'A', 'S', ['x'])).toBe(false);
  });

  it('a failing CloseMessage is only warned about; the Post result stands', async () => {
    const fake = makeMailCtx();
    fake.respond(p => {
      if (p.member === 'NewMail') return `NewMail="#${MSG_ID}"`;
      if (p.member === 'Post') return 'Post="#-1"';
      if (p.member === 'CloseMessage') return new Error('Request timeout: CloseMessage');
      return '';
    });
    expect(await composeMail(fake.ctx, 'A', 'S', ['x'])).toBe(true);
    expect(fake.log.warn).toHaveBeenCalledWith('[Mail] Failed to close message after post:', expect.any(Error));
  });

  it.each([
    ['empty payload', ''],
    ['id 0', 'NewMail="#0"'],
  ])('stops after NewMail when the server returns %s — nothing else is sent', async (_label, answer) => {
    const fake = makeMailCtx();
    fake.respond(() => answer);
    expect(await composeMail(fake.ctx, 'A', 'S', ['x'])).toBe(false);
    expect(membersOf(fake.sent)).toEqual(['NewMail']);
    expect(fake.frames.mail).toHaveLength(0);
    expect(fake.log.error).toHaveBeenCalledWith('[Mail] Failed to create message');
  });

  it('propagates a timeout on AddLine and does not Post', async () => {
    const fake = makeMailCtx();
    fake.respond(p => {
      if (p.member === 'NewMail') return `NewMail="#${MSG_ID}"`;
      if (p.member === 'AddLine') return new Error('Request timeout: AddLine');
      return '';
    });
    await expect(composeMail(fake.ctx, 'A', 'S', ['x'])).rejects.toThrow('Request timeout: AddLine');
    expect(membersOf(fake.sent)).toEqual(['NewMail', 'AddLine']);
  });

  it.each([
    ['no mailServerId', { mailServerId: null }],
    ['no mailAccount', { mailAccount: null }],
  ])('throws "Mail service not connected" with %s and sends nothing', async (_label, override) => {
    const fake = makeMailCtx(override);
    await expect(composeMail(fake.ctx, 'A', 'S', ['x'])).rejects.toThrow('Mail service not connected');
    expect(fake.sent).toHaveLength(0);
  });

  it('sent from an opened draft, fires DeleteMessage on the Draft folder after Post succeeds', async () => {
    const fake = makeMailCtx();
    answerCompose(fake);

    const ok = await composeMail(fake.ctx, 'A', 'S', ['x'], undefined, 'OLD_DRAFT_7');

    expect(ok).toBe(true);
    expect(fake.frames.mail).toEqual([
      RdoCommand.sel(MAIL_SERVER).call('DeleteMessage').push()
        .args(RdoValue.string('Shamba'), RdoValue.string(ACCOUNT), RdoValue.string('Draft'), RdoValue.string('OLD_DRAFT_7'))
        .build(),
    ]);
    expect(membersOf(fake.sent)).toEqual(['NewMail', 'AddLine', 'Post', 'CloseMessage']);
  });

  it('the delete goes out after Post answered and before CloseMessage', async () => {
    const fake = makeMailCtx();
    let frameCountAtPost = -1;
    let frameCountAtClose = -1;
    fake.respond(p => {
      if (p.member === 'NewMail') return `NewMail="#${MSG_ID}"`;
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

    await composeMail(fake.ctx, 'A', 'S', ['x'], undefined, 'OLD_DRAFT_7');

    expect(frameCountAtPost).toBe(0);
    expect(frameCountAtClose).toBe(1);
  });

  it('a failed Post keeps the draft: no DeleteMessage', async () => {
    const fake = makeMailCtx();
    answerCompose(fake, '#0');

    expect(await composeMail(fake.ctx, 'A', 'S', ['x'], undefined, 'OLD_DRAFT_7')).toBe(false);
    expect(fake.frames.mail).toHaveLength(0);
  });

  it('a Post that answers an empty payload keeps the draft too', async () => {
    const fake = makeMailCtx();
    fake.respond(p => (p.member === 'NewMail' ? `NewMail="#${MSG_ID}"` : ''));

    expect(await composeMail(fake.ctx, 'A', 'S', ['x'], undefined, 'OLD_DRAFT_7')).toBe(false);
    expect(fake.frames.mail).toHaveLength(0);
  });
});

// ===========================================================================
// saveDraft — [DeleteMessage] → NewMail → [AddHeaders] → AddLine ×n → Save → CloseMessage
// ===========================================================================

describe('saveDraft', () => {
  function answerSave(fake: FakeSessionCtx, saveResult = '#-1'): void {
    fake.respond(p => {
      if (p.member === 'NewMail') return `NewMail="#${MSG_ID}"`;
      if (p.member === 'Save') return `Save="${saveResult}"`;
      return '';
    });
  }

  it('runs NewMail → AddLine ×n → Save → CloseMessage with the returned id, Save on the mail server', async () => {
    const fake = makeMailCtx();
    answerSave(fake);

    const ok = await saveDraft(fake.ctx, 'Bob', 'Draft subj', ['l1']);

    expect(ok).toBe(true);
    expect(membersOf(fake.sent)).toEqual(['NewMail', 'AddLine', 'Save', 'CloseMessage']);
    expect(fake.sent[0].packet.args).toEqual([RdoValue.string(ACCOUNT).format(), RdoValue.string('Bob').format(), RdoValue.string('Draft subj').format()]);
    expect(fake.sent[1].packet).toEqual({
      verb: RdoVerb.SEL, targetId: MSG_ID, action: RdoAction.CALL, member: 'AddLine', separator: '"*"',
      args: [RdoValue.string('l1').format()],
    });
    expect(fake.sent[2].packet).toEqual({
      verb: RdoVerb.SEL, targetId: MAIL_SERVER, action: RdoAction.CALL, member: 'Save', separator: '"^"',
      args: [RdoValue.string('Shamba').format(), RdoValue.int(parseInt(MSG_ID, 10)).format()],
    });
    expect(fake.sent[2].category).toBe(TimeoutCategory.SLOW);
    expect(fake.sent[3].packet).toEqual({
      verb: RdoVerb.SEL, targetId: MAIL_SERVER, action: RdoAction.CALL, member: 'CloseMessage', separator: '"*"',
      args: [RdoValue.int(parseInt(MSG_ID, 10)).format()],
    });
    expect(fake.frames.mail).toHaveLength(0);
  });

  it('when editing an existing draft, first fires DeleteMessage on the Draft folder', async () => {
    const fake = makeMailCtx();
    answerSave(fake);

    await saveDraft(fake.ctx, 'Bob', 'S', [], undefined, 'OLD_DRAFT_7');

    expect(fake.frames.mail).toEqual([
      RdoCommand.sel(MAIL_SERVER).call('DeleteMessage').push()
        .args(RdoValue.string('Shamba'), RdoValue.string(ACCOUNT), RdoValue.string('Draft'), RdoValue.string('OLD_DRAFT_7'))
        .build(),
    ]);
    expect(membersOf(fake.sent)).toEqual(['NewMail', 'Save', 'CloseMessage']);
  });

  it('with headers, writes AddHeaders on the message id then parks 50 ms', async () => {
    const fake = makeMailCtx();
    answerSave(fake);

    const pending = saveDraft(fake.ctx, 'B', 'S', ['x'], 'Ref=1');
    await jest.advanceTimersByTimeAsync(0);
    expect(fake.frames.mail).toEqual([
      RdoCommand.sel(MSG_ID).call('AddHeaders').push().args(RdoValue.string('Ref=1')).build(),
    ]);
    expect(membersOf(fake.sent)).toEqual(['NewMail']);
    await jest.advanceTimersByTimeAsync(50);
    expect(await pending).toBe(true);
    expect(membersOf(fake.sent)).toEqual(['NewMail', 'AddLine', 'Save', 'CloseMessage']);
  });

  it('uses an empty world name when currentWorldInfo is null', async () => {
    const fake = makeMailCtx({ currentWorldInfo: null });
    answerSave(fake);
    await saveDraft(fake.ctx, 'B', 'S', []);
    expect(fake.sent[1].packet.args?.[0]).toBe(RdoValue.string('').format());
  });

  it('returns false when Save answers #0', async () => {
    const fake = makeMailCtx();
    answerSave(fake, '#0');
    expect(await saveDraft(fake.ctx, 'B', 'S', ['x'])).toBe(false);
  });

  it('a failing CloseMessage is only warned about', async () => {
    const fake = makeMailCtx();
    fake.respond(p => {
      if (p.member === 'NewMail') return `NewMail="#${MSG_ID}"`;
      if (p.member === 'Save') return 'Save="#-1"';
      if (p.member === 'CloseMessage') return new Error('Request timeout: CloseMessage');
      return '';
    });
    expect(await saveDraft(fake.ctx, 'B', 'S', ['x'])).toBe(true);
    expect(fake.log.warn).toHaveBeenCalledWith('[Mail] Failed to close message after save:', expect.any(Error));
  });

  it.each([
    ['empty payload', ''],
    ['id 0', 'NewMail="#0"'],
  ])('stops after NewMail on %s', async (_label, answer) => {
    const fake = makeMailCtx();
    fake.respond(() => answer);
    expect(await saveDraft(fake.ctx, 'B', 'S', ['x'])).toBe(false);
    expect(membersOf(fake.sent)).toEqual(['NewMail']);
    expect(fake.log.error).toHaveBeenCalledWith('[Mail] Failed to create draft message');
  });

  it.each([
    ['no mailServerId', { mailServerId: null }],
    ['no mailAccount', { mailAccount: null }],
  ])('throws "Mail service not connected" with %s', async (_label, override) => {
    const fake = makeMailCtx(override);
    await expect(saveDraft(fake.ctx, 'B', 'S', ['x'])).rejects.toThrow('Mail service not connected');
    expect(fake.sent).toHaveLength(0);
  });
});

// ===========================================================================
// readMailMessage — OpenMessage → GetHeaders → GetLines → GetAttachmentCount → GetAttachment ×n → CloseMessage
// ===========================================================================

describe('readMailMessage', () => {
  beforeEach(() => {
    mockFetch.mockResolvedValue(htmlResponse('<html></html>'));
  });

  const HEADERS_TEXT = [
    'MessageId=MSG-77', 'FromAddr=alice@shamba.net', 'ToAddr=bob@shamba.net', 'From=Alice', 'To=Bob',
    'Subject=Re: hello=world', 'Date=2244.5', 'DateFmt=3/9/2244', 'Read=1', 'Stamp=42', 'NoReply=0',
    'garbage line without equals', '=leading equals',
  ].join('\n');

  function answerRead(fake: FakeSessionCtx, opts: { attachCount?: string; body?: string; attach?: (i: number) => string } = {}): void {
    fake.respond(p => {
      switch (p.member) {
        case 'OpenMessage': return `OpenMessage="#${MSG_ID}"`;
        case 'GetHeaders': return `res="%${HEADERS_TEXT}"`;
        case 'GetLines': return `res="%${opts.body ?? 'first\n\nsecond'}"`;
        case 'GetAttachmentCount': return `GetAttachmentCount="#${opts.attachCount ?? '0'}"`;
        case 'GetAttachment': return opts.attach ? opts.attach(RdoValue.int(0).format() === (p.args?.[0] ?? '') ? 0 : 1) : '';
        default: return '';
      }
    });
  }

  it('opens on the mail server with (world, account, folder, id) and threads the returned id through the reads and the close', async () => {
    const fake = makeMailCtx();
    answerRead(fake);

    const msg = await readMailMessage(fake.ctx, 'Inbox', 'MSG-77');

    expect(membersOf(fake.sent)).toEqual(['OpenMessage', 'GetHeaders', 'GetLines', 'GetAttachmentCount', 'CloseMessage']);
    expect(fake.sent[0].packet).toEqual({
      verb: RdoVerb.SEL, targetId: MAIL_SERVER, action: RdoAction.CALL, member: 'OpenMessage', separator: '"^"',
      args: [RdoValue.string('Shamba').format(), RdoValue.string(ACCOUNT).format(), RdoValue.string('Inbox').format(), RdoValue.string('MSG-77').format()],
    });
    for (const i of [1, 2, 3]) {
      expect(fake.sent[i].packet.targetId).toBe(MSG_ID);
      expect(fake.sent[i].packet.args).toEqual([RdoValue.int(0).format()]);
      expect(fake.sent[i].category).toBe(TimeoutCategory.NORMAL);
    }
    expect(fake.sent[4].packet).toEqual({
      verb: RdoVerb.SEL, targetId: MAIL_SERVER, action: RdoAction.CALL, member: 'CloseMessage', separator: '"*"',
      args: [RdoValue.int(parseInt(MSG_ID, 10)).format()],
    });

    // headers parsed, messageId is the CLIENT's id, body split on \n dropping empties
    expect(msg).toEqual({
      messageId: 'MSG-77',
      fromAddr: 'alice@shamba.net',
      toAddr: 'bob@shamba.net',
      from: 'Alice',
      to: 'Bob',
      subject: 'Re: hello=world',
      date: '2244.5',
      dateFmt: '3/9/2244',
      read: true,
      stamp: 42,
      noReply: false,
      body: ['first', 'second'],
      attachments: [],
    });
  });

  it('fills defaults for absent headers (empty strings, read=false, stamp 0)', async () => {
    const fake = makeMailCtx();
    fake.respond(p => {
      if (p.member === 'OpenMessage') return `OpenMessage="#${MSG_ID}"`;
      if (p.member === 'GetAttachmentCount') return 'GetAttachmentCount="#0"';
      return '';
    });

    const msg = await readMailMessage(fake.ctx, 'Inbox', 'X');

    expect(msg).toEqual({
      messageId: 'X', fromAddr: '', toAddr: '', from: '', to: '', subject: '', date: '', dateFmt: '',
      read: false, stamp: 0, noReply: false, body: [], attachments: [],
    });
  });

  it('reads NoReply=1 as noReply and a non-numeric Stamp as NaN', async () => {
    const fake = makeMailCtx();
    fake.respond(p => {
      if (p.member === 'OpenMessage') return `OpenMessage="#${MSG_ID}"`;
      if (p.member === 'GetHeaders') return 'res="%NoReply=1\nStamp=abc"';
      if (p.member === 'GetAttachmentCount') return 'GetAttachmentCount="#0"';
      return '';
    });
    const msg = await readMailMessage(fake.ctx, 'Inbox', 'X');
    expect(msg.noReply).toBe(true);
    expect(Number.isNaN(msg.stamp)).toBe(true);
  });

  it('fetches each attachment by index and parses Class/Executed out of its properties', async () => {
    const fake = makeMailCtx();
    answerRead(fake, {
      attachCount: '2',
      attach: i => (i === 0
        ? 'Class=TLinkAttachment\nExecuted=Yes\nUrl=http://x\nno-equals'
        : 'Class=TMoneyAttachment\nExecuted=No\nAmount=1000'),
    });

    const msg = await readMailMessage(fake.ctx, 'Inbox', 'X');

    expect(membersOf(fake.sent)).toEqual(['OpenMessage', 'GetHeaders', 'GetLines', 'GetAttachmentCount', 'GetAttachment', 'GetAttachment', 'CloseMessage']);
    expect(fake.sent[4].packet).toEqual({ verb: RdoVerb.SEL, targetId: MSG_ID, action: RdoAction.CALL, member: 'GetAttachment', separator: '"^"', args: [RdoValue.int(0).format()] });
    expect(fake.sent[5].packet.args).toEqual([RdoValue.int(1).format()]);
    expect(msg.attachments).toEqual([
      { class: 'TLinkAttachment', executed: true, properties: { Url: 'http://x' } },
      { class: 'TMoneyAttachment', executed: false, properties: { Amount: '1000' } },
    ]);
  });

  it('an attachment answered with no payload yields an empty attachment', async () => {
    const fake = makeMailCtx();
    fake.respond((p, i) => {
      if (p.member === 'OpenMessage') return `OpenMessage="#${MSG_ID}"`;
      if (p.member === 'GetAttachmentCount') return 'GetAttachmentCount="#1"';
      if (p.member === 'GetAttachment') return { raw: '', type: 'RESPONSE', rid: i } as RdoPacket;
      return '';
    });
    const msg = await readMailMessage(fake.ctx, 'Inbox', 'X');
    expect(msg.attachments).toEqual([{ class: '', executed: false, properties: {} }]);
  });

  it('a non-numeric attachment count means no attachment reads', async () => {
    const fake = makeMailCtx();
    answerRead(fake, { attachCount: 'x' });
    const msg = await readMailMessage(fake.ctx, 'Inbox', 'X');
    expect(msg.attachments).toEqual([]);
    expect(membersOf(fake.sent)).not.toContain('GetAttachment');
  });

  it('a GetHeaders / GetLines packet without payload is read as empty', async () => {
    const fake = makeMailCtx();
    fake.respond((p, i) => {
      if (p.member === 'OpenMessage') return `OpenMessage="#${MSG_ID}"`;
      if (p.member === 'GetAttachmentCount') return 'GetAttachmentCount="#0"';
      if (p.member === 'GetHeaders' || p.member === 'GetLines') return { raw: '', type: 'RESPONSE', rid: i } as RdoPacket;
      return '';
    });
    const msg = await readMailMessage(fake.ctx, 'Inbox', 'X');
    expect(msg.body).toEqual([]);
    expect(msg.subject).toBe('');
  });

  it('closes the message even when a read throws, and rethrows', async () => {
    const fake = makeMailCtx();
    fake.respond(p => {
      if (p.member === 'OpenMessage') return `OpenMessage="#${MSG_ID}"`;
      if (p.member === 'GetLines') return new Error('Request timeout: GetLines');
      return '';
    });
    await expect(readMailMessage(fake.ctx, 'Inbox', 'X')).rejects.toThrow('Request timeout: GetLines');
    expect(membersOf(fake.sent)).toEqual(['OpenMessage', 'GetHeaders', 'GetLines', 'CloseMessage']);
    expect(fake.sent[3].packet.args).toEqual([RdoValue.int(parseInt(MSG_ID, 10)).format()]);
  });

  it('a failing CloseMessage is only warned about; the message is still returned', async () => {
    const fake = makeMailCtx();
    fake.respond(p => {
      if (p.member === 'OpenMessage') return `OpenMessage="#${MSG_ID}"`;
      if (p.member === 'GetAttachmentCount') return 'GetAttachmentCount="#0"';
      if (p.member === 'CloseMessage') return new Error('Request timeout: CloseMessage');
      return '';
    });
    const msg = await readMailMessage(fake.ctx, 'Inbox', 'X');
    expect(msg.messageId).toBe('X');
    expect(fake.log.warn).toHaveBeenCalledWith('[Mail] Failed to close message:', expect.any(Error));
  });

  it('uses an empty world name when currentWorldInfo is null', async () => {
    const fake = makeMailCtx({ currentWorldInfo: null });
    answerRead(fake);
    await readMailMessage(fake.ctx, 'Inbox', 'X');
    expect(fake.sent[0].packet.args?.[0]).toBe(RdoValue.string('').format());
  });

  it('when OpenMessage answers an empty payload, the reads still go out with an EMPTY target and CloseMessage is never sent', async () => {
    // Pinned as CURRENT behaviour: the handler does not guard msgId after
    // OpenMessage (mail-handler.ts:301-304). The three reads are issued with
    // targetId '' — production would build `sel  call GetHeaders` — and the
    // CloseMessage in `finally` dies on `RdoValue.int(NaN)` (assertWireInteger),
    // swallowed by its own try/catch as a warning. Nothing is released
    // server-side. A live-campaign entry, not a Jest fix.
    const fake = makeMailCtx();
    fake.respond(() => '');
    await readMailMessage(fake.ctx, 'Inbox', 'X');
    expect(membersOf(fake.sent)).toEqual(['OpenMessage', 'GetHeaders', 'GetLines', 'GetAttachmentCount']);
    expect(fake.sent[1].packet.targetId).toBe('');
    expect(fake.log.warn).toHaveBeenCalledWith('[Mail] Failed to close message:', expect.any(Error));
  });

  it.each([
    ['no mailServerId', { mailServerId: null }],
    ['no mailAccount', { mailAccount: null }],
  ])('throws "Mail service not connected" with %s', async (_label, override) => {
    const fake = makeMailCtx(override);
    await expect(readMailMessage(fake.ctx, 'Inbox', 'X')).rejects.toThrow('Mail service not connected');
    expect(fake.sent).toHaveLength(0);
  });

  // ── MessageBody.asp header touch — Inbox only ────────────────────────────

  it('after an Inbox read, GETs MessageBody.asp once, after the RDO sequence completes', async () => {
    const fake = makeMailCtx();
    answerRead(fake);
    let sentCountAtFetch = -1;
    mockFetch.mockImplementation(async () => {
      sentCountAtFetch = fake.sent.length;
      return htmlResponse('<html></html>');
    });

    await readMailMessage(fake.ctx, 'Inbox', 'MSG-77');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('http://158.69.153.134/five/0/visual/voyager/mail/MessageBody.asp?WorldName=Shamba&Account=SPO_test3%40shamba.net&Folder=Inbox&MsgId=MSG-77');
    expect(init).toEqual(expect.objectContaining({ redirect: 'follow' }));
    expect((init as { signal?: unknown }).signal).toBeInstanceOf(AbortSignal);
    expect(membersOf(fake.sent)).toEqual(['OpenMessage', 'GetHeaders', 'GetLines', 'GetAttachmentCount', 'CloseMessage']);
    // all five RDO requests were already sent by the time the fetch fired
    expect(sentCountAtFetch).toBe(5);
  });

  it.each(['Draft', 'Sent'])('does not touch MessageBody.asp for a %s read', async folder => {
    const fake = makeMailCtx();
    answerRead(fake);

    const msg = await readMailMessage(fake.ctx, folder, 'MSG-77');

    expect(mockFetch).not.toHaveBeenCalled();
    expect(msg.messageId).toBe('MSG-77');
  });

  it('a non-OK status from MessageBody.asp warns but still returns the message', async () => {
    const fake = makeMailCtx();
    answerRead(fake);
    mockFetch.mockResolvedValue(htmlResponse('', 500));

    const msg = await readMailMessage(fake.ctx, 'Inbox', 'MSG-77');

    expect(msg.messageId).toBe('MSG-77');
    expect(fake.log.warn).toHaveBeenCalledWith('[Mail] MessageBody.asp returned 500 — unread flag not cleared');
  });

  it('a rejected MessageBody.asp fetch warns but still returns the message', async () => {
    const fake = makeMailCtx();
    answerRead(fake);
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    const msg = await readMailMessage(fake.ctx, 'Inbox', 'MSG-77');

    expect(msg.messageId).toBe('MSG-77');
    expect(fake.log.warn).toHaveBeenCalledWith('[Mail] Header touch failed — unread flag not cleared:', 'ECONNREFUSED');
  });

  it('a GetLines timeout rejects before the header touch, and MessageBody.asp is never fetched', async () => {
    const fake = makeMailCtx();
    fake.respond(p => {
      if (p.member === 'OpenMessage') return `OpenMessage="#${MSG_ID}"`;
      if (p.member === 'GetLines') return new Error('Request timeout: GetLines');
      return '';
    });

    await expect(readMailMessage(fake.ctx, 'Inbox', 'X')).rejects.toThrow('Request timeout: GetLines');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('with no currentWorldInfo, an Inbox read fetches nothing and still returns the message', async () => {
    const fake = makeMailCtx({ currentWorldInfo: null });
    answerRead(fake);

    const msg = await readMailMessage(fake.ctx, 'Inbox', 'MSG-77');

    expect(mockFetch).not.toHaveBeenCalled();
    expect(msg.messageId).toBe('MSG-77');
  });
});

// ===========================================================================
// deleteMailMessage — fire-and-forget DeleteMessage
// ===========================================================================

describe('deleteMailMessage', () => {
  it('writes DeleteMessage "*" without QueryId on the mail server with (world, account, folder, id)', async () => {
    const fake = makeMailCtx();

    await deleteMailMessage(fake.ctx, 'Inbox', 'MSG-9');

    expect(fake.sent).toHaveLength(0);
    expect(fake.frames.mail).toEqual([
      RdoCommand.sel(MAIL_SERVER).call('DeleteMessage').push()
        .args(RdoValue.string('Shamba'), RdoValue.string(ACCOUNT), RdoValue.string('Inbox'), RdoValue.string('MSG-9'))
        .build(),
    ]);
    expect(fake.frames.mail[0]).toMatchRdoCallFormat('DeleteMessage');
    expect(fake.frames.mail[0]).toMatchRdoFormat();
  });

  it('with an empty message id, still writes the frame with an empty id (no guard — current behaviour)', async () => {
    const fake = makeMailCtx();
    await deleteMailMessage(fake.ctx, 'Inbox', '');
    expect(fake.frames.mail).toEqual([
      RdoCommand.sel(MAIL_SERVER).call('DeleteMessage').push()
        .args(RdoValue.string('Shamba'), RdoValue.string(ACCOUNT), RdoValue.string('Inbox'), RdoValue.string(''))
        .build(),
    ]);
  });

  it('uses an empty world name when currentWorldInfo is null', async () => {
    const fake = makeMailCtx({ currentWorldInfo: null });
    await deleteMailMessage(fake.ctx, 'Sent', 'M');
    expect(fake.frames.mail[0]).toBe(
      RdoCommand.sel(MAIL_SERVER).call('DeleteMessage').push()
        .args(RdoValue.string(''), RdoValue.string(ACCOUNT), RdoValue.string('Sent'), RdoValue.string('M'))
        .build(),
    );
  });

  it('throws when the mail socket is absent, and writes nothing', async () => {
    const fake = makeSessionCtx({ mailAccount: ACCOUNT, currentWorldInfo: WORLD });
    await expect(deleteMailMessage(fake.ctx, 'Inbox', 'M')).rejects.toThrow('Mail socket unavailable');
  });

  it.each([
    ['no mailServerId', { mailServerId: null }],
    ['no mailAccount', { mailAccount: null }],
  ])('throws "Mail service not connected" with %s', async (_label, override) => {
    const fake = makeMailCtx(override);
    await expect(deleteMailMessage(fake.ctx, 'Inbox', 'M')).rejects.toThrow('Mail service not connected');
    expect(fake.frames.mail).toHaveLength(0);
  });
});

// ===========================================================================
// getMailUnreadCount — CheckNewMail(LogServerOn id, account)
// ===========================================================================

describe('getMailUnreadCount', () => {
  it('calls CheckNewMail on the mail server with the LogServerOn id as int and the account, and returns the count', async () => {
    const fake = makeMailCtx();
    fake.respond(() => 'res="#3"');

    expect(await getMailUnreadCount(fake.ctx)).toBe(3);

    expect(fake.sent[0].socketName).toBe('mail');
    expect(fake.sent[0].category).toBe(TimeoutCategory.NORMAL);
    expect(fake.sent[0].packet).toEqual({
      verb: RdoVerb.SEL, targetId: MAIL_SERVER, action: RdoAction.CALL, member: 'CheckNewMail', separator: '"^"',
      args: [RdoValue.int(parseInt(MAIL_INT_SERVER, 10)).format(), RdoValue.string(ACCOUNT).format()],
    });
    // never the mail server id in the first slot (MailServer.pas:543 dereferences it as a pointer)
    expect(fake.sent[0].packet.args?.[0]).not.toBe(RdoValue.int(parseInt(MAIL_SERVER, 10)).format());
  });

  it.each([
    ['-1 (server-side failure)', 'res="#-1"', 0],
    ['0', 'res="#0"', 0],
    ['empty payload', '', 0],
    ['non-numeric', 'res="%abc"', 0],
  ])('surfaces %s as 0', async (_label, answer, expected) => {
    const fake = makeMailCtx();
    fake.respond(() => answer);
    expect(await getMailUnreadCount(fake.ctx)).toBe(expected);
  });

  it('skips the call and returns 0 without a LogServerOn session id', async () => {
    const fake = makeMailCtx({ mailIntServerId: null });
    expect(await getMailUnreadCount(fake.ctx)).toBe(0);
    expect(fake.sent).toHaveLength(0);
    expect(fake.log.debug).toHaveBeenCalledWith('[Mail] No LogServerOn session id — skipping CheckNewMail');
  });

  it('propagates a timeout', async () => {
    const fake = makeMailCtx();
    fake.respond(() => new Error('Request timeout: CheckNewMail'));
    await expect(getMailUnreadCount(fake.ctx)).rejects.toThrow('Request timeout: CheckNewMail');
  });

  it.each([
    ['no mailServerId', { mailServerId: null }],
    ['no mailAccount', { mailAccount: null }],
  ])('throws "Mail service not connected" with %s', async (_label, override) => {
    const fake = makeMailCtx(override);
    await expect(getMailUnreadCount(fake.ctx)).rejects.toThrow('Mail service not connected');
    expect(fake.sent).toHaveLength(0);
  });
});

// ===========================================================================
// getMailFolder — MessageList.asp over HTTP
// ===========================================================================

describe('getMailFolder', () => {
  const ROW = (id: string, name: string, subject: string) =>
    `<tr msgId="${id}"><td><span class="mailFolderItem">${name}</span></td>` +
    `<td><span class="mailFolderItem">${subject}</span></td>` +
    `<td><input id="msgDate0" type="hidden" value="3/9/2244"><input id="msgReply0" type="hidden" value=""></td></tr>`;

  it('GETs MessageList.asp on the world ip with Folder/WorldName/Account and %20-encoded spaces, follows redirects', async () => {
    const fake = makeMailCtx({ mailAccount: 'SPO test3@shamba.net' });
    mockFetch.mockResolvedValue(htmlResponse('<table></table>'));

    await getMailFolder(fake.ctx, 'Inbox');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('http://158.69.153.134/five/0/visual/voyager/mail/MessageList.asp?Folder=Inbox&WorldName=Shamba&Account=SPO%20test3%40shamba.net&MsgId=&Action=');
    expect(init).toEqual(expect.objectContaining({ redirect: 'follow' }));
    expect((init as { signal?: unknown }).signal).toBeInstanceOf(AbortSignal);
  });

  it('parses the rows through the real parseMessageListHtml', async () => {
    const fake = makeMailCtx();
    mockFetch.mockResolvedValue(htmlResponse(`<table>${ROW('M1', 'Alice', 'Hi')}${ROW('M2', 'Bob', 'Yo')}</table>`));

    const headers = await getMailFolder(fake.ctx, 'Inbox');

    expect(headers.map(h => h.messageId)).toEqual(['M1', 'M2']);
    expect(headers[0]).toMatchObject({ from: 'Alice', subject: 'Hi', dateFmt: '3/9/2244', noReply: false });
  });

  it('returns [] and warns on a non-OK status (500) without parsing the body', async () => {
    const fake = makeMailCtx();
    mockFetch.mockResolvedValue(htmlResponse(`<table>${ROW('M1', 'Alice', 'Hi')}</table>`, 500));

    expect(await getMailFolder(fake.ctx, 'Inbox')).toEqual([]);
    expect(fake.log.warn).toHaveBeenCalledWith('[Mail] MessageList.asp returned 500');
  });

  it('returns [] and logs when fetch rejects', async () => {
    const fake = makeMailCtx();
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'));

    expect(await getMailFolder(fake.ctx, 'Sent')).toEqual([]);
    expect(fake.log.error).toHaveBeenCalledWith('[Mail] Failed to fetch folder listing:', 'ECONNREFUSED');
  });

  it.each([
    ['no world', { currentWorldInfo: null }],
    ['no mail account', { mailAccount: null }],
  ])('returns [] without fetching when %s', async (_label, override) => {
    const fake = makeMailCtx(override);
    expect(await getMailFolder(fake.ctx, 'Inbox')).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
    expect(fake.log.warn).toHaveBeenCalledWith('[Mail] Cannot fetch folder: not logged into world or no mail account');
  });
});
