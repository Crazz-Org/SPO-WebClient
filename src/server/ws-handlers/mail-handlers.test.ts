import type { WebSocket } from 'ws';
import { handleMailReadMessage } from './mail-handlers';
import type { WsHandlerContext } from './types';
import { WsMessageType, type WsMessage, type WsRespMailMessage } from '../../shared/types';
import { toProxyUrl } from '../../shared/proxy-utils';
import type { MailMessageFull } from '../../shared/types/domain-types';

const baseMessage: MailMessageFull = {
  messageId: 'msg-1',
  from: 'Alice',
  fromAddr: 'alice',
  to: 'Bob',
  toAddr: 'bob',
  subject: 'Hi',
  date: '1',
  dateFmt: 'today',
  read: true,
  stamp: 17,
  noReply: false,
  body: ['hello'],
  attachments: [],
};

function makeCtx(readMailMessage: MailMessageFull, currentWorldInfo: { ip: string } | null) {
  const sent: WsMessage[] = [];
  const ws = {
    send: jest.fn((payload: string) => sent.push(JSON.parse(payload) as WsMessage)),
  } as unknown as WebSocket;

  const ctx = {
    ws,
    session: {
      readMailMessage: jest.fn().mockResolvedValue(readMailMessage),
      currentWorldInfo,
    },
  } as unknown as WsHandlerContext;

  return { ctx, sent };
}

const request: WsMessage = {
  type: WsMessageType.REQ_MAIL_READ_MESSAGE,
  wsRequestId: 'req-1',
  folder: 'Inbox',
  messageId: 'msg-1',
} as unknown as WsMessage;

describe('handleMailReadMessage — stamp picture', () => {
  it('attaches a proxied stamp URL derived from stamp mod 15 when a world is joined', async () => {
    const { ctx, sent } = makeCtx(baseMessage, { ip: '158.69.153.134' });
    await handleMailReadMessage(ctx, request);

    const resp = sent[0] as WsRespMailMessage;
    expect(resp.message.stampUrl).toBe(
      toProxyUrl('/Five/0/Visual/Voyager/Mail/images/stamp2.jpg', '158.69.153.134'),
    );
    expect(resp.message).toMatchObject({ ...baseMessage, stampUrl: resp.message.stampUrl });
  });

  it('falls back to stamp0.jpg for a NaN stamp (missing/unparseable header)', async () => {
    const { ctx, sent } = makeCtx({ ...baseMessage, stamp: NaN }, { ip: '158.69.153.134' });
    await handleMailReadMessage(ctx, request);

    const resp = sent[0] as WsRespMailMessage;
    expect(resp.message.stampUrl).toBe(
      toProxyUrl('/Five/0/Visual/Voyager/Mail/images/stamp0.jpg', '158.69.153.134'),
    );
  });

  it('carries no stampUrl when no world is joined', async () => {
    const { ctx, sent } = makeCtx(baseMessage, null);
    await handleMailReadMessage(ctx, request);

    const resp = sent[0] as WsRespMailMessage;
    expect(resp.message).toEqual(baseMessage);
    expect('stampUrl' in resp.message).toBe(false);
  });
});
