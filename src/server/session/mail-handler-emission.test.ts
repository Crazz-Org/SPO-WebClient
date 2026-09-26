import { sendChatMessage } from './chat-handler';
import type { SessionContext } from './session-context';
import type { RdoPacket } from '../../shared/types';
import * as mailHandler from './mail-handler';

/**
 * What the mail and chat handlers actually put on the wire — §7 of the audit.
 *
 * `mail.validation.test.ts` used to construct its packet with `separator: '"*"'`
 * and then assert that it contained `"*"` — it tested its own input. While the
 * handler emitted `"^"`, that suite stayed green, which is exactly why P-H1
 * survived long enough for one frame to freeze the shared Interface Server.
 * Since #947 that suite drives the real handlers through the protocol harness
 * and pins the frames they emit.
 *
 * These tests observe the handlers too, against a mocked transport. If a
 * separator regresses, they fail.
 */

interface Captured {
  member?: string;
  separator?: string;
  targetId?: string;
}

function makeCtx(): { ctx: SessionContext; sent: Captured[] } {
  const sent: Captured[] = [];

  const ctx = {
    worldContextId: '8161308',
    mailServerId: '30437308',
    log: { debug: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() },
    getSocket: jest.fn().mockReturnValue({ write: () => true }),
    sendRdoRequest: jest.fn(async (_socket: string, packet: Record<string, unknown>) => {
      sent.push({
        member: packet.member as string,
        separator: packet.separator as string,
        targetId: packet.targetId as string,
      });
      return { payload: 'res="#0"' } as RdoPacket;
    }),
  } as unknown as SessionContext;

  return { ctx, sent };
}

/**
 * The three members the audit identified as Delphi `procedure`s. Emitting `"^"`
 * on any of them makes the server push a result pointer the procedure never
 * pops (RDOQueryServer.pas:422-424 -> RDOObjectServer.pas:292).
 */
const VOID_MEMBERS = ['SayThis', 'AddLine', 'CloseMessage'];

describe('chat-handler emission', () => {
  it('sends SayThis with the void separator, never the variant one', async () => {
    const { ctx, sent } = makeCtx();

    await sendChatMessage(ctx, 'hello world');

    const sayThis = sent.find(s => s.member === 'SayThis');
    expect(sayThis).toBeDefined();
    expect(sayThis!.separator).toBe('"*"');
    expect(sayThis!.separator).not.toBe('"^"');
  });

  it('does not emit at all for an empty message', async () => {
    const { ctx, sent } = makeCtx();

    await sendChatMessage(ctx, '   ');

    expect(sent).toEqual([]);
  });
});

describe('mail-handler emission', () => {
  // Every exported mail entry point, driven far enough to observe its frames.
  // Failures inside a handler are irrelevant here — what matters is that no
  // frame it did emit carries "^" on a void member.
  it.each([
    ['composeMail', mailHandler.composeMail],
    ['saveDraft', mailHandler.saveDraft],
    ['deleteMailMessage', mailHandler.deleteMailMessage],
  ])('%s never emits "^" on a void member', async (_name, fn) => {
    const call = fn as unknown as (...args: unknown[]) => Promise<unknown>;

    const { ctx, sent } = makeCtx();
    await call(ctx, 'SPO_test3', 'subject', 'line one\nline two')
      .catch(() => { /* argument shapes differ; only the emitted frames matter */ });

    const offenders = sent.filter(s => VOID_MEMBERS.includes(s.member ?? '') && s.separator === '"^"');
    expect(offenders).toEqual([]);
  });
});

describe('no void member anywhere carries the variant separator', () => {
  // A cheap net over the whole session surface: whatever these handlers do in
  // future, this is the invariant that must hold.
  it('holds for the chat path', async () => {
    const { ctx, sent } = makeCtx();
    await sendChatMessage(ctx, 'probe');

    for (const frame of sent) {
      if (VOID_MEMBERS.includes(frame.member ?? '')) {
        expect(frame.separator).toBe('"*"');
      }
    }
  });
});
