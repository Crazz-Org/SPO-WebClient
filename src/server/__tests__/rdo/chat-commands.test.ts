/**
 * RDO wire test — GetUserList, driven through the production emitter
 * (`getChatUserList` in chat-handler.ts). GetUserList is a 0-arg `function`
 * on TClientView (InterfaceServer.pas:191) → `call "^"` with a RID, on the
 * world socket. The packet is rendered exactly as `sendRdoRequest` renders it.
 */

import { describe, it, expect } from '@jest/globals';
import { makeSessionCtx, FAKE_CONTEXT_IDS } from '../session/fake-session-context';
import { getChatUserList } from '../../session/chat-handler';
import { RdoProtocol } from '../../rdo';
import type { RdoPacket } from '../../../shared/types';

describe('GetUserList wire frame (getChatUserList)', () => {
  it('emits a 0-arg "^" call on the world context, over the world socket', async () => {
    const fake = makeSessionCtx();
    fake.respond(() => 'res="%"');
    await getChatUserList(fake.ctx);

    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0].socketName).toBe('world');
    const frame = RdoProtocol.format({ ...fake.sent[0].packet, rid: 42, type: 'REQUEST' } as RdoPacket);
    expect(frame).toBe(`C 42 sel ${FAKE_CONTEXT_IDS.worldContextId} call GetUserList "^"`);
  });
});
