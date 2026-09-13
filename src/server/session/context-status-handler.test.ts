/**
 * context-status-handler — `ContextStatusText` on the `world` socket.
 *
 * The member is a published Delphi FUNCTION taking two integers
 * (`Interface Server/InterfaceServer.pas:149`), so the frame carries `"^"` and
 * two `RdoValue.int` arguments in x-then-y order — the order Voyager itself
 * passes (`ServerCnxHandler.pas:1444`). The other half of the file is the three
 * ways the server says "no sentence": `%` empty (`Kernel/World.pas:4243`), the
 * integer `ERROR_Unknown` (`InterfaceServer.pas:840`), and no world at all.
 */

import { getContextStatusText } from './context-status-handler';
import { makeSessionCtx, FAKE_CONTEXT_IDS } from '../__tests__/session/fake-session-context';
import { RdoValue } from '../../shared/rdo-types';
import { RdoVerb, RdoAction } from '../../shared/types';
import { TimeoutCategory } from '../../shared/timeout-categories';
import { RDO_MEMBERS } from '../../shared/rdo-members';

describe('getContextStatusText', () => {
  it('calls ContextStatusText on the world context with two integer args, x then y', async () => {
    const fake = makeSessionCtx();
    fake.respond(() => 'res="%Podan"');

    await getContextStatusText(fake.ctx, 706, 436);

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
      args: [RdoValue.int(706).format(), RdoValue.int(436).format()],
    });
  });

  it('returns the sentence with the type prefix stripped', async () => {
    const fake = makeSessionCtx();
    fake.respond(() => 'res="%Podan — population 12,400"');

    await expect(getContextStatusText(fake.ctx, 706, 436)).resolves.toBe('Podan — population 12,400');
  });

  it('returns "" when there is no town under the tile (World.pas:4243)', async () => {
    const fake = makeSessionCtx();
    fake.respond(() => 'res="%"');

    await expect(getContextStatusText(fake.ctx, 1, 1)).resolves.toBe('');
  });

  it('returns "" — never the digit — when the facade answers the integer ERROR_Unknown', async () => {
    const fake = makeSessionCtx();
    fake.respond(() => 'res="#1"');

    await expect(getContextStatusText(fake.ctx, 706, 436)).resolves.toBe('');
  });

  it('asks nothing and answers "" when the session is not in a world', async () => {
    const fake = makeSessionCtx({ worldContextId: null });

    await expect(getContextStatusText(fake.ctx, 706, 436)).resolves.toBe('');
    expect(fake.sent).toHaveLength(0);
  });

  it('swallows a transport failure and answers "" rather than rejecting', async () => {
    const fake = makeSessionCtx();
    fake.respond(() => { throw new Error('world socket gone'); });

    await expect(getContextStatusText(fake.ctx, 706, 436)).resolves.toBe('');
  });

  it('catalogues ContextStatusText exactly as InterfaceServer.pas:149 declares it', () => {
    expect(RDO_MEMBERS.ContextStatusText).toEqual({ kind: 'function', arity: 2 });
  });
});
