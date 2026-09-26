import type { Socket } from 'net';
import { sendChatMessage } from './chat-handler';
import type { SessionContext } from './session-context';
import type { WorldInfo } from '../../shared/types';
import * as mailHandler from './mail-handler';
import { makeSessionCtx } from '../__tests__/session/fake-session-context';

/**
 * What the mail and chat handlers actually put on the wire — §7 of the audit.
 *
 * `mail.validation.test.ts` builds its own packet with `separator: '"*"'` and
 * then asserts that it contains `"*"`. It tests its own input. While the handler
 * emitted `"^"`, that suite stayed green — which is exactly why P-H1 survived
 * long enough for one frame to freeze the shared Interface Server.
 *
 * These tests observe the handlers instead. The mail entry points run for real
 * against a working connection stub (`makeSessionCtx`), and BOTH channels are
 * captured into one ordered log: the synchronous `sendRdoRequest` channel and
 * the fire-and-forget `writeRdoFrame` channel (decoded latin1 off the mail
 * socket). Each entry point's full member+separator sequence is pinned, so a
 * separator that regresses — or a frame that disappears — fails the test.
 */

/**
 * The three members the audit identified as Delphi `procedure`s. Emitting `"^"`
 * on any of them makes the server push a result pointer the procedure never
 * pops (RDOQueryServer.pas:422-424 -> RDOObjectServer.pas:292).
 */
const VOID_MEMBERS = ['SayThis', 'AddLine', 'CloseMessage'];

describe('chat-handler emission', () => {
  it('sends SayThis with the void separator, never the variant one', async () => {
    const fake = makeSessionCtx();
    fake.respond(() => 'res="#0"');

    await sendChatMessage(fake.ctx, 'hello world');

    const sayThis = fake.sent.find(s => s.packet.member === 'SayThis');
    expect(sayThis).toBeDefined();
    expect(sayThis!.packet.separator).toBe('"*"');
    expect(sayThis!.packet.separator).not.toBe('"^"');
  });

  it('does not emit at all for an empty message', async () => {
    const fake = makeSessionCtx();
    fake.respond(() => 'res="#0"');

    await sendChatMessage(fake.ctx, '   ');

    expect(fake.sent).toEqual([]);
  });
});

const MSG_ID = '30437308';
const ACCOUNT = 'SPO_test3@shamba.net';
const WORLD: WorldInfo = { name: 'Shamba', url: 'http://158.69.153.134', ip: '158.69.153.134', port: 7000 };

const FRAME_RE = /^C (?:\d+ )?sel \S+ call (\w+) ("[*^]")/;

function answerFor(member: string | undefined): string {
  switch (member) {
    case 'NewMail': return `NewMail="#${MSG_ID}"`;
    case 'Post': return 'Post="#-1"';
    case 'Save': return 'Save="#-1"';
    case 'OpenMessage': return `OpenMessage="#${MSG_ID}"`;
    case 'GetHeaders':
    case 'GetLines': return 'res="%plain text"';
    case 'GetAttachmentCount': return 'GetAttachmentCount="#0"';
    case 'CheckNewMail': return 'res="#2"';
    default: return 'res="#0"';
  }
}

/** A mail session whose two channels land, in order, in one `wire` log. */
function makeMailWire(): { ctx: SessionContext; wire: string[] } {
  const wire: string[] = [];
  const mailSocket = {
    write(chunk: Buffer | string): boolean {
      const raw = Buffer.isBuffer(chunk) ? chunk.toString('latin1') : chunk;
      const m = FRAME_RE.exec(raw);
      wire.push(m ? `frame ${m[1]} ${m[2]}` : `frame <unparsed> ${raw}`);
      return true;
    },
  } as unknown as Socket;

  const fake = makeSessionCtx({
    mailAccount: ACCOUNT,
    currentWorldInfo: WORLD,
    getSocket: jest.fn((name: string) => (name === 'mail' ? mailSocket : undefined)),
  });
  fake.respond(p => {
    wire.push(`request ${p.member} ${p.separator}`);
    return answerFor(p.member);
  });
  return { ctx: fake.ctx, wire };
}

type EntryPoint = (ctx: SessionContext) => Promise<unknown>;

const ENTRY_POINTS: Array<[string, EntryPoint, string[]]> = [
  [
    'composeMail',
    ctx => mailHandler.composeMail(ctx, 'Alice', 'Hello', ['line one', 'line two'], 'MessageId=MSG-1', 'DRAFT-7'),
    [
      'request NewMail "^"',
      'frame AddHeaders "*"',
      'request AddLine "*"',
      'request AddLine "*"',
      'request Post "^"',
      'frame DeleteMessage "*"',
      'request CloseMessage "*"',
    ],
  ],
  [
    'saveDraft',
    ctx => mailHandler.saveDraft(ctx, 'Alice', 'Hello', ['line one'], 'MessageId=MSG-1', 'DRAFT-7'),
    [
      'frame DeleteMessage "*"',
      'request NewMail "^"',
      'frame AddHeaders "*"',
      'request AddLine "*"',
      'request Save "^"',
      'request CloseMessage "*"',
    ],
  ],
  [
    'readMailMessage',
    // 'Sent', not 'Inbox': an Inbox read also touches MessageBody.asp over HTTP.
    ctx => mailHandler.readMailMessage(ctx, 'Sent', 'MSG-1'),
    [
      'request OpenMessage "^"',
      'request GetHeaders "^"',
      'request GetLines "^"',
      'request GetAttachmentCount "^"',
      'request CloseMessage "*"',
    ],
  ],
  [
    'deleteMailMessage',
    ctx => mailHandler.deleteMailMessage(ctx, 'Inbox', 'MSG-9'),
    ['frame DeleteMessage "*"'],
  ],
  [
    'getMailUnreadCount',
    ctx => mailHandler.getMailUnreadCount(ctx),
    ['request CheckNewMail "^"'],
  ],
];

describe('mail-handler emission', () => {
  it.each(ENTRY_POINTS)('%s emits its full member+separator sequence on both channels', async (_name, run, expected) => {
    const { ctx, wire } = makeMailWire();

    await run(ctx);

    expect(wire.length).toBeGreaterThan(0);
    expect(wire).toEqual(expected);
  });

  it('covers every exported mail entry point', () => {
    // getMailFolder is HTTP-only (MessageList.asp) and emits no RDO.
    expect(Object.keys(mailHandler).sort()).toEqual(
      [...ENTRY_POINTS.map(([name]) => name), 'getMailFolder'].sort(),
    );
  });
});

describe('no void member anywhere carries the variant separator', () => {
  // A cheap net over the whole session surface: whatever these handlers do in
  // future, this is the invariant that must hold.
  it('holds for the chat path', async () => {
    const fake = makeSessionCtx();
    fake.respond(() => 'res="#0"');
    await sendChatMessage(fake.ctx, 'probe');

    for (const req of fake.sent) {
      if (VOID_MEMBERS.includes(req.packet.member ?? '')) {
        expect(req.packet.separator).toBe('"*"');
      }
    }
  });
});
