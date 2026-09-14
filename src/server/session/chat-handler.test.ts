/// <reference path="../__tests__/matchers/rdo-matchers.d.ts" />

/**
 * chat-handler — the Interface Server chat members, on the `world` socket.
 *
 * The one frame that matters most here is `SayThis`:
 *   `procedure SayThis( Dest, Msg : widestring )` — InterfaceServer.pas:179.
 * A procedure, so it MUST go out as `"*"` WITH a QueryId (VOID_MEMBERS,
 * rdo-request-guards.ts:39). It used to be emitted with `"^"`, and one such
 * frame froze the shared Interface Server on 2026-08-15. The test below pins
 * the separator on the packet the handler hands to `sendRdoRequest`.
 *
 * Text escaping (`;`, `"` doubling, Latin-1 accents, injection payloads) is
 * already driven through this handler down to the bytes by
 * `__tests__/rdo/rdo-frame-injection.test.ts` — not repeated here.
 *
 * `getChatChannelInfo` / `joinChatChannel` used to carry an unquoted `'^'`
 * separator, flagged WARN in the source. Since the lot C migration the
 * separator is derived from the member's catalogued kind and the spelling
 * question is gone; `RdoProtocol.format()` quoted all three spellings
 * identically anyway (src/server/rdo.test.ts).
 */

import {
  getChatUserList,
  getChatChannelList,
  getChatChannelInfo,
  joinChatChannel,
  sendChatMessage,
  setChatTypingStatus,
  setChatAwayStatus,
  chaseUser,
  stopChase,
  getCurrentChannel,
} from './chat-handler';
import { RDO_MEMBERS } from '../../shared/rdo-members';
import { makeSessionCtx, FAKE_CONTEXT_IDS } from '../__tests__/session/fake-session-context';
import type { SessionContext } from './session-context';
import { RdoValue, RdoCommand } from '../../shared/rdo-types';
import { RdoVerb, RdoAction } from '../../shared/types';
import type { RdoPacket } from '../../shared/types';
import { TimeoutCategory } from '../../shared/timeout-categories';

const WORLD = FAKE_CONTEXT_IDS.worldContextId;

// ===========================================================================
// getChatUserList — GetUserList + parseChatUserList
// ===========================================================================

describe('getChatUserList', () => {
  it('calls GetUserList on the world context with "^", no args', async () => {
    const fake = makeSessionCtx();
    fake.respond(() => 'res="%"');

    await getChatUserList(fake.ctx);

    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0].socketName).toBe('world');
    expect(fake.sent[0].category).toBe(TimeoutCategory.NORMAL);
    expect(fake.sent[0].packet).toEqual({
      verb: RdoVerb.SEL,
      targetId: WORLD,
      action: RdoAction.CALL,
      member: 'GetUserList',
      separator: '"^"',
      args: [],
    });
  });

  it('returns no users for an empty list', async () => {
    const fake = makeSessionCtx();
    fake.respond(() => 'res="%"');
    expect(await getChatUserList(fake.ctx)).toEqual([]);
  });

  it('returns no users when the response packet carries no payload at all', async () => {
    const fake = makeSessionCtx();
    fake.respond((_p, i) => ({ raw: '', type: 'RESPONSE', rid: i } as RdoPacket));
    expect(await getChatUserList(fake.ctx)).toEqual([]);
  });

  it('parses one "name/accDesc/status" line through the real parseAccDesc', async () => {
    const fake = makeSessionCtx();
    // accDesc 0x00010BB8 = modifiers 1 (upper word), 3000 nobility points → Earl
    fake.respond(() => 'res="%Fred/68536/1"');

    expect(await getChatUserList(fake.ctx)).toEqual([
      { name: 'Fred', id: '68536', status: 1, nobilityPoints: 3000, nobilityTier: 'Earl', modifiers: 1 },
    ]);
  });

  it('parses several lines, tolerating CRLF, blank lines and missing fields', async () => {
    const fake = makeSessionCtx();
    fake.respond(() => 'res="%Alice/0/0\r\n\r\nBob\n/orphan/1\nCarol/500/x"');

    const users = await getChatUserList(fake.ctx);

    expect(users.map(u => u.name)).toEqual(['Alice', 'Bob', 'Carol']);
    // Bob has no accDesc nor status: defaults '0' and 0
    expect(users[1]).toEqual({ name: 'Bob', id: '0', status: 0, nobilityPoints: 0, nobilityTier: 'Commoner', modifiers: 0 });
    // Carol: non-numeric status → 0, 500 points → Baron
    expect(users[2]).toEqual({ name: 'Carol', id: '500', status: 0, nobilityPoints: 500, nobilityTier: 'Baron', modifiers: 0 });
  });

  it('refuses without a world context and sends nothing', async () => {
    const fake = makeSessionCtx({ worldContextId: null });
    await expect(getChatUserList(fake.ctx)).rejects.toThrow('Not logged into world');
    expect(fake.sent).toHaveLength(0);
  });

  it('propagates a timeout', async () => {
    const fake = makeSessionCtx();
    fake.respond(() => new Error('Request timeout: GetUserList'));
    await expect(getChatUserList(fake.ctx)).rejects.toThrow('Request timeout: GetUserList');
  });
});

// ===========================================================================
// getChatChannelList — GetChannelList("ROOT") + parseChatChannelList
// ===========================================================================

describe('getChatChannelList', () => {
  it('calls GetChannelList on the world context with the "ROOT" string arg and "^"', async () => {
    const fake = makeSessionCtx();
    fake.respond(() => 'res="%"');

    await getChatChannelList(fake.ctx);

    expect(fake.sent[0].socketName).toBe('world');
    expect(fake.sent[0].category).toBe(TimeoutCategory.NORMAL);
    expect(fake.sent[0].packet).toEqual({
      verb: RdoVerb.SEL,
      targetId: WORLD,
      action: RdoAction.CALL,
      member: 'GetChannelList',
      args: [RdoValue.string('ROOT').format()],
      separator: '"^"',
    });
  });

  it('always prepends Lobby, even to an empty list', async () => {
    const fake = makeSessionCtx();
    fake.respond(() => 'res="%"');
    expect(await getChatChannelList(fake.ctx)).toEqual(['Lobby']);
  });

  it('returns only Lobby when the response packet carries no payload at all', async () => {
    const fake = makeSessionCtx();
    fake.respond((_p, i) => ({ raw: '', type: 'RESPONSE', rid: i } as RdoPacket));
    expect(await getChatChannelList(fake.ctx)).toEqual(['Lobby']);
  });

  it('keeps only the even lines (name) of the name/password pairs', async () => {
    const fake = makeSessionCtx();
    fake.respond(() => 'res="%Traders\r\nsecret\r\nCafé\r\n\r\n"');
    expect(await getChatChannelList(fake.ctx)).toEqual(['Lobby', 'Traders', 'Café']);
  });

  it('a lone trailing name without password is still a channel', async () => {
    const fake = makeSessionCtx();
    fake.respond(() => 'res="%A\npw\nB"');
    expect(await getChatChannelList(fake.ctx)).toEqual(['Lobby', 'A', 'B']);
  });

  it('refuses without a world context and sends nothing', async () => {
    const fake = makeSessionCtx({ worldContextId: null });
    await expect(getChatChannelList(fake.ctx)).rejects.toThrow('Not logged into world');
    expect(fake.sent).toHaveLength(0);
  });
});

// ===========================================================================
// getChatChannelInfo
// ===========================================================================

describe('getChatChannelInfo', () => {
  it('calls GetChannelInfo with the channel name as an explicit OLEString', async () => {
    const fake = makeSessionCtx();
    fake.respond(() => 'res="%12 users"');

    const info = await getChatChannelInfo(fake.ctx, 'Café');

    expect(fake.sent[0].socketName).toBe('world');
    expect(fake.sent[0].category).toBe(TimeoutCategory.NORMAL);
    expect(fake.sent[0].packet).toEqual({
      verb: RdoVerb.SEL,
      targetId: WORLD,
      action: RdoAction.CALL,
      member: 'GetChannelInfo',
      args: [RdoValue.string('Café').format()],
      separator: '"^"',
    });
    expect(info).toBe('12 users');
  });

  it('returns an empty string for an empty payload', async () => {
    const fake = makeSessionCtx();
    expect(await getChatChannelInfo(fake.ctx, 'Lobby')).toBe('');
  });

  it('refuses without a world context and sends nothing', async () => {
    const fake = makeSessionCtx({ worldContextId: null });
    await expect(getChatChannelInfo(fake.ctx, 'Lobby')).rejects.toThrow('Not logged into world');
    expect(fake.sent).toHaveLength(0);
  });
});

// ===========================================================================
// joinChatChannel
// ===========================================================================

describe('joinChatChannel', () => {
  it('calls JoinChannel with (name, "") and records the channel on res="0"', async () => {
    const fake = makeSessionCtx();
    fake.respond(() => 'res="#0"');

    await joinChatChannel(fake.ctx, 'Traders');

    expect(fake.sent[0].socketName).toBe('world');
    expect(fake.sent[0].category).toBe(TimeoutCategory.NORMAL);
    expect(fake.sent[0].packet).toEqual({
      verb: RdoVerb.SEL,
      targetId: WORLD,
      action: RdoAction.CALL,
      member: 'JoinChannel',
      args: [RdoValue.string('Traders').format(), RdoValue.string('').format()],
      separator: '"^"',
    });
    expect(fake.ctx.setCurrentChannel).toHaveBeenCalledWith('Traders');
  });

  it('rethreads an accented channel name as-is (§4bis: name from the list, not a constant)', async () => {
    const fake = makeSessionCtx();
    fake.respond(() => 'res="#0"');

    await joinChatChannel(fake.ctx, 'Café');

    expect(fake.sent[0].packet.args?.[0]).toBe(RdoValue.string('Café').format());
    expect(fake.ctx.setCurrentChannel).toHaveBeenCalledWith('Café');
  });

  it('sends the empty name (Lobby) unchanged and stores the empty string', async () => {
    const fake = makeSessionCtx();
    fake.respond(() => 'res="#0"');

    await joinChatChannel(fake.ctx, '');

    expect(fake.sent[0].packet.args?.[0]).toBe(RdoValue.string('').format());
    expect(fake.ctx.setCurrentChannel).toHaveBeenCalledWith('');
    expect(fake.log.debug).toHaveBeenCalledWith('[Chat] Joining channel: Lobby');
  });

  it('throws with the server code and does not change the channel on a non-zero result', async () => {
    const fake = makeSessionCtx();
    fake.respond(() => 'res="#3"');

    await expect(joinChatChannel(fake.ctx, 'Locked')).rejects.toThrow('Failed to join channel: 3');
    expect(fake.ctx.setCurrentChannel).not.toHaveBeenCalled();
  });

  it('treats an empty payload as a failure', async () => {
    const fake = makeSessionCtx();
    await expect(joinChatChannel(fake.ctx, 'X')).rejects.toThrow('Failed to join channel: ');
  });

  it('refuses without a world context and sends nothing', async () => {
    const fake = makeSessionCtx({ worldContextId: null });
    await expect(joinChatChannel(fake.ctx, 'X')).rejects.toThrow('Not logged into world');
    expect(fake.sent).toHaveLength(0);
  });

  it('propagates a timeout', async () => {
    const fake = makeSessionCtx();
    fake.respond(() => new Error('Request timeout: JoinChannel'));
    await expect(joinChatChannel(fake.ctx, 'X')).rejects.toThrow('Request timeout: JoinChannel');
  });
});

// ===========================================================================
// sendChatMessage — SayThis, the void member
// ===========================================================================

describe('sendChatMessage', () => {
  it('sends SayThis through sendRdoRequest (QueryId) with "*" — never "^" — and (Dest="", Msg)', async () => {
    const fake = makeSessionCtx();
    fake.respond(() => '');

    await sendChatMessage(fake.ctx, 'hello world');

    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0].socketName).toBe('world');
    expect(fake.sent[0].category).toBe(TimeoutCategory.NORMAL);
    expect(fake.sent[0].packet).toEqual({
      verb: RdoVerb.SEL,
      targetId: WORLD,
      action: RdoAction.CALL,
      member: 'SayThis',
      separator: '"*"',
      args: [RdoValue.string('').format(), RdoValue.string('hello world').format()],
    });
    // Belt and braces: the separator must not contain the VariantId at all
    expect(fake.sent[0].packet.separator).not.toContain('^');
  });

  it('formats the message as an OLEString (% prefix) so a leading RDO prefix in the text is not re-typed', async () => {
    const fake = makeSessionCtx();
    await sendChatMessage(fake.ctx, '#42 is not an int');
    expect(fake.sent[0].packet.args?.[1]).toBe(RdoValue.string('#42 is not an int').format());
  });

  it('sends nothing for a whitespace-only message', async () => {
    const fake = makeSessionCtx();
    await sendChatMessage(fake.ctx, '   \t');
    expect(fake.sent).toHaveLength(0);
  });

  it('refuses without a world context and sends nothing', async () => {
    const fake = makeSessionCtx({ worldContextId: null });
    await expect(sendChatMessage(fake.ctx, 'hi')).rejects.toThrow('Not logged into world');
    expect(fake.sent).toHaveLength(0);
  });

  it('propagates a timeout', async () => {
    const fake = makeSessionCtx();
    fake.respond(() => new Error('Request timeout: SayThis'));
    await expect(sendChatMessage(fake.ctx, 'hi')).rejects.toThrow('Request timeout: SayThis');
  });
});

// ===========================================================================
// setChatTypingStatus — fire-and-forget MsgCompositionChanged
// ===========================================================================

describe('setChatTypingStatus', () => {
  it('writes MsgCompositionChanged "*" #1 on the world socket, no QueryId, when typing', async () => {
    const fake = makeSessionCtx({ sockets: ['world'] });

    await setChatTypingStatus(fake.ctx, true);

    expect(fake.sent).toHaveLength(0);
    expect(fake.frames.world).toEqual([
      RdoCommand.sel(WORLD).call('MsgCompositionChanged').push().args(RdoValue.int(1)).build(),
    ]);
    expect(fake.frames.world[0]).toMatchRdoCallFormat('MsgCompositionChanged');
  });

  it('writes #0 when typing stops', async () => {
    const fake = makeSessionCtx({ sockets: ['world'] });

    await setChatTypingStatus(fake.ctx, false);

    expect(fake.frames.world).toEqual([
      RdoCommand.sel(WORLD).call('MsgCompositionChanged').push().args(RdoValue.int(0)).build(),
    ]);
  });

  it('writes nothing when the world socket is absent', async () => {
    const fake = makeSessionCtx();
    await expect(setChatTypingStatus(fake.ctx, true)).resolves.toBeUndefined();
    expect(fake.ctx.getSocket).toHaveBeenCalledWith('world');
    expect(fake.sent).toHaveLength(0);
  });

  it('refuses without a world context', async () => {
    const fake = makeSessionCtx({ worldContextId: null, sockets: ['world'] });
    await expect(setChatTypingStatus(fake.ctx, true)).rejects.toThrow('Not logged into world');
    expect(fake.frames.world).toHaveLength(0);
  });
});

// ===========================================================================
// setChatAwayStatus — fire-and-forget MsgCompositionChanged #2 (`/afk`)
// ===========================================================================

describe('setChatAwayStatus', () => {
  it('writes MsgCompositionChanged "*" #2 on the world socket, no QueryId', async () => {
    const fake = makeSessionCtx({ sockets: ['world'] });

    await setChatAwayStatus(fake.ctx);

    expect(fake.sent).toHaveLength(0);
    expect(fake.frames.world).toEqual([
      RdoCommand.sel(WORLD).call('MsgCompositionChanged').push().args(RdoValue.int(2)).build(),
    ]);
    expect(fake.frames.world[0]).toMatchRdoCallFormat('MsgCompositionChanged');
  });

  it('writes nothing when the world socket is absent', async () => {
    const fake = makeSessionCtx();
    await expect(setChatAwayStatus(fake.ctx)).resolves.toBeUndefined();
    expect(fake.ctx.getSocket).toHaveBeenCalledWith('world');
    expect(fake.sent).toHaveLength(0);
  });
});

// ===========================================================================
// chaseUser / stopChase — Chase + StopChase, InterfaceServer.pas:189-190
//
// Both are published FUNCTIONS, so the catalogue derives `"^"` and a QueryId.
// These tests are the L0 unit the card asks for: the emitted member name, the
// separator, and an argument count that equals the catalogued arity.
// ===========================================================================

const CHASED = 'Mayor of Podan';

describe('chaseUser', () => {
  it('calls Chase on the world context with "^" and one OLEString argument', async () => {
    const fake = makeSessionCtx();
    fake.respond(() => 'res="#0"');

    await chaseUser(fake.ctx, CHASED);

    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0].socketName).toBe('world');
    expect(fake.sent[0].category).toBe(TimeoutCategory.NORMAL);
    expect(fake.sent[0].packet).toEqual({
      verb: RdoVerb.SEL,
      targetId: WORLD,
      action: RdoAction.CALL,
      member: 'Chase',
      separator: '"^"',
      args: [RdoValue.string(CHASED).format()],
    });
  });

  it('emits exactly the catalogued arity for a `function` member', () => {
    expect(RDO_MEMBERS.Chase).toEqual({ kind: 'function', arity: 1 });
  });

  it('sends as many arguments as the catalogue declares', async () => {
    const fake = makeSessionCtx();
    fake.respond(() => 'res="#0"');
    await chaseUser(fake.ctx, CHASED);
    expect(fake.sent[0].packet.args).toHaveLength(RDO_MEMBERS.Chase.arity);
  });

  it('rejects with the invalid-name message on ERROR_InvalidUserName (12)', async () => {
    const fake = makeSessionCtx();
    fake.respond(() => 'res="#12"');
    await expect(chaseUser(fake.ctx, CHASED)).rejects.toThrow(
      `Cannot follow ${CHASED}: unknown, offline, or already following you`,
    );
  });

  it('rejects with the raw code on any other error', async () => {
    const fake = makeSessionCtx();
    fake.respond(() => 'res="#1"');
    await expect(chaseUser(fake.ctx, CHASED)).rejects.toThrow('Chase failed: 1');
  });

  it('refuses without a world context', async () => {
    const fake = makeSessionCtx({ worldContextId: null });
    await expect(chaseUser(fake.ctx, CHASED)).rejects.toThrow('Not logged into world');
    expect(fake.sent).toHaveLength(0);
  });
});

describe('stopChase', () => {
  it('calls StopChase on the world context with "^" and no arguments', async () => {
    const fake = makeSessionCtx();
    fake.respond(() => 'res="#0"');

    await stopChase(fake.ctx);

    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0].socketName).toBe('world');
    expect(fake.sent[0].category).toBe(TimeoutCategory.NORMAL);
    expect(fake.sent[0].packet).toEqual({
      verb: RdoVerb.SEL,
      targetId: WORLD,
      action: RdoAction.CALL,
      member: 'StopChase',
      separator: '"^"',
      args: [],
    });
  });

  it('emits exactly the catalogued arity for a 0-arg `function` member', async () => {
    expect(RDO_MEMBERS.StopChase).toEqual({ kind: 'function', arity: 0 });

    const fake = makeSessionCtx();
    fake.respond(() => 'res="#0"');
    await stopChase(fake.ctx);
    expect(fake.sent[0].packet.args).toHaveLength(RDO_MEMBERS.StopChase.arity);
  });

  it('resolves anyway on ERROR_Unknown (1) — "was not chasing" is not a failure', async () => {
    const fake = makeSessionCtx();
    fake.respond(() => 'res="#1"');
    await expect(stopChase(fake.ctx)).resolves.toBeUndefined();
    expect(fake.ctx.log.debug).toHaveBeenCalledWith(
      expect.stringContaining('StopChase returned 1'),
    );
  });

  it('refuses without a world context', async () => {
    const fake = makeSessionCtx({ worldContextId: null });
    await expect(stopChase(fake.ctx)).rejects.toThrow('Not logged into world');
    expect(fake.sent).toHaveLength(0);
  });
});

// ===========================================================================
// getCurrentChannel
// ===========================================================================

describe('getCurrentChannel', () => {
  type CtxWithChannel = SessionContext & { currentChannel: string | null };

  it('returns the session channel when set', () => {
    const fake = makeSessionCtx();
    (fake.ctx as CtxWithChannel).currentChannel = 'Traders';
    expect(getCurrentChannel(fake.ctx)).toBe('Traders');
  });

  it('falls back to Lobby when the channel is null or empty', () => {
    const fake = makeSessionCtx();
    (fake.ctx as CtxWithChannel).currentChannel = null;
    expect(getCurrentChannel(fake.ctx)).toBe('Lobby');
    (fake.ctx as CtxWithChannel).currentChannel = '';
    expect(getCurrentChannel(fake.ctx)).toBe('Lobby');
  });
});
