/**
 * context-status-handler — `ContextStatusText` on the `world` socket.
 *
 * The member is a Delphi FUNCTION taking two integers
 * (`Interface Server/InterfaceServer.pas:149`), so the frame is `"^"` with a
 * QueryId and exactly two `#`-prefixed arguments — the tycoon is injected by the
 * Interface Server (`:838`) and must never appear on the wire.
 *
 * What the tests pin: the target (`worldContextId`, not the cacher), the
 * argument count and type, and the three answers that are not a sentence — the
 * empty string for "no town here" (`Kernel/World.pas:4243`), the integer
 * `ERROR_Unknown` the IS substitutes when the world proxy faulted (`:842`), and
 * a missing world context.
 */

import { getContextStatusText } from './context-status-handler';
import { makeSessionCtx, FAKE_CONTEXT_IDS } from '../__tests__/session/fake-session-context';
import { RdoValue } from '../../shared/rdo-types';
import { RDO_MEMBERS } from '../../shared/rdo-members';
import { RdoVerb, RdoAction } from '../../shared/types';
import { TimeoutCategory } from '../../shared/timeout-categories';

const SENTENCE = 'Helartia — population 12 480, ruled by SPO_test3';

describe('getContextStatusText', () => {
  it('the catalogue entry matches the Pascal declaration: a 2-argument function', () => {
    // Interface Server/InterfaceServer.pas:149 —
    //   function ContextStatusText( x, y : integer ) : OleVariant;
    expect(RDO_MEMBERS.ContextStatusText).toEqual({ kind: 'function', arity: 2 });
  });

  it('sends one ContextStatusText call to the world context with the two coordinates', async () => {
    const fake = makeSessionCtx();
    fake.respond(() => `res="%${SENTENCE}"`);

    const text = await getContextStatusText(fake.ctx, 472, 392);

    expect(fake.sent).toHaveLength(1);
    const [req] = fake.sent;
    expect(req.socketName).toBe('world');
    expect(req.category).toBe(TimeoutCategory.FAST);
    expect(req.packet).toEqual({
      verb: RdoVerb.SEL,
      targetId: FAKE_CONTEXT_IDS.worldContextId,
      action: RdoAction.CALL,
      member: 'ContextStatusText',
      separator: '"^"',
      args: [RdoValue.int(472).format(), RdoValue.int(392).format()],
    });
    expect(text).toBe(SENTENCE);
  });

  it('rounds a fractional camera position to whole tiles', async () => {
    const fake = makeSessionCtx();
    fake.respond(() => `res="%${SENTENCE}"`);

    await getContextStatusText(fake.ctx, 472.4, 391.6);

    expect(fake.sent[0].packet.args).toEqual([
      RdoValue.int(472).format(),
      RdoValue.int(392).format(),
    ]);
  });

  it('answers the empty string when there is no town under the camera', async () => {
    const fake = makeSessionCtx();
    // World.pas:4243 — NearestTown found nothing.
    fake.respond(() => 'res="%"');

    await expect(getContextStatusText(fake.ctx, 5, 5)).resolves.toBe('');
  });

  it('discards the integer ERROR_Unknown the IS substitutes for a faulted world proxy', async () => {
    const fake = makeSessionCtx();
    // InterfaceServer.pas:842 — an integer, not a sentence.
    fake.respond(() => 'res="#1"');

    await expect(getContextStatusText(fake.ctx, 472, 392)).resolves.toBe('');
  });

  it('answers the empty string for an empty payload', async () => {
    const fake = makeSessionCtx();
    // default responder: empty payload
    await expect(getContextStatusText(fake.ctx, 472, 392)).resolves.toBe('');
  });

  it('trims the surrounding whitespace off a sentence', async () => {
    const fake = makeSessionCtx();
    fake.respond(() => `res="%  ${SENTENCE}  "`);

    await expect(getContextStatusText(fake.ctx, 472, 392)).resolves.toBe(SENTENCE);
  });

  it('refuses without a world context and emits nothing', async () => {
    const fake = makeSessionCtx({ worldContextId: null });

    await expect(getContextStatusText(fake.ctx, 472, 392))
      .rejects.toThrow('Not logged into world - cannot read context status');
    expect(fake.sent).toHaveLength(0);
  });

  it('propagates a request timeout unchanged', async () => {
    const fake = makeSessionCtx();
    fake.respond(() => new Error('Request timeout: ContextStatusText'));

    await expect(getContextStatusText(fake.ctx, 472, 392))
      .rejects.toThrow('Request timeout: ContextStatusText');
  });
});
